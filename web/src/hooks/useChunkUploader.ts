/**
 * HOOK: useChunkUploader
 *
 * PURPOSE:
 * Reliably gets recording chunks from the browser into R2 and registers them
 * as segments. Pipeline per chunk:
 *   1. Persist blob to IndexedDB (crash-safe) BEFORE anything else.
 *   2. Ask backend for a presigned PUT URL.
 *   3. PUT the blob directly to R2.
 *   4. Register the segment metadata (assetKey) via our API.
 *   5. Delete the blob from IndexedDB.
 *
 * RELIABILITY:
 * - Several chunks upload in parallel and each retries on its own backoff, so
 *   one failing chunk never holds up the rest of the queue.
 * - Network and server errors retry for as long as the page is alive - an
 *   outage just pauses uploads (and resumes the moment the browser is back
 *   online). Only chunks that can never succeed are dropped.
 * - A chunk whose PUT already succeeded only re-registers on retry instead of
 *   re-uploading its bytes.
 * - A per-chunk Web Lock keeps two uploaders (another tab, the app-wide orphan
 *   drainer) from sending the same chunk at once.
 * Recording is never blocked by upload: chunks just accumulate in the
 * queue/IndexedDB.
 */

import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import api from "@/lib/axiosInstance";
import {
  buildChunkId,
  deleteChunk,
  getAllChunks,
  hasChunk,
  purgeStaleChunks,
  putChunk,
  type BufferedChunk,
  type BufferedTrackType,
  type BufferedUploadScope,
} from "@/lib/recordingDb";
import type {
  PresignSegmentResponse,
  CreateSegmentResponse,
} from "@/types/recordingTypes";

interface EnqueueChunkInput {
  spaceId: string;
  spaceRecordingSessionId: string;
  recordingSessionId: string;
  participantRecordingId: string;
  participantSessionId: string;
  trackType: BufferedTrackType;
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
  mimeType: string;
  blob: Blob;
  // Raw-PCM ("pcm") chunks only: carried through to the segment record so the
  // server can build a WAV header. Undefined for every other track type.
  sampleRate?: number;
  bitDepth?: number;
  channelCount?: number;
}

interface ResumeOrphansOptions {
  /** Skip chunks younger than this - a live recorder in this or another tab
   *  is still uploading those itself. */
  minAgeMs?: number;
}

interface UseChunkUploaderReturn {
  /** Persist + queue a chunk for upload. */
  enqueue: (input: EnqueueChunkInput) => Promise<void>;
  /** Drain any chunks left in IndexedDB from a previous (crashed) session. */
  resumeOrphans: (options?: ResumeOrphansOptions) => Promise<void>;
  /** Resolves when the queue is fully drained (all chunks uploaded). */
  waitUntilDrained: (timeoutMs?: number) => Promise<boolean>;
  /** Drop every chunk of a session that's being deleted (see the queue). */
  discardSession: (recordingSessionId: string) => Promise<void>;
  /** Number of successfully uploaded segments for a given recording. */
  getUploadedCount: (participantRecordingId: string) => number;
  /** How many uploads run at once (lower while recording, to spare the call). */
  setConcurrency: (concurrency: number) => void;
  pendingCount: number;
  /** Byte progress (0-100) of the chunks uploading right now; 100 when idle. */
  chunkProgress: number;
  failedPermanently: boolean;
}

interface UploaderOptions {
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
/** While the browser reports offline, probe this often (onLine can be wrong). */
const OFFLINE_PROBE_MS = 15000;
/** Retry after this when another uploader holds the chunk's lock. */
const LOCK_BUSY_RETRY_MS = 2000;
/** Non-network failures (auth, signature) tolerated before setting a chunk
 *  aside for a later session. Network failures never count. */
const MAX_HARD_FAILURES = 20;
/** Chunks older than this are dead orphans (their session ended long ago) and
 *  get GC'd so they can never accumulate. Long enough to upload a crashed
 *  tab's buffer when its owner opens the app again later. */
const STALE_CHUNK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Min gap between progress updates, so a fast upload doesn't re-render (and
 *  re-broadcast) on every progress event. */
const PROGRESS_THROTTLE_MS = 150;

interface QueueItem extends BufferedChunk {
  /** Consecutive failures, for the backoff. */
  attempts: number;
  hardFailures: number;
  nextAttemptAt: number;
  inFlight: boolean;
  /** In IndexedDB (so another uploader may have finished it). */
  persisted: boolean;
  /** Set once the PUT succeeded - a retry then only registers. */
  uploadedKey?: string;
  /** Bytes sent so far (progress). */
  loaded: number;
}

