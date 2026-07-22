/**
 * Public share-link hooks.
 *
 * These talk to the /recording/shared/:token endpoints, which need no account -
 * holding the token is the authorization. `api` still attaches a Clerk token
 * when the visitor happens to be signed in, which is what lets the server
 * attribute their comment to their account instead of a typed-in name.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import type {
  RecordingComment,
  ScreenOutputKind,
} from "@/hooks/useScreenRecordings";

export interface SharedRecording {
  id: string;
  source: "SCREEN_RECORDER" | "SPACE";
  title: string | null;
  description: string | null;
  status: "ACTIVE" | "STOPPED" | "PROCESSING" | "READY" | "FAILED";
  startedAt: string;
  stoppedAt: string | null;
  ownerName: string | null;
  /** Output kinds that exist. The server never sends storage keys here. */
  kinds: ScreenOutputKind[];
  /** Ready, playable tracks for a Space recording. */
  tracks: Array<{
    id: string;
    title: string;
    mimeType: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    bitrate: number | null;
    hasVideo: boolean;
    hasAudio: boolean;
    isScreenShare: boolean;
    alignedOutputId: string | null;
    cloudOutputId: string | null;
    cloudHasVideo: boolean;
    cloudHasAudio: boolean;
  }>;
}

export const useSharedRecording = (token: string) =>
  useQuery({
    queryKey: ["shared-recording", token],
    queryFn: async () => {
      const { data } = await api.get(`/recording/shared/${token}`);
      return data.data.recording as SharedRecording;
    },
    enabled: !!token,
    staleTime: 30000,
    retry: false,
  });

/** Presigned URL for a shared output - inline for playback, attachment for download. */
export async function fetchSharedOutputUrl(
  token: string,
  kind: ScreenOutputKind,
  download = false,
): Promise<string> {
  const { data } = await api.get(
    `/recording/shared/${token}/output/${kind}/url`,
    { params: { download: download ? 1 : 0 } },
  );
  return data.data.url as string;
}

/** URL for one ready track of a shared Space recording. */
export async function fetchSharedFinalOutputUrl(
  token: string,
  outputId: string,
  download = false,
): Promise<string> {
  const { data } = await api.get(
    `/recording/shared/${token}/final-output/${outputId}/url`,
    { params: { download: download ? 1 : 0 } },
  );
  return data.data.url as string;
}

export type SharedDownloadResult = {
  ready: boolean;
  url?: string;
  format: "webm" | "mp4" | "mp3" | "wav";
  error?: string;
};

/** Request a shared Space track in a specific format. Derived formats may need
 * a short preparation period, just like downloads in the private project. */
export async function fetchSharedFinalOutputDownload(
  token: string,
  outputId: string,
  format: SharedDownloadResult["format"],
): Promise<SharedDownloadResult> {
  const { data } = await api.get(
    `/recording/shared/${token}/final-output/${outputId}/download`,
    { params: { format } },
  );
  return data.data as SharedDownloadResult;
}

export const useSharedOutputUrl = (
  token: string,
  kind: ScreenOutputKind | undefined,
) =>
  useQuery({
    queryKey: ["shared-output-url", token, kind],
    queryFn: async () => fetchSharedOutputUrl(token, kind as ScreenOutputKind),
    enabled: !!token && !!kind,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    retry: false,
  });

export const useSharedFinalOutputUrl = (
  token: string,
  outputId: string | undefined,
) =>
  useQuery({
    queryKey: ["shared-final-output-url", token, outputId],
    queryFn: async () =>
      fetchSharedFinalOutputUrl(token, outputId as string),
    enabled: !!token && !!outputId,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    retry: false,
  });

export const useSharedComments = (token: string) =>
  useQuery({
    queryKey: ["shared-comments", token],
    queryFn: async () => {
      const { data } = await api.get(`/recording/shared/${token}/comments`);
      return data.data.comments as RecordingComment[];
    },
    enabled: !!token,
    staleTime: 15000,
    retry: false,
  });

export const useCreateSharedComment = (token: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { body: string; authorName?: string }) => {
      const { data } = await api.post(`/recording/shared/${token}/comments`, {
        body: input.body,
        authorName: input.authorName,
      });
      return data.data.comment as RecordingComment;
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<RecordingComment[]>(
        ["shared-comments", token],
        (comments) => {
          const current = comments ?? [];
          return current.some(({ id }) => id === comment.id)
            ? current
            : [...current, comment];
        },
      );
    },
  });
};
