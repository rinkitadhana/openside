/**
 * HOOK: usePcmCapture
 *
 * PURPOSE:
 * Captures a TRUE lossless raw-PCM copy of the microphone, in parallel with (and
 * completely separate from) the combined MediaRecorder video track and LiveKit's
 * live call. The combined recorder's audio is lossy Opus; this path taps the raw
 * Float32 samples straight off the mic via an AudioWorklet, quantizes them to
 * 24-bit signed little-endian, and emits headerless raw-PCM chunks. A proper WAV
 * header is added server-side at finalization.
 *
 * WHY A DEDICATED getUserMedia:
 * LiveKit's mic stream runs the browser DSP chain (echo cancellation, noise
 * suppression, AGC) which is destructive - great for a call, wrong for a master.
 * We open our OWN stream on the same device with all DSP OFF so the samples are
 * pristine. Nothing is ever audible: the graph ends in a muted gain node (it
 * keeps the worklet pulled even while no mic is connected).
 *
 * The capture follows the call: muting the call mic silences this track too
 * (`setMuted`), and switching mics in the call moves it to the new device
 * without a gap in the sample clock (`switchDevice`). On iOS, where a second
 * capture of the same mic would cut off the call's, it records a clone of the
 * call's mic track instead.
 *
 * CLOCK:
 * Samples are counted at the ACTUAL ctx.sampleRate (hardware may ignore the
 * requested one), but that count runs on the audio hardware's clock, while the
 * video and every chunk timestamp run on the system clock - they drift apart,
 * and a suspended context stops counting altogether. So each chunk is stamped
 * with where its first sample really sat on the system clock: the smallest
 * (receipt time - sample position) over the chunk's quanta, which filters out
 * main-thread delays. When that offset jumps and stays jumped (the context was
 * suspended), the chunk is cut right there so the new stamp starts exactly at
 * the break. The finalizer fits these stamps to keep the WAV in sync with the
 * video for the whole take (see audio-timeline.ts on the server).
 *
 * PAUSE:
 * While paused the samples are dropped, and the caller's `clock` (the system
 * clock minus paused time) stands still - so the stamps run on as if the pause
 * never happened, just like the video's.
 */

import { useCallback, useRef } from "react";

export interface PcmChunkMeta {
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
  /** The ACTUAL AudioContext sample rate (may differ from the requested rate). */
  sampleRate: number;
  bitDepth: number;
  channelCount: number;
}

interface UsePcmCaptureOptions {
  onPcmChunk: (blob: Blob, meta: PcmChunkMeta) => void;
  onError?: (err: Error) => void;
}

interface PcmSource {
  audioId?: string;
  /** The call's mic track (iOS: cloned instead of opening a second capture). */
  callTrack?: MediaStreamTrack | null;
}

interface PcmCaptureStartOptions extends PcmSource {
  sampleRate?: 44100 | 48000;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  /** performance.now() instant chunk start times are measured from. */
  timeOrigin?: number;
  /** Recording-time clock (performance.now() minus paused time). */
  clock?: () => number;
  /** Start paused: nothing is kept until setPaused(false). */
  paused?: boolean;
  /** Start silenced (the call mic is muted). */
  muted?: boolean;
}

interface UsePcmCaptureReturn {
  /** Open a dedicated mic stream and begin capturing the requested PCM master. */
  start: (options?: PcmCaptureStartOptions) => Promise<void>;
  /** Flush the final partial chunk, tear down the graph, and close the context. */
  stop: () => Promise<void>;
  /** Follow the call onto another mic without breaking the sample clock. */
  switchDevice: (source: PcmSource) => Promise<void>;
  /** Mirror the call mic's mute state (muted = silence is recorded). */
  setMuted: (muted: boolean) => void;
  /** Pause the take: samples are dropped until resumed. */
  setPaused: (paused: boolean) => void;
  /** Chunks emitted so far (= the next sequence number). */
  getChunkCount: () => number;
  isRunning: () => boolean;
}

/** Flush a chunk roughly every 5 seconds of captured audio. */
const FLUSH_INTERVAL_SECONDS = 5;

/** 2^23 - 1: full-scale for signed 24-bit. */
const INT24_MAX = 8388607;