type Outcome = "done" | "retry" | "drop" | "giveup" | "busy";

class PutError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(status ? `R2 PUT failed with status ${status}` : "R2 PUT network error");
    this.status = status;
  }
}

/**
 * PUT a blob to a presigned URL. XHR rather than fetch because fetch can't
 * report upload progress; `onProgress` gets the fraction of bytes sent (0-1).
 */
export function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new PutError(xhr.status));
    };
    xhr.onerror = () => reject(new PutError(0));
    xhr.onabort = () => reject(new PutError(0));
    xhr.send(blob);
  });
}

function ext(mimeType: string): string {
  // Headerless raw PCM - the WAV header is added server-side at finalization.
  if (mimeType.includes("pcm")) return "pcm";
  if (mimeType.includes("mp4")) return "mp4";
  // Matroska (H.264 fallback container) is NOT webm - name it honestly. ffmpeg
  // probes by content at finalization, so this is for correctness of the object
  // key, not decode behavior.
  if (mimeType.includes("matroska")) return "mkv";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function backoffMs(attempts: number): number {
  const base = Math.min(
    BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1),
    MAX_BACKOFF_MS,
  );
  // Jitter so many queued chunks don't retry in lockstep.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * What to do after a failed attempt.
 * - drop: the request is invalid or the recording is gone; it can never work
 *   (e.g. a chunk left in IndexedDB by an ended session, or a deleted
 *   recording). Blocking on it would starve everything behind it.
 * - retry (network / 5xx / 429): always, for as long as the page lives.
 * - other failures (auth, a rejected signature) count toward a cap, after
 *   which the chunk is set aside - still in IndexedDB - for a later session.
 */
function classify(error: unknown, item: QueueItem): Outcome {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) return "retry";
    if ([400, 403, 404, 410, 413, 422].includes(status)) return "drop";
    if (status === 429 || status >= 500) return "retry";
  } else if (error instanceof PutError) {
    if (error.status === 0 || error.status === 429 || error.status >= 500) {
      return "retry";
    }
  }
  item.hardFailures += 1;
  return item.hardFailures >= MAX_HARD_FAILURES ? "giveup" : "retry";
}

/** API paths for the presign + segment-register calls. */
interface ChunkUploaderEndpoints {
  scope: BufferedUploadScope;
  presignPath: string;
  segmentPath: string;
}

const DEFAULT_ENDPOINTS: ChunkUploaderEndpoints = {
  scope: "space",
  presignPath: "/recording/segment/presign",
  segmentPath: "/recording/segment",
};

let persistRequested = false;

/** Ask the browser not to evict recording chunks under storage pressure. */
function requestPersistentStorage(): void {
  if (persistRequested) return;
  persistRequested = true;
  void navigator.storage?.persist?.().catch(() => undefined);
}

interface QueueListener {
  onPending: (count: number) => void;
  onProgress: (percent: number) => void;
  onFailedPermanently: () => void;
  onUploaded?: (info: {
    participantRecordingId: string;
    sequenceNumber: number;
    totalUploaded: number;
  }) => void;
}

/** The queue itself - plain mutable state, outside React's render model. */
class ChunkUploadQueue {
  private items: QueueItem[] = [];
  private active = 0;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  // Counts enqueue() calls that haven't pushed onto the queue yet (still
  // awaiting the IndexedDB write), so waitUntilDrained() can't see a false
  // "empty" queue for a chunk that's mid-persist.
  private pendingEnqueues = 0;
  // Uploaded sequence numbers per recording (a Set, so a chunk queued twice
  // can never inflate the count).
  private uploadedSeqs = new Map<string, Set<number>>();
  // Chunks set aside after repeated non-network failures - kept in IndexedDB
  // for a later session, skipped by resumeOrphans for the rest of this one.
  private setAside = new Set<string>();
  // Sessions the user deleted mid-recording: their chunks are never uploaded.
  private discarded = new Set<string>();
  private lastProgress = { value: 100, at: 0 };
  private disposed = false;

  constructor(
    private endpoints: ChunkUploaderEndpoints,
    private listener: QueueListener,
    private concurrency: number,
  ) {}

  setEndpoints(endpoints: ChunkUploaderEndpoints) {
    this.endpoints = endpoints;
  }

  setOnUploaded(onUploaded: QueueListener["onUploaded"]) {
    this.listener = { ...this.listener, onUploaded };
  }

