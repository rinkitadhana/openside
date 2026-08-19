import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import api from "@/lib/axiosInstance";
import { toast } from "@/lib/toast";

export type ScreenOutputKind = "screen" | "screenAligned" | "camera" | "both";

export interface ScreenRecording {
  id: string;
  title: string | null;
  description: string | null;
  status: "ACTIVE" | "STOPPED" | "PROCESSING" | "READY" | "FAILED";
  startedAt: string;
  stoppedAt: string | null;
  outputs: Partial<
    Record<ScreenOutputKind, { key: string; durationMs?: number }>
  > | null;
  /** Non-null once the owner turned on public sharing; the public link id. */
  shareToken: string | null;
  createdAt: string;
  _count?: { comments: number };
}

export interface RecordingComment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** Null for anonymous share-link commenters. */
  user: { id: string; avatar: string | null } | null;
}

export const useScreenRecordings = () => {
  const { isLoaded, isSignedIn } = useClerkAuth();

  return useQuery({
    queryKey: ["screen-recordings"],
    queryFn: async () => {
      const { data } = await api.get("/recording/screen/recordings");
      return data.data.recordings as ScreenRecording[];
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 15000,
    retry: false,
    // Poll while anything is still being stitched/processed.
    refetchInterval: (query) => {
      const recs = query.state.data as ScreenRecording[] | undefined;
      const pending = recs?.some(
        (r) =>
          r.status === "ACTIVE" ||
          r.status === "PROCESSING" ||
          r.status === "STOPPED",
      );
      return pending ? 4000 : false;
    },
  });
};

export const useRenameScreenRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      title,
    }: {
      sessionId: string;
      title: string;
    }) => {
      const { data } = await api.patch(`/recording/screen/${sessionId}`, {
        title,
      });
      return data.data as { id: string; title: string };
    },
    // Optimistic: retitle in the cached list instantly, roll back on failure.
    onMutate: async ({ sessionId, title }) => {
      await queryClient.cancelQueries({ queryKey: ["screen-recordings"] });
      const previous = queryClient.getQueryData<ScreenRecording[]>([
        "screen-recordings",
      ]);
      queryClient.setQueryData<ScreenRecording[]>(
        ["screen-recordings"],
        (recs) =>
          recs?.map((rec) => (rec.id === sessionId ? { ...rec, title } : rec)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(["screen-recordings"], context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["screen-recordings"] });
    },
  });
};

export const useDeleteScreenRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/recording/screen/${sessionId}`);
    },
    // Optimistic: drop it from the cached list immediately so the card/detail
    // page disappears on click, and let the request (which also purges the
    // stored objects, so it can be slow) finish in the background. The
    // rollback lives here rather than in a mutate() callback because the
    // caller usually navigates away instantly - only useMutation's own
    // callbacks are guaranteed to run after its component unmounts.
    onMutate: async (sessionId) => {
      await queryClient.cancelQueries({ queryKey: ["screen-recordings"] });
      const previous = queryClient.getQueryData<ScreenRecording[]>([
        "screen-recordings",
      ]);
      queryClient.setQueryData<ScreenRecording[]>(
        ["screen-recordings"],
        (recs) => recs?.filter((rec) => rec.id !== sessionId),
      );
      return { previous };
    },
    onError: (_error, _sessionId, context) => {
      queryClient.setQueryData(["screen-recordings"], context?.previous);
      toast.error("Couldn't delete that recording - it's back in your list.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["screen-recordings"] });
    },
  });
};

/** Turn on sharing (or re-read the existing link) for a recording. */
export const useShareScreenRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data } = await api.post(`/recording/screen/${sessionId}/share`, {});
      return data.data as { shareToken: string };
    },
    onSuccess: ({ shareToken }, sessionId) => {
      queryClient.setQueryData<ScreenRecording[]>(["screen-recordings"], (recs) =>
        recs?.map((rec) =>
          rec.id === sessionId ? { ...rec, shareToken } : rec,
        ),
      );
    },
  });
};

/** Revoke the link. Anyone holding the old URL loses access immediately. */
export const useUnshareScreenRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/recording/screen/${sessionId}/share`);
    },
    onSuccess: (_data, sessionId) => {
      queryClient.setQueryData<ScreenRecording[]>(["screen-recordings"], (recs) =>
        recs?.map((rec) =>
          rec.id === sessionId ? { ...rec, shareToken: null } : rec,
        ),
      );
    },
  });
};

/** Comments on a recording, read as its owner. */
export const useScreenComments = (sessionId: string, enabled = true) =>
  useQuery({
    queryKey: ["screen-comments", sessionId],
    queryFn: async () => {
      const { data } = await api.get(`/recording/screen/${sessionId}/comments`);
      return data.data.comments as RecordingComment[];
    },
    enabled: enabled && !!sessionId,
    staleTime: 15000,
    retry: false,
  });

export const useCreateScreenComment = (sessionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: string) => {
      const { data } = await api.post(
        `/recording/screen/${sessionId}/comments`,
        { body },
      );
      return data.data.comment as RecordingComment;
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<RecordingComment[]>(
        ["screen-comments", sessionId],
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

export const useDeleteScreenComment = (sessionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (commentId: string) => {
      await api.delete(`/recording/screen/comment/${commentId}`);
      return commentId;
    },
    onSuccess: (commentId) => {
      queryClient.setQueryData<RecordingComment[]>(
        ["screen-comments", sessionId],
        (comments) => comments?.filter((c) => c.id !== commentId),
      );
    },
  });
};

/**
 * Cached playback URL for a screen output. Held long enough that revisiting the
 * page reuses the same URL and the browser serves the thumbnail from its HTTP
 * cache rather than re-fetching and re-downloading.
 */
export const useScreenOutputUrl = (
  sessionId: string,
  kind: ScreenOutputKind | undefined,
) => {
  return useQuery({
    queryKey: ["screen-output-url", sessionId, kind],
    queryFn: async () => fetchScreenOutputUrl(sessionId, kind!, false),
    enabled: !!sessionId && !!kind,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    retry: false,
  });
};

/** Presigned URL for an output - inline for playback, attachment for download. */
export async function fetchScreenOutputUrl(
  sessionId: string,
  kind: ScreenOutputKind,
  download = false,
): Promise<string> {
  const { data } = await api.get(
    `/recording/screen/${sessionId}/output/${kind}/url`,
    { params: { download: download ? 1 : 0 } },
  );
  return data.data.url as string;
}