/** The sample clock fell this far behind the system clock: lost audio time. */
const DISCONTINUITY_MS = 150;

/** ...and stayed behind this long (a main-thread stall catches up instantly). */
const DISCONTINUITY_CONFIRM_MS = 400;

interface PendingBreak {
  /** Index in the pending frames of the first quantum after the break. */
  frameIndex: number;
  /** Pending samples before it. */
  samplesBefore: number;
  /** Smallest offset seen since the break. */
  offsetMs: number;
  /** When the break was first seen (performance.now()). */
  seenAt: number;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export default function usePcmCapture({
  onPcmChunk,
  onError,
}: UsePcmCaptureOptions): UsePcmCaptureReturn {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const deviceIdRef = useRef<string | undefined>(undefined);
  const constraintsRef = useRef<MediaTrackConstraints>({});
  const mutedRef = useRef(false);
  const resumeListenerRef = useRef<(() => void) | null>(null);

  // Accumulated Float32 frames pending flush.
  const framesRef = useRef<Float32Array[]>([]);
  const pendingSamplesRef = useRef(0);
  // Total samples already flushed - the chunk-start clock, measured off the
  // actual sample count so it stays exact even if the hardware rate drifts.
  const emittedSamplesRef = useRef(0);
  const seqRef = useRef(0);
  const timeOriginRef = useRef(0);
  const clockRef = useRef<() => number>(() => performance.now());
  const pausedRef = useRef(false);
  // System-clock time minus sample-clock time for the pending chunk (ms): its
  // first sample sits at sampleTime + this on the recording timeline.
  const chunkOffsetRef = useRef<number | null>(null);
  const pendingBreakRef = useRef<PendingBreak | null>(null);
  const runningRef = useRef(false);
  const onPcmChunkRef = useRef(onPcmChunk);
  onPcmChunkRef.current = onPcmChunk;

  const flush = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const total = pendingSamplesRef.current;
    if (total === 0) return; // nothing buffered (e.g. stop() with an empty tail)

    // Concatenate the pending Float32 frames into one contiguous buffer.
    const merged = new Float32Array(total);
    let offset = 0;
    for (const frame of framesRef.current) {
      merged.set(frame, offset);
      offset += frame.length;
    }
    framesRef.current = [];
    pendingSamplesRef.current = 0;

    // Quantize Float32 [-1,1] -> 24-bit signed LE, packed 3 bytes/sample.
    const bytes = new Uint8Array(total * 3);
    for (let i = 0; i < total; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      const v = Math.round(s * INT24_MAX); // 2^23 - 1
      const o = i * 3;
      bytes[o] = v & 0xff;
      bytes[o + 1] = (v >>> 8) & 0xff;
      bytes[o + 2] = (v >>> 16) & 0xff;
    }

    // Use the ACTUAL context sample rate, never a hardcoded 48000.
    const sampleRate = ctx.sampleRate;
    const startMs = Math.max(
      0,
      (emittedSamplesRef.current / sampleRate) * 1000 +
        (chunkOffsetRef.current ?? 0),
    );
    const durationMs = (total / sampleRate) * 1000;
    emittedSamplesRef.current += total;
    chunkOffsetRef.current = null;

    const blob = new Blob([bytes], { type: "audio/pcm-raw" });
    onPcmChunkRef.current(blob, {
      sequenceNumber: seqRef.current,
      startMs,
      durationMs,
      sampleRate,
      bitDepth: 24,
      channelCount: 1,
    });
    seqRef.current += 1;
  }, []);

  /** Emit everything before a confirmed break as its own chunk; the rest
   *  starts a new chunk stamped from after the break. */
  const splitAtBreak = useCallback(
    (pending: PendingBreak) => {
      const after = framesRef.current.slice(pending.frameIndex);
      framesRef.current = framesRef.current.slice(0, pending.frameIndex);
      const afterSamples = pendingSamplesRef.current - pending.samplesBefore;
      pendingSamplesRef.current = pending.samplesBefore;
      flush();
      framesRef.current = after;
      pendingSamplesRef.current = afterSamples;
      chunkOffsetRef.current = pending.offsetMs;
      pendingBreakRef.current = null;
    },
    [flush],
  );

  /** Flush on stop, honouring a break that was still being confirmed. */
  const flushAll = useCallback(() => {
    const pending = pendingBreakRef.current;
    const chunkOffset = chunkOffsetRef.current;
    if (
      pending &&
      chunkOffset !== null &&
      pending.offsetMs > chunkOffset + DISCONTINUITY_MS
    ) {
      splitAtBreak(pending);
    }
    pendingBreakRef.current = null;
    flush();
  }, [flush, splitAtBreak]);

  /** Open the capture for a source: the call track's clone on iOS, otherwise
   *  our own DSP-free stream on the same device. */
  const openStream = useCallback(
    async (source: PcmSource): Promise<MediaStream> => {
      if (isIos() && source.callTrack && source.callTrack.readyState === "live") {
        return new MediaStream([source.callTrack.clone()]);
      }
      return navigator.mediaDevices.getUserMedia({
        audio: {
          ...constraintsRef.current,
          ...(source.audioId ? { deviceId: { exact: source.audioId } } : {}),
        },
      });
    },
    [],
  );

  const connectStream = useCallback((stream: MediaStream) => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    const track = stream.getAudioTracks()[0];
    if (!ctx || !node || !track) return;
    track.enabled = !mutedRef.current;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(node);
    const previousSource = sourceRef.current;
    const previousStream = streamRef.current;
    sourceRef.current = source;
    streamRef.current = stream;
    try {
      previousSource?.disconnect();
    } catch {
      /* ignore */
    }
    for (const old of previousStream?.getTracks() ?? []) {
      if (!stream.getTracks().includes(old)) old.stop();
    }
  }, []);

  const teardown = useCallback(async () => {
    try {
      nodeRef.current?.port.close();
      nodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sourceRef.current?.disconnect();
      sinkRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    if (resumeListenerRef.current) {
      window.removeEventListener("pointerdown", resumeListenerRef.current);
      window.removeEventListener("keydown", resumeListenerRef.current);
      resumeListenerRef.current = null;
    }
    await ctxRef.current?.close().catch(() => undefined);
    nodeRef.current = null;
    sourceRef.current = null;
    sinkRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  }, []);

  const start = useCallback(
    async (options: PcmCaptureStartOptions = {}) => {
      if (runningRef.current) return;
      runningRef.current = true;

      try {
        // The PCM master owns its own DSP controls, completely separate from
        // LiveKit's call stream. Defaults remain DSP-off for a pristine master.
        constraintsRef.current = {
          echoCancellation: options.echoCancellation ?? false,
          noiseSuppression: options.noiseSuppression ?? false,
          autoGainControl: options.autoGainControl ?? false,
          channelCount: 1,
          sampleRate: options.sampleRate ?? 48000,
        };
        deviceIdRef.current = options.audioId;
        mutedRef.current = options.muted ?? false;
        timeOriginRef.current = options.timeOrigin ?? performance.now();
        clockRef.current = options.clock ?? (() => performance.now());
        pausedRef.current = options.paused ?? false;

        const stream = await openStream(options);

        const ctx = new AudioContext({
          sampleRate: options.sampleRate ?? 48000,
          latencyHint: "playback",
        });
        ctxRef.current = ctx;

        // Created outside a click (the countdown fires it), so the autoplay
        // policy can leave it suspended - which would capture nothing at all.
        if (ctx.state === "suspended") {
          await ctx.resume().catch(() => undefined);
        }
        if (ctx.state === "suspended") {
          const resume = () => void ctx.resume().catch(() => undefined);
          resumeListenerRef.current = resume;
          window.addEventListener("pointerdown", resume);
          window.addEventListener("keydown", resume);
          console.warn(
            "[PcmCapture] audio context is suspended until the next click/keypress",
          );
        }

        await ctx.audioWorklet.addModule("/pcm-worklet.js");

        const node = new AudioWorkletNode(ctx, "pcm-worklet");
        nodeRef.current = node;
        // Pull the worklet through a muted sink so it keeps running (and
        // keeps the sample clock moving) even with no mic connected. Gain 0:
        // nothing is ever played back, so there's no feedback loop.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        node.connect(sink).connect(ctx.destination);
        sinkRef.current = sink;

        emittedSamplesRef.current = 0;
        seqRef.current = 0;
        framesRef.current = [];
        pendingSamplesRef.current = 0;
        chunkOffsetRef.current = null;
        pendingBreakRef.current = null;

        const flushThreshold = Math.round(
          FLUSH_INTERVAL_SECONDS * ctx.sampleRate,
        );
        node.port.onmessage = (event) => {
          if (pausedRef.current) return;
          const ch = event.data as Float32Array;
          const now = clockRef.current();
          framesRef.current.push(ch);
          pendingSamplesRef.current += ch.length;
          // This quantum was complete when posted: its last sample sits at
          // the sample clock's current end.
          const sampleMs =
            ((emittedSamplesRef.current + pendingSamplesRef.current) /
              ctx.sampleRate) *
            1000;
          const offset = now - timeOriginRef.current - sampleMs;

          const chunkOffset = chunkOffsetRef.current;
          const pending = pendingBreakRef.current;
          if (chunkOffset === null) {
            chunkOffsetRef.current = offset;
          } else if (pending) {
            pending.offsetMs = Math.min(pending.offsetMs, offset);
            if (pending.offsetMs <= chunkOffset + DISCONTINUITY_MS) {
              // The main thread was busy and the backlog caught up - no
              // audio time was lost.
              pendingBreakRef.current = null;
              chunkOffsetRef.current = Math.min(chunkOffset, pending.offsetMs);
            } else if (now - pending.seenAt >= DISCONTINUITY_CONFIRM_MS) {
              splitAtBreak(pending);
            }
          } else if (offset > chunkOffset + DISCONTINUITY_MS) {
            pendingBreakRef.current = {
              frameIndex: framesRef.current.length - 1,
              samplesBefore: pendingSamplesRef.current - ch.length,
              offsetMs: offset,
              seenAt: now,
            };
          } else {
            chunkOffsetRef.current = Math.min(chunkOffset, offset);
          }

          if (
            !pendingBreakRef.current &&
            pendingSamplesRef.current >= flushThreshold
          ) {
            flush();
          }
        };

        connectStream(stream);
      } catch (err) {
        runningRef.current = false;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("[PcmCapture] start failed:", error);
        onError?.(error);
        // Best-effort cleanup of anything that did open.
        await teardown();
      }
    },
    [connectStream, flush, onError, openStream, splitAtBreak, teardown],
  );

  const switchDevice = useCallback(
    async (source: PcmSource) => {
      if (!runningRef.current || !ctxRef.current) return;
      // A processed call track (noise filter) reports no device - keep the
      // mic we have rather than falling back to the system default.
      if (!isIos() && (!source.audioId || source.audioId === deviceIdRef.current)) {
        return;
      }
      try {
        const stream = await openStream(source);
        if (!runningRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        deviceIdRef.current = source.audioId;
        connectStream(stream);
      } catch (error) {
        // Keep recording the previous device rather than nothing.
        console.error("[PcmCapture] mic switch failed, keeping the old mic:", error);
      }
    },
    [connectStream, openStream],
  );

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    for (const track of streamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }, []);

  const setPaused = useCallback(
    (paused: boolean) => {
      if (pausedRef.current === paused) return;
      // End the chunk at the pause, so no chunk spans it.
      if (paused && runningRef.current) {
        try {
          flushAll();
        } catch (err) {
          console.error("[PcmCapture] flush on pause failed:", err);
        }
      }
      pausedRef.current = paused;
    },
    [flushAll],
  );

  const stop = useCallback(async () => {
    if (!runningRef.current && !ctxRef.current) return;
    runningRef.current = false;

    // Flush the final partial chunk BEFORE tearing anything down.
    try {
      flushAll();
    } catch (err) {
      console.error("[PcmCapture] final flush failed:", err);
    }

    await teardown();
  }, [flushAll, teardown]);

  const getChunkCount = useCallback(() => seqRef.current, []);
  const isRunning = useCallback(() => runningRef.current, []);

  return {
    start,
    stop,
    switchDevice,
    setMuted,
    setPaused,
    getChunkCount,
    isRunning,
  };
}