  dispose() {
    this.disposed = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  /** Re-attach after a dispose (StrictMode mounts effects twice). */
  revive() {
    if (!this.disposed) return;
    this.disposed = false;
    this.pump();
  }

  /** Retry everything now (back online, tab visible). */
  wake(resetBackoff: boolean) {
    if (resetBackoff) {
      for (const item of this.items) {
        if (!item.inFlight) item.nextAttemptAt = 0;
      }
    }
    this.pump();
  }

  setConcurrency(concurrency: number) {
    this.concurrency = Math.max(1, Math.round(concurrency));
    this.pump();
  }

  getUploadedCount(participantRecordingId: string): number {
    return this.uploadedSeqs.get(participantRecordingId)?.size ?? 0;
  }

  async enqueue(input: EnqueueChunkInput): Promise<void> {
    this.pendingEnqueues += 1;
    try {
      requestPersistentStorage();
      const buffered: BufferedChunk = {
        id: buildChunkId(input.participantRecordingId, input.sequenceNumber),
        uploadScope: this.endpoints.scope,
        spaceId: input.spaceId,
        spaceRecordingSessionId: input.spaceRecordingSessionId,
        recordingSessionId: input.recordingSessionId,
        participantRecordingId: input.participantRecordingId,
        participantSessionId: input.participantSessionId,
        trackType: input.trackType,
        sequenceNumber: input.sequenceNumber,
        startMs: input.startMs,
        durationMs: input.durationMs,
        mimeType: input.mimeType,
        blob: input.blob,
        createdAt: Date.now(),
        sampleRate: input.sampleRate,
        bitDepth: input.bitDepth,
        channelCount: input.channelCount,
      };

      // Persist to disk FIRST - survives a crash even before upload.
      let persisted = false;
      try {
        await putChunk(buffered);
        persisted = true;
      } catch (error) {
        // Quota or private mode: still uploads from memory, just not
        // crash-safe.
        console.error(
          "[ChunkUploader] failed to buffer chunk to IndexedDB:",
          error,
        );
      }

      // The session was deleted while this chunk was being persisted.
      if (this.discarded.has(buffered.recordingSessionId)) {
        await deleteChunk(buffered.id).catch(() => undefined);
        return;
      }

      // A resumeOrphans pass can race the putChunk await above and queue this
      // chunk from IndexedDB before we get here - never queue the id twice.
      if (!this.items.some((item) => item.id === buffered.id)) {
        this.items.push(this.toItem(buffered, persisted));
      }
      this.listener.onPending(this.items.length);
      this.pump();
    } finally {
      this.pendingEnqueues -= 1;
    }
  }

  async resumeOrphans(options: ResumeOrphansOptions = {}): Promise<void> {
    // GC dead orphans first: chunks from a session that ended long ago.
    try {
      const purged = await purgeStaleChunks(STALE_CHUNK_TTL_MS);
      if (purged > 0) {
        console.warn(`[ChunkUploader] purged ${purged} stale orphaned chunk(s)`);
      }
    } catch (error) {
      console.error("[ChunkUploader] failed to purge stale chunks:", error);
    }

    let all: BufferedChunk[] = [];
    try {
      all = await getAllChunks();
    } catch (error) {
      console.error("[ChunkUploader] failed to read IndexedDB on resume:", error);
      return;
    }
    if (all.length === 0) return;

    const minAgeMs = options.minAgeMs ?? 0;
    const newestAllowed = Date.now() - minAgeMs;
    const existingIds = new Set(this.items.map((item) => item.id));
    for (const chunk of all) {
      const scope = chunk.uploadScope ?? "space";
      if (scope !== this.endpoints.scope) continue;
      if (minAgeMs > 0 && chunk.createdAt > newestAllowed) continue;
      // Don't re-queue a chunk we already set aside this session.
      if (this.setAside.has(chunk.id)) continue;
      if (existingIds.has(chunk.id)) continue;
      this.items.push(this.toItem(chunk, true));
    }
    this.listener.onPending(this.items.length);
    this.pump();
  }

  waitUntilDrained(timeoutMs = 120000): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (this.pendingEnqueues === 0 && this.items.length === 0) {
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 250);
      };
      check();
    });
  }

  /**
   * Drop a deleted session's chunks: queued ones (and their IndexedDB copies)
   * go now, in-flight ones are removed when they settle. Resolves once none
   * remain, so the caller can delete the session without a late upload
   * landing after it (bounded - a stuck upload just 404s and drops later).
   */
  async discardSession(
    recordingSessionId: string,
    timeoutMs = 15000,
  ): Promise<void> {
    this.discarded.add(recordingSessionId);
    this.items = this.items.filter((item) => {
      if (item.recordingSessionId !== recordingSessionId || item.inFlight) {
        return true;
      }
      void deleteChunk(item.id).catch(() => undefined);
      return false;
    });
    this.listener.onPending(this.items.length);

    const start = Date.now();
    while (
      this.pendingEnqueues > 0 ||
      this.items.some((item) => item.recordingSessionId === recordingSessionId)
    ) {
      if (Date.now() - start > timeoutMs) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private toItem(chunk: BufferedChunk, persisted: boolean): QueueItem {
    return {
      ...chunk,
      attempts: 0,
      hardFailures: 0,
      nextAttemptAt: 0,
      inFlight: false,
      persisted,
      loaded: 0,
    };
  }

  private pump() {
    if (this.disposed) return;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    const now = Date.now();
    const offline = isOffline();
    let nextWake = Number.POSITIVE_INFINITY;

    // Oldest first, so a recording's chunks land roughly in order.
    for (const item of this.items) {
      if (this.active >= this.concurrency) break;
      if (item.inFlight) continue;
      if (item.nextAttemptAt > now) {
        nextWake = Math.min(nextWake, item.nextAttemptAt);
        continue;
      }
      // Offline: don't burn attempts; the `online` event (or a probe) resumes.
      if (offline && item.attempts > 0) {
        nextWake = Math.min(nextWake, now + OFFLINE_PROBE_MS);
        continue;
      }
      item.inFlight = true;
      this.active += 1;
      void this.runItem(item)
        .catch((): Outcome => "retry")
        .then((outcome) => this.settle(item, outcome));
    }

    if (Number.isFinite(nextWake)) {
      this.wakeTimer = setTimeout(
        () => this.pump(),
        Math.max(0, nextWake - now),
      );
    }
    this.syncProgress(false);
  }

  private async runItem(item: QueueItem): Promise<Outcome> {
    const work = async (): Promise<Outcome> => {
      // Another uploader (tab, orphan drainer) already finished it.
      if (item.persisted) {
        const stillBuffered = await hasChunk(item.id).catch(() => true);
        if (!stillBuffered) return "done";
      }
      try {
        await this.uploadOne(item);
        return "done";
      } catch (error) {
        if (error instanceof PutError) item.uploadedKey = undefined;
        const outcome = classify(error, item);
        if (outcome !== "retry") {
          console.warn(
            `[ChunkUploader] ${outcome === "drop" ? "dropping" : "setting aside"} chunk ${item.id}:`,
            error,
          );
        }
        return outcome;
      }
    };

    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return work();
    return locks.request(
      `openside-chunk:${item.id}`,
      { ifAvailable: true },
      async (lock): Promise<Outcome> => (lock ? work() : "busy"),
    );
  }

  private async uploadOne(item: QueueItem): Promise<void> {
    const { presignPath, segmentPath } = this.endpoints;
    const contentType = item.mimeType || "application/octet-stream";

    if (!item.uploadedKey) {
      // 1. Presign (fresh each attempt - an expired URL is just a retry).
      const presign = await api.post<PresignSegmentResponse>(presignPath, {
        participantRecordingId: item.participantRecordingId,
        spaceId: item.spaceId,
        participantSessionId: item.participantSessionId,
        trackType: item.trackType,
        sequenceNumber: item.sequenceNumber,
        contentType,
        ext: ext(item.mimeType),
        // Signed into the URL: R2 refuses a body of any other size.
        sizeBytes: item.blob.size,
      });
      const { uploadUrl, assetKey } = presign.data.data;

      // 2. PUT blob straight to R2 (no auth header - the URL is the auth).
      item.loaded = 0;
      await putWithProgress(uploadUrl, item.blob, contentType, (fraction) => {
        item.loaded = fraction * item.blob.size;
        this.syncProgress(false);
      });
      item.uploadedKey = assetKey;
    }
    item.loaded = item.blob.size;

    // 3. Register segment metadata. PCM chunks additionally carry the audio
    // format the server needs to write a WAV header (undefined otherwise).
    await api.post<CreateSegmentResponse>(segmentPath, {
      participantRecordingId: item.participantRecordingId,
      spaceRecordingSessionId: item.spaceRecordingSessionId,
      spaceId: item.spaceId,
      participantSessionId: item.participantSessionId,
      sequenceNumber: item.sequenceNumber,
      assetKey: item.uploadedKey,
      startMs: Math.max(0, Math.round(item.startMs)),
      durationMs: Math.max(0, Math.round(item.durationMs)),
      sizeBytes: item.blob.size,
      sampleRate: item.sampleRate,
      bitDepth: item.bitDepth,
      channelCount: item.channelCount,
    });

    // 4. Done - drop from durable buffer.
    await deleteChunk(item.id).catch(() => undefined);
  }

  private settle(item: QueueItem, outcome: Outcome) {
    item.inFlight = false;
    item.loaded = 0;
    this.active = Math.max(0, this.active - 1);
    const remove = () => {
      this.items = this.items.filter((queued) => queued !== item);
    };

    if (outcome !== "done" && this.discarded.has(item.recordingSessionId)) {
      remove();
      void deleteChunk(item.id).catch(() => undefined);
    } else if (outcome === "done") {
      remove();
      let seqs = this.uploadedSeqs.get(item.participantRecordingId);
      if (!seqs) {
        seqs = new Set();
        this.uploadedSeqs.set(item.participantRecordingId, seqs);
      }
      seqs.add(item.sequenceNumber);
      this.listener.onUploaded?.({
        participantRecordingId: item.participantRecordingId,
        sequenceNumber: item.sequenceNumber,
        totalUploaded: seqs.size,
      });
    } else if (outcome === "drop") {
      remove();
      void deleteChunk(item.id).catch(() => undefined);
      this.listener.onFailedPermanently();
    } else if (outcome === "giveup") {
      remove();
      this.setAside.add(item.id);
      this.listener.onFailedPermanently();
    } else if (outcome === "busy") {
      item.nextAttemptAt = Date.now() + LOCK_BUSY_RETRY_MS;
    } else {
      item.attempts += 1;
      item.nextAttemptAt = Date.now() + backoffMs(item.attempts);
    }

    this.listener.onPending(this.items.length);
    this.syncProgress(true);
    this.pump();
  }

  private syncProgress(force: boolean) {
    let loaded = 0;
    let total = 0;
    for (const item of this.items) {
      if (!item.inFlight) continue;
      loaded += item.loaded;
      total += item.blob.size;
    }
    // The PUT tops out at 99 - only a registered chunk counts as done.
    const percent = total > 0 ? Math.min(99, (loaded / total) * 99) : 100;
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    const now = Date.now();
    if (value === this.lastProgress.value) return;
    if (!force && now - this.lastProgress.at < PROGRESS_THROTTLE_MS) return;
    this.lastProgress = { value, at: now };
    this.listener.onProgress(value);
  }
}

export default function useChunkUploader(
  onChunkUploaded?: QueueListener["onUploaded"],
  endpoints: ChunkUploaderEndpoints = DEFAULT_ENDPOINTS,
  options: UploaderOptions = {},
): UseChunkUploaderReturn {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedPermanently, setFailedPermanently] = useState(false);
  const [chunkProgress, setChunkProgress] = useState(100);
  const [queue] = useState(
    () =>
      new ChunkUploadQueue(
        endpoints,
        {
          onPending: setPendingCount,
          onProgress: setChunkProgress,
          onFailedPermanently: () => setFailedPermanently(true),
        },
        options.concurrency ?? DEFAULT_CONCURRENCY,
      ),
  );

  useEffect(() => {
    queue.setEndpoints(endpoints);
  }, [queue, endpoints]);

  useEffect(() => {
    queue.setOnUploaded(onChunkUploaded);
  }, [queue, onChunkUploaded]);

  // Back online / tab visible again: retry immediately instead of waiting out
  // the backoff.
  useEffect(() => {
    const onOnline = () => queue.wake(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") queue.wake(false);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queue]);

  useEffect(() => {
    queue.revive();
    return () => queue.dispose();
  }, [queue]);

  // The methods never change identity, so effects can depend on them without
  // re-running on every progress update.
  const methods = useMemo(
    () => ({
      enqueue: (input: EnqueueChunkInput) => queue.enqueue(input),
      resumeOrphans: (resumeOptions?: ResumeOrphansOptions) =>
        queue.resumeOrphans(resumeOptions),
      waitUntilDrained: (timeoutMs?: number) =>
        queue.waitUntilDrained(timeoutMs),
      discardSession: (recordingSessionId: string) =>
        queue.discardSession(recordingSessionId),
      getUploadedCount: (participantRecordingId: string) =>
        queue.getUploadedCount(participantRecordingId),
      setConcurrency: (concurrency: number) =>
        queue.setConcurrency(concurrency),
    }),
    [queue],
  );

  return useMemo(
    () => ({ ...methods, pendingCount, chunkProgress, failedPermanently }),
    [methods, pendingCount, chunkProgress, failedPermanently],
  );
}
