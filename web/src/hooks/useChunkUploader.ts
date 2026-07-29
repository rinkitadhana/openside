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
 * Uploads run on a single serial queue with exponential-backoff retry, so a
 * transient network failure never drops a chunk - it stays in IndexedDB and is
 * retried (or drained on the next mount via `resumeOrphans`). Recording is
 * never blocked by upload: chunks just accumulate in the queue/IndexedDB.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import api from "@/lib/axiosInstance";
import {
  buildChunkId,
  deleteChunk,
  getAllChunks,
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

export interface EnqueueChunkInput {
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

interface UseChunkUploaderReturn {
  /** Persist + queue a chunk for upload. */
  enqueue: (input: EnqueueChunkInput) => Promise<void>;
  /** Drain any chunks left in IndexedDB from a previous (crashed) session. */
  resumeOrphans: () => Promise<void>;
  /** Resolves when the queue is fully drained (all chunks uploaded). */
  waitUntilDrained: (timeoutMs?: number) => Promise<boolean>;
  /** Number of successfully uploaded segments for a given recording. */
  getUploadedCount: (participantRecordingId: string) => number;
  pendingCount: number;
  failedPermanently: boolean;
}

const MAX_RETRIES = 8;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
/** Chunks older than this are dead orphans (their session ended) and get GC'd on
 *  mount so they can never accumulate and block a future recording's uploads. */
const STALE_CHUNK_TTL_MS = 24 * 60 * 60 * 1000;

interface QueueItem extends BufferedChunk {
  attempts: number;
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

function isMissingRecordingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const response = (error as {
    response?: { status?: number; data?: { message?: unknown } };
  }).response;

  return (
    response?.status === 404 &&
    response.data?.message === "Recording not found!"
  );
}

/**
 * A chunk that can never succeed no matter how often we retry, so it must be
 * dropped rather than left blocking the queue head. Covers:
 *  - 404 "Recording not found" - the recording was deleted / never existed.
 *  - any 400 - the presign request itself is rejected as invalid. This is the
 *    classic poison-orphan: a chunk left in IndexedDB by an EARLIER session
 *    whose participant is no longer active, so its presign 400s forever. Retried
 *    at the head, it would block every chunk of the CURRENT recording behind it
 *    (the late-joiner "0 segments uploaded" bug).
 */
function isUnrecoverableUploadError(error: unknown): boolean {
  if (isMissingRecordingError(error)) return true;
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  return status === 400;
}

/** API paths for the presign + segment-register calls. */
export interface ChunkUploaderEndpoints {
  scope: BufferedUploadScope;
  presignPath: string;
  segmentPath: string;
}

const DEFAULT_ENDPOINTS: ChunkUploaderEndpoints = {
  scope: "space",
  presignPath: "/recording/segment/presign",
  segmentPath: "/recording/segment",
};

export default function useChunkUploader(
  onChunkUploaded?: (info: {
    participantRecordingId: string;
    sequenceNumber: number;
    totalUploaded: number;
  }) => void,
  endpoints: ChunkUploaderEndpoints = DEFAULT_ENDPOINTS,
): UseChunkUploaderReturn {
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  // Counts enqueue() calls that haven't pushed onto queueRef yet (still
  // awaiting the IndexedDB write). Incremented synchronously the instant
  // enqueue() is invoked, so waitUntilDrained() can't see a false "empty"
  // queue for a chunk that's mid-persist - the race a sub-5s recording hits
  // when its only chunk is enqueued (fire-and-forget) right as `.stop()`
  // resolves and the caller immediately checks drained state.
  const pendingEnqueuesRef = useRef(0);
  // Uploaded sequence numbers per recording (a Set, not a counter, so a chunk
  // that gets queued twice - e.g. the enqueue/resumeOrphans race - can never
  // inflate the count and desync expectedSegments at completion time).
  const uploadedSeqsRef = useRef<Map<string, Set<number>>>(new Map());
  // Chunks set aside after exhausting retries - kept out of the active queue so
  // they can't block the rest, and skipped by resumeOrphans so they aren't
  // immediately re-queued this session.
  const quarantinedRef = useRef<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const [failedPermanently, setFailedPermanently] = useState(false);

  const syncPending = useCallback(() => {
    setPendingCount(queueRef.current.length);
  }, []);

  const uploadOne = useCallback(
    async (item: QueueItem): Promise<void> => {
      // 1. Presign
      const presign = await api.post<PresignSegmentResponse>(
        endpoints.presignPath,
        {
          participantRecordingId: item.participantRecordingId,
          spaceId: item.spaceId,
          participantSessionId: item.participantSessionId,
          trackType: item.trackType,
          sequenceNumber: item.sequenceNumber,
          contentType: item.mimeType || "application/octet-stream",
          ext: ext(item.mimeType),
        },
      );

      const { uploadUrl, assetKey } = presign.data.data;

      // 2. PUT blob straight to R2 (no auth header - the URL is the auth).
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: item.blob,
        headers: {
          "Content-Type": item.mimeType || "application/octet-stream",
        },
      });

      if (!putRes.ok) {
        throw new Error(`R2 PUT failed with status ${putRes.status}`);
      }

      // 3. Register segment metadata. PCM chunks additionally carry the audio
      // format the server needs to write a WAV header (undefined otherwise).
      await api.post<CreateSegmentResponse>(endpoints.segmentPath, {
        participantRecordingId: item.participantRecordingId,
        spaceRecordingSessionId: item.spaceRecordingSessionId,
        spaceId: item.spaceId,
        participantSessionId: item.participantSessionId,
        sequenceNumber: item.sequenceNumber,
        assetKey,
        startMs: Math.max(0, Math.round(item.startMs)),
        durationMs: Math.max(0, Math.round(item.durationMs)),
        sizeBytes: item.blob.size,
        sampleRate: item.sampleRate,
        bitDepth: item.bitDepth,
        channelCount: item.channelCount,
      });

      // 4. Done - drop from durable buffer.
      await deleteChunk(item.id);

      let seqs = uploadedSeqsRef.current.get(item.participantRecordingId);
      if (!seqs) {
        seqs = new Set();
        uploadedSeqsRef.current.set(item.participantRecordingId, seqs);
      }
      seqs.add(item.sequenceNumber);
      onChunkUploaded?.({
        participantRecordingId: item.participantRecordingId,
        sequenceNumber: item.sequenceNumber,
        totalUploaded: seqs.size,
      });
    },
    [onChunkUploaded, endpoints],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current[0];

        try {
          await uploadOne(item);
          queueRef.current.shift();
          syncPending();
        } catch (error) {
          if (isUnrecoverableUploadError(error)) {
            console.warn(
              `[ChunkUploader] dropping unrecoverable chunk ${item.id} (won't retry) so it can't block the queue:`,
              error,
            );
            await deleteChunk(item.id);
            queueRef.current.shift();
            syncPending();
            continue;
          }

          item.attempts += 1;
          console.error(
            `[ChunkUploader] upload failed (attempt ${item.attempts}) for ${item.id}:`,
            error,
          );

          if (item.attempts >= MAX_RETRIES) {
            // Quarantine this ONE chunk instead of halting the whole queue.
            // Halting on the head item stranded every later chunk of the
            // recording (one transient failure that outlasted the retries could
            // truncate everything after it). Set it aside - kept in IndexedDB so
            // a later mount can resume it if the network recovers, GC'd by the
            // 24h TTL otherwise - and keep uploading the rest. The finalizer
            // salvages the resulting gap; failedPermanently still surfaces that a
            // fragment is missing.
            console.error(
              `[ChunkUploader] quarantining ${item.id} after ${item.attempts} attempts; continuing with the rest of the queue`,
            );
            quarantinedRef.current.add(item.id);
            queueRef.current.shift();
            setFailedPermanently(true);
            syncPending();
            continue;
          }

          // Exponential backoff, then retry the same head item.
          const backoff = Math.min(
            BASE_BACKOFF_MS * 2 ** (item.attempts - 1),
            MAX_BACKOFF_MS,
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [uploadOne, syncPending]);

  const enqueue = useCallback(
    async (input: EnqueueChunkInput) => {
      pendingEnqueuesRef.current += 1;
      try {
        const buffered: BufferedChunk = {
          id: buildChunkId(input.participantRecordingId, input.sequenceNumber),
          uploadScope: endpoints.scope,
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
        try {
          await putChunk(buffered);
        } catch (error) {
          console.error("[ChunkUploader] failed to buffer chunk to IndexedDB:", error);
        }

        // A resumeOrphans pass can race the putChunk await above and queue this
        // chunk from IndexedDB before we get here - never queue the id twice.
        if (!queueRef.current.some((item) => item.id === buffered.id)) {
          queueRef.current.push({ ...buffered, attempts: 0 });
        }
        syncPending();
        void processQueue();
      } finally {
        pendingEnqueuesRef.current -= 1;
      }
    },
    [endpoints.scope, processQueue, syncPending],
  );

  const resumeOrphans = useCallback(async () => {
    // GC dead orphans first: chunks from an ended/crashed session that can never
    // upload. Left in place they pile up and block a fresh recording's queue.
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

    const existingIds = new Set(queueRef.current.map((item) => item.id));
    for (const chunk of all) {
      if (chunk.uploadScope && chunk.uploadScope !== endpoints.scope) {
        continue;
      }
      // Don't re-queue a chunk we already gave up on this session, or it would
      // loop straight back to the head and stall the queue again.
      if (quarantinedRef.current.has(chunk.id)) {
        continue;
      }
      if (!existingIds.has(chunk.id)) {
        queueRef.current.push({ ...chunk, attempts: 0 });
      }
    }
    syncPending();
    void processQueue();
  }, [endpoints.scope, processQueue, syncPending]);

  const waitUntilDrained = useCallback(
    (timeoutMs = 120000): Promise<boolean> => {
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          if (
            pendingEnqueuesRef.current === 0 &&
            queueRef.current.length === 0 &&
            !processingRef.current
          ) {
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
    },
    [],
  );

  const getUploadedCount = useCallback(
    (participantRecordingId: string) =>
      uploadedSeqsRef.current.get(participantRecordingId)?.size ?? 0,
    [],
  );

  // Memoized so consumers can safely depend on the hook result in effects.
  return useMemo(
    () => ({
      enqueue,
      resumeOrphans,
      waitUntilDrained,
      getUploadedCount,
      pendingCount,
      failedPermanently,
    }),
    [
      enqueue,
      resumeOrphans,
      waitUntilDrained,
      getUploadedCount,
      pendingCount,
      failedPermanently,
    ],
  );
}
