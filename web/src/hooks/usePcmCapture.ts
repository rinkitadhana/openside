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
 * pristine. We never route the worklet node to ctx.destination, so nothing is
 * monitored/played back (no feedback loop).
 *
 * CLOCK:
 * Chunk timing is derived from the ACTUAL captured sample count against
 * ctx.sampleRate - never a hardcoded requested rate, because hardware may ignore
 * it. ctx.currentTime at start is kept as the PCM clock baseline for
 * future drift correction against the video's performance.now clock (see the
 * finalization-service TODO - not implemented yet).
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

interface UsePcmCaptureReturn {
  /** Open a dedicated mic stream and begin capturing the requested PCM master. */
  start: (options?: PcmCaptureStartOptions) => Promise<void>;
  /** Flush the final partial chunk, tear down the graph, and close the context. */
  stop: () => Promise<void>;
  /** ctx.currentTime captured at start - the PCM clock baseline (drift stub). */
  getClockBaseline: () => number | null;
}

export interface PcmCaptureStartOptions {
  audioId?: string;
  sampleRate?: 44100 | 48000;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  echoCancellation?: boolean;
}

/** Flush a chunk roughly every 5 seconds of captured audio. */
const FLUSH_INTERVAL_SECONDS = 5;

/** 2^23 - 1: full-scale for signed 24-bit. */
const INT24_MAX = 8388607;

export default function usePcmCapture({
  onPcmChunk,
  onError,
}: UsePcmCaptureOptions): UsePcmCaptureReturn {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);

  // Accumulated Float32 frames pending flush.
  const framesRef = useRef<Float32Array[]>([]);
  const pendingSamplesRef = useRef(0);
  // Total samples already flushed - the chunk-start clock, measured off the
  // actual sample count so it stays exact even if the hardware rate drifts.
  const emittedSamplesRef = useRef(0);
  const seqRef = useRef(0);
  // ctx.currentTime at capture start - PCM clock baseline for drift correction.
  const clockBaselineRef = useRef<number | null>(null);
  const runningRef = useRef(false);

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
    const startMs = (emittedSamplesRef.current / sampleRate) * 1000;
    const durationMs = (total / sampleRate) * 1000;
    emittedSamplesRef.current += total;

    const blob = new Blob([bytes], { type: "audio/pcm-raw" });
    onPcmChunk(blob, {
      sequenceNumber: seqRef.current,
      startMs,
      durationMs,
      sampleRate,
      bitDepth: 24,
      channelCount: 1,
    });
    seqRef.current += 1;
  }, [onPcmChunk]);

  const start = useCallback(
    async (options: PcmCaptureStartOptions = {}) => {
      if (runningRef.current) return;
      runningRef.current = true;

      try {
        // The PCM master owns its own DSP controls, completely separate from
        // LiveKit's call stream. Defaults remain DSP-off for a pristine master.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(options.audioId ? { deviceId: { exact: options.audioId } } : {}),
            echoCancellation: options.echoCancellation ?? false,
            noiseSuppression: options.noiseSuppression ?? false,
            autoGainControl: options.autoGainControl ?? false,
            channelCount: 1,
            sampleRate: options.sampleRate ?? 48000,
          },
        });
        streamRef.current = stream;

        const ctx = new AudioContext({
          sampleRate: options.sampleRate ?? 48000,
          latencyHint: "playback",
        });
        ctxRef.current = ctx;

        await ctx.audioWorklet.addModule("/pcm-worklet.js");

        const micTrack = stream.getAudioTracks()[0];
        const source = ctx.createMediaStreamSource(
          new MediaStream([micTrack]),
        );
        sourceRef.current = source;

        const node = new AudioWorkletNode(ctx, "pcm-worklet");
        nodeRef.current = node;

        clockBaselineRef.current = ctx.currentTime;
        emittedSamplesRef.current = 0;
        seqRef.current = 0;
        framesRef.current = [];
        pendingSamplesRef.current = 0;

        const flushThreshold = Math.round(FLUSH_INTERVAL_SECONDS * ctx.sampleRate);
        node.port.onmessage = (event) => {
          const ch = event.data as Float32Array;
          framesRef.current.push(ch);
          pendingSamplesRef.current += ch.length;
          if (pendingSamplesRef.current >= flushThreshold) flush();
        };

        // Drive the worklet WITHOUT monitoring: connect source -> node only. Do
        // NOT connect node -> ctx.destination (that would play the mic back and
        // create a feedback loop).
        source.connect(node);
      } catch (err) {
        runningRef.current = false;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("[PcmCapture] start failed:", error);
        onError?.(error);
        // Best-effort cleanup of anything that did open.
        try {
          nodeRef.current?.port.close();
          nodeRef.current?.disconnect();
          sourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        for (const track of streamRef.current?.getTracks() ?? []) {
          track.stop();
        }
        await ctxRef.current?.close().catch(() => undefined);
        nodeRef.current = null;
        sourceRef.current = null;
        streamRef.current = null;
        ctxRef.current = null;
      }
    },
    [flush, onError],
  );

  const stop = useCallback(async () => {
    if (!runningRef.current && !ctxRef.current) return;
    runningRef.current = false;

    // Flush the final partial chunk BEFORE tearing anything down.
    try {
      flush();
    } catch (err) {
      console.error("[PcmCapture] final flush failed:", err);
    }

    try {
      nodeRef.current?.port.close();
      nodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    try {
      await ctxRef.current?.close();
    } catch {
      /* ignore */
    }

    nodeRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  }, [flush]);

  const getClockBaseline = useCallback(() => clockBaselineRef.current, []);

  return { start, stop, getClockBaseline };
}
