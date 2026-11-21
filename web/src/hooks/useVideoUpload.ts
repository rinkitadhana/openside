/**
 * HOOK: useVideoUpload
 *
 * Upload a video file the user already has (e.g. a screen recording made
 * elsewhere) as a screen-recorder take, so it gets the same project page,
 * share link and comments as a live recording:
 *   1. POST /recording/screen/upload/start - an already-stopped session with
 *      one VIDEO track.
 *   2. Slice the file into chunks; for each: presign → PUT to R2 → register
 *      the segment (the same screen endpoints the recorder uses).
 *   3. Mark the track complete - the server encodes it into the take's output.
 */

import { useCallback, useState } from "react";
import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import { putWithProgress } from "./useChunkUploader";

/** Under the server's 100 MB per-segment cap. */
const CHUNK_BYTES = 32 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;
export const UPLOAD_ACCEPT =
  "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv";
const EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const CONTENT_TYPE = "application/octet-stream";

export type VideoUploadState = "idle" | "uploading" | "error";

export class UploadError extends Error {}

function extOf(file: File): string | null {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && EXTS.has(fromName)) return fromName;
  if (file.type === "video/mp4") return "mp4";
  if (file.type === "video/quicktime") return "mov";
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/x-matroska") return "mkv";
  return null;
}

/** The file's frame size, read from its metadata (null if the browser can't). */
function readVideoSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (size: { width: number; height: number } | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(size);
    };
    const timer = window.setTimeout(() => done(null), 5000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done(
        video.videoWidth > 0 && video.videoHeight > 0
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      );
    video.onerror = () => done(null);
    video.src = url;
  });
}

async function withRetries<T>(call: () => Promise<T>, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      // A rejected request won't start working on retry.
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status && status >= 400 && status < 500 && status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

function messageOf(error: unknown): string {
  if (error instanceof UploadError) return error.message;
  if (isAxiosError(error)) {
    if (
      error.response?.status === 402 &&
      error.response.data?.data?.code === "USAGE_EXHAUSTED"
    ) {
      return "You're out of recording credit. Upgrade to Pro to keep uploading.";
    }
    const message = error.response?.data?.message;
    if (typeof message === "string" && message) return message;
  }
  return "Upload failed - please try again.";
}

export default function useVideoUpload() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<VideoUploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** Resolves with the new recording's session id. */
  const upload = useCallback(
    async (file: File): Promise<string> => {
      setState("uploading");
      setProgress(0);
      setError(null);
      try {
        const ext = extOf(file);
        if (!ext) {
          throw new UploadError("Upload an MP4, MOV, WebM or MKV video.");
        }
        if (file.size <= 0) throw new UploadError("That file is empty.");
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new UploadError("Videos can be at most 5 GB.");
        }

        const size = await readVideoSize(file);
        const title = file.name.replace(/\.[^.]+$/, "").trim();
        const start = await api.post("/recording/screen/upload/start", {
          spaceRecordingSessionId: `upl_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          title,
          ext,
          sizeBytes: file.size,
          width: size?.width,
          height: size?.height,
        });
        const sessionId: string = start.data.data.session.id;
        const recordingId: string = start.data.data.recordingId;

        const total = Math.ceil(file.size / CHUNK_BYTES);
        let sentBytes = 0;
        for (let seq = 0; seq < total; seq++) {
          const blob = file.slice(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
          await withRetries(async () => {
            const presign = await api.post(
              "/recording/screen/segment/presign",
              {
                participantRecordingId: recordingId,
                trackType: "combined",
                sequenceNumber: seq,
                contentType: CONTENT_TYPE,
                ext,
                sizeBytes: blob.size,
              },
            );
            const { uploadUrl, assetKey } = presign.data.data;
            await putWithProgress(uploadUrl, blob, CONTENT_TYPE, (fraction) =>
              setProgress((sentBytes + fraction * blob.size) / file.size),
            );
            await api
              .post("/recording/screen/segment", {
                participantRecordingId: recordingId,
                spaceRecordingSessionId: sessionId,
                sequenceNumber: seq,
                assetKey,
                startMs: 0,
                durationMs: 0,
                sizeBytes: blob.size,
              })
              .catch((error) => {
                // Registered by an earlier attempt whose response was lost.
                if (isAxiosError(error) && error.response?.status === 409) {
                  return;
                }
                throw error;
              });
          });
          sentBytes += blob.size;
          setProgress(sentBytes / file.size);
        }

        await withRetries(() =>
          api.post(`/recording/screen/recording/${recordingId}/complete`, {
            expectedSegments: total,
            width: size?.width,
            height: size?.height,
          }),
        );

        void queryClient.invalidateQueries({ queryKey: ["screen-recordings"] });
        setState("idle");
        return sessionId;
      } catch (err) {
        const message = messageOf(err);
        setError(message);
        setState("error");
        throw new UploadError(message);
      }
    },
    [queryClient],
  );

  return { upload, state, progress, error };
}
