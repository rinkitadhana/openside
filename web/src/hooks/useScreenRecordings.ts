import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import api from "@/lib/axiosInstance";
import { toast } from "@/lib/toast";
import { useGetMe, type MeUser } from "@/hooks/useUserQuery";

/** "preview" is a quick, un-encoded copy shown while the final video renders. */
export type ScreenOutputKind =
  | "screen"
  | "screenAligned"
  | "camera"
  | "both"
  | "preview";

export interface ScreenRecording {
  id: string;
  title: string | null;
  description: string | null;
  status: "ACTIVE" | "STOPPED" | "PROCESSING" | "READY" | "FAILED";
  startedAt: string;
  stoppedAt: string | null;
  outputs: Partial<
    Record<
      ScreenOutputKind,
      {
        key: string;
        durationMs?: number;
        // Absent on takes finalized before these were recorded.
        width?: number;
        height?: number;
        fps?: number;
      }
    >
  > | null;
  /** Non-null once the owner turned on public sharing; the public link id. */
  shareToken: string | null;
  /** Share-page opens by anyone other than the owner. */
  viewCount: number;
  /** Made from an uploaded video file, not a live capture. */
  uploaded?: boolean;
  createdAt: string;
  _count?: { comments: number };
}

export interface RecordingComment {
  id: string;
  authorName: string;
  body: string;
  /** Playback position the comment was left at; null if not tied to one. */
  timestampMs: number | null;
  /** Set on replies: the top-level comment of the thread. */
  parentId: string | null;
  editedAt: string | null;
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

/** Change a recording's title and/or description (a blank one clears it). */
export const useUpdateScreenRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      ...changes
    }: {
      sessionId: string;
      title?: string;
      description?: string;
    }) => {
      const { data } = await api.patch(
        `/recording/screen/${sessionId}`,
        changes,
      );
      return data.data as {
        id: string;
        title: string;
        description: string | null;
      };
    },
    // Optimistic: update the cached list instantly, roll back on failure.
    onMutate: async ({ sessionId, ...changes }) => {
      await queryClient.cancelQueries({ queryKey: ["screen-recordings"] });
      const previous = queryClient.getQueryData<ScreenRecording[]>([
        "screen-recordings",
      ]);
      queryClient.setQueryData<ScreenRecording[]>(
        ["screen-recordings"],
        (recs) =>
          recs?.map((rec) =>
            rec.id === sessionId
              ? {
                  ...rec,
                  ...(changes.title !== undefined && { title: changes.title }),
                  ...(changes.description !== undefined && {
                    description: changes.description || null,
                  }),
                }
              : rec,
          ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(["screen-recordings"], context?.previous);
      toast.error("Couldn't save your changes.");
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
      const { data } = await api.post(
        `/recording/screen/${sessionId}/share`,
        {},
      );
      return data.data as { shareToken: string };
    },
    onSuccess: ({ shareToken }, sessionId) => {
      queryClient.setQueryData<ScreenRecording[]>(
        ["screen-recordings"],
        (recs) =>
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
      queryClient.setQueryData<ScreenRecording[]>(
        ["screen-recordings"],
        (recs) =>
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

/** Optimistic comments carry this id prefix until the server's row lands. */
export const PENDING_COMMENT_PREFIX = "pending-";

export const isPendingComment = (comment: RecordingComment) =>
  comment.id.startsWith(PENDING_COMMENT_PREFIX);

/**
 * Optimistic create, shared by the owner and share-page hooks: the comment
 * shows at once, is swapped for the server's row on success (in place, or
 * dropped if the live socket already delivered it), and removed on failure.
 */
export const optimisticCommentHandlers = (
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  me: MeUser | null | undefined,
) => ({
  onMutate: async (input: {
    body: string;
    authorName?: string;
    timestampMs: number | null;
    parentId?: string;
  }) => {
    await queryClient.cancelQueries({ queryKey });
    const pending: RecordingComment = {
      id: `${PENDING_COMMENT_PREFIX}${crypto.randomUUID()}`,
      authorName: me?.name?.trim() || input.authorName || "You",
      body: input.body,
      timestampMs: input.timestampMs,
      parentId: input.parentId ?? null,
      editedAt: null,
      createdAt: new Date().toISOString(),
      user: me ? { id: me.id, avatar: me.avatar ?? null } : null,
    };
    queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) => [
      ...(comments ?? []),
      pending,
    ]);
    return { pendingId: pending.id };
  },
  onSuccess: (
    comment: RecordingComment,
    _input: unknown,
    context: { pendingId: string } | undefined,
  ) => {
    queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) => {
      const current = comments ?? [];
      if (current.some(({ id }) => id === comment.id)) {
        return current.filter(({ id }) => id !== context?.pendingId);
      }
      return current.some(({ id }) => id === context?.pendingId)
        ? current.map((c) => (c.id === context?.pendingId ? comment : c))
        : [...current, comment];
    });
  },
  onError: (
    _error: unknown,
    _input: unknown,
    context: { pendingId: string } | undefined,
  ) => {
    queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) =>
      comments?.filter(({ id }) => id !== context?.pendingId),
    );
    toast.error("Couldn't post your comment. Try again.");
  },
});

export const useCreateScreenComment = (sessionId: string) => {
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();

  return useMutation({
    mutationFn: async (input: {
      body: string;
      timestampMs: number | null;
      parentId?: string;
    }) => {
      const { data } = await api.post(
        `/recording/screen/${sessionId}/comments`,
        input,
      );
      return data.data.comment as RecordingComment;
    },
    ...optimisticCommentHandlers(
      queryClient,
      ["screen-comments", sessionId],
      me,
    ),
  });
};

/**
 * Edit a comment's text (authors only). Optimistic: the new text shows at
 * once and reverts on failure. `queryKey` is the comment list it lives in.
 */
export const useEditRecordingComment = (queryKey: readonly unknown[]) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { commentId: string; body: string }) => {
      const { data } = await api.patch(
        `/recording/screen/comment/${input.commentId}`,
        { body: input.body },
      );
      return data.data.comment as RecordingComment;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<RecordingComment[]>(queryKey);
      queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) =>
        comments?.map((c) =>
          c.id === input.commentId
            ? { ...c, body: input.body, editedAt: new Date().toISOString() }
            : c,
        ),
      );
      return { previous };
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) =>
        comments?.map((c) => (c.id === comment.id ? comment : c)),
      );
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error("Couldn't save your edit.");
    },
  });
};

/**
 * Delete a comment. Optimistic: it disappears at once (replies to it stay,
 * just without the quote) and comes back on failure. `queryKey` is the
 * comment list it lives in.
 */
export const useDeleteRecordingComment = (queryKey: readonly unknown[]) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (commentId: string) => {
      await api.delete(`/recording/screen/comment/${commentId}`);
      return commentId;
    },
    onMutate: async (commentId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<RecordingComment[]>(queryKey);
      queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) =>
        comments
          ?.filter((c) => c.id !== commentId)
          .map((c) =>
            c.parentId === commentId ? { ...c, parentId: null } : c,
          ),
      );
      return { previous };
    },
    onError: (_error, _commentId, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error("Couldn't delete that comment.");
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
