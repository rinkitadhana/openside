/**
 * MediaRecorder codec selection + runtime fallback.
 *
 * WHY THIS EXISTS:
 * `MediaRecorder.isTypeSupported()` returns FALSE POSITIVES - it can report a
 * codec as supported, then throw `EncodingError` once real frames arrive (common
 * at 4K where a hardware encoder rejects the config, or software init fails).
 * Picking one codec with no fallback means a runtime encoder failure silently
 * kills the whole recording. This is the pattern Pipe uses across millions of
 * production recordings: try the preferred codec, catch EncodingError, restart
 * with a safer codec - but only BEFORE any data has been captured (a mid-stream
 * codec change produces an unplayable file).
 *
 * CODEC LADDER:
 * Prefer hardware H.264 at the 4K-capable LEVEL. `avc1.640028` is High/Level 4.0
 * (1080p max) - WRONG for 4K. `avc1.640033` is High/Level 5.1, correct for 4K30.
 */

export interface MimeCandidate {
  mimeType: string;
  codec: string;
  container: string;
}

/** Ordered by preference. Filtered by isTypeSupported() at selection time. */
export const VIDEO_MIME_CANDIDATES: MimeCandidate[] = [
  {
    mimeType: "video/mp4;codecs=avc1.640033,mp4a.40.2",
    codec: "h264",
    container: "mp4",
  },
  { mimeType: "video/x-matroska;codecs=avc1,opus", codec: "h264", container: "mkv" },
  { mimeType: "video/webm;codecs=h264,opus", codec: "h264", container: "webm" },
  { mimeType: "video/webm;codecs=vp9,opus", codec: "vp9", container: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", codec: "vp8", container: "webm" },
  { mimeType: "video/webm", codec: "vp8", container: "webm" },
];

/** Last-resort candidate: empty mimeType lets the browser pick its own default,
 *  so the supported list is never empty and start() always has something to try. */
const BROWSER_DEFAULT_CANDIDATE: MimeCandidate = {
  mimeType: "",
  codec: "unknown",
  container: "webm",
};

/**
 * The FULL ORDERED list of candidates this browser reports as supported, with a
 * guaranteed browser-default last resort appended. Order is preserved so the
 * runtime fallback can walk down it. (Not first-match - the whole point is that
 * isTypeSupported lies, so callers need the remaining options to fall back to.)
 */
export function getSupportedVideoMimeTypes(): MimeCandidate[] {
  const supported =
    typeof MediaRecorder === "undefined"
      ? []
      : VIDEO_MIME_CANDIDATES.filter((t) =>
          MediaRecorder.isTypeSupported(t.mimeType),
        );
  return [...supported, BROWSER_DEFAULT_CANDIDATE];
}

/** The single preferred (first supported) candidate - for recorders that don't
 *  run the full fallback loop (e.g. secondary screen-share tracks). */
export function firstSupportedVideoMime(): MimeCandidate {
  return getSupportedVideoMimeTypes()[0] ?? BROWSER_DEFAULT_CANDIDATE;
}

/**
 * Classify a MediaRecorder `error` event. EncodingError (by name) is the codec
 * false-positive we fall back on; we also match the known Chrome messages, which
 * historically surfaced as generic errors without the EncodingError name.
 */
export function classifyRecorderError(event: Event): {
  isEncodingError: boolean;
  name: string;
  message: string;
} {
  const err =
    (event as unknown as { error?: DOMException | null }).error ?? null;
  const name = err?.name ?? "";
  const message = err?.message ?? "";
  const isEncodingError =
    name === "EncodingError" ||
    /video encoding failed|encoder initialization failed|encoder configuration is not supported/i.test(
      message,
    );
  return { isEncodingError, name, message };
}

export interface RecorderFallbackHandlers {
  /** Fired for the initial recorder AND after every before-data fallback swap,
   *  so the caller updates its recorder ref + metadata to the ACTIVE codec. */
  onActiveRecorder: (recorder: MediaRecorder, candidate: MimeCandidate) => void;
  /** A non-empty timeslice chunk arrived. */
  onData: (blob: Blob) => void;
  /** First chunk of the committed codec (fires once) - the codec has "won". */
  onFirstData?: (recorder: MediaRecorder, candidate: MimeCandidate) => void;
  /** Encoder failed AFTER data was captured. A codec swap now would corrupt the
   *  file, so the caller should finalize/SAVE what exists and warn (non-fatal). */
  onMidSessionFailure: (error: Error) => void;
  /** Every candidate failed before producing any data - nothing was recorded. */
  onFatal: (error: Error) => void;
}

/**
 * Build + start a MediaRecorder with automatic codec fallback.
 *
 * - onerror is attached BEFORE start().
 * - Before any data: an EncodingError (or a synchronous construct/start throw)
 *   transparently walks down to the next candidate - the user shouldn't notice.
 *   The list is walked ONCE, never infinitely.
 * - After data: the codec is committed; any error triggers onMidSessionFailure
 *   (save what was captured) instead of a codec switch.
 *
 * Returns true if an initial recorder started; false if none could start at all
 * (in which case onFatal has also fired).
 */
export function startRecorderWithFallback(params: {
  stream: MediaStream;
  candidates: MimeCandidate[];
  recorderOptions: Omit<MediaRecorderOptions, "mimeType">;
  timesliceMs: number;
  handlers: RecorderFallbackHandlers;
}): boolean {
  const { stream, candidates, recorderOptions, timesliceMs, handlers } = params;
  let dataStarted = false;

  const detach = (recorder: MediaRecorder) => {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* already stopped/failed */
    }
  };

  const startFrom = (index: number): boolean => {
    for (let i = index; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!candidate) continue;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...recorderOptions,
          mimeType: candidate.mimeType || undefined,
        });
      } catch (err) {
        console.warn(
          `[recorder] construct failed for "${candidate.mimeType || "browser default"}":`,
          err,
        );
        continue;
      }

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        if (!dataStarted) {
          dataStarted = true;
          console.log("[recorder] active codec:", recorder.mimeType);
          handlers.onFirstData?.(recorder, candidate);
        }
        handlers.onData(event.data);
      };

      recorder.onerror = (event) => {
        const { isEncodingError, name, message } = classifyRecorderError(event);

        // After data: never switch codecs (a mid-stream change yields an
        // unplayable file). Save whatever was captured.
        if (dataStarted) {
          handlers.onMidSessionFailure(
            new Error(
              `Encoder failed mid-recording${name ? ` (${name})` : ""}; saved footage captured so far.`,
            ),
          );
          return;
        }

        // Before data, non-encoding error: nothing to recover from here.
        if (!isEncodingError) {
          handlers.onFatal(
            new Error(
              `MediaRecorder error before any data${name ? ` (${name})` : ""}: ${message}`,
            ),
          );
          return;
        }

        // Before data + EncodingError (the isTypeSupported false positive):
        // walk to the next candidate.
        console.warn(
          `[recorder] "${candidate.mimeType || "browser default"}" failed before data (${name || "EncodingError"}); falling back to next codec`,
        );
        detach(recorder);
        if (!startFrom(i + 1)) {
          handlers.onFatal(new Error("All video codecs failed to initialize"));
        }
      };

      handlers.onActiveRecorder(recorder, candidate);
      try {
        recorder.start(timesliceMs);
      } catch (err) {
        console.warn(
          `[recorder] start() threw for "${candidate.mimeType || "browser default"}":`,
          err,
        );
        detach(recorder);
        continue;
      }
      return true;
    }
    return false;
  };

  const started = startFrom(0);
  if (!started) {
    handlers.onFatal(
      new Error("No supported video codec could start the recorder"),
    );
  }
  return started;
}
