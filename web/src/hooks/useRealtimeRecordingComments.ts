import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import type { RecordingComment } from "@/hooks/useScreenRecordings";

type CommentQuery = "shared" | "screen";

/** Subscribe to the share-token-protected live comment channel. */
export const useRealtimeRecordingComments = (
  shareToken: string | null | undefined,
  query: CommentQuery,
  recordingId?: string,
) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!shareToken) return;

    const socket = io(
      import.meta.env.VITE_API_SOCKET_URL || "http://localhost:4000",
      { transports: ["websocket", "polling"] },
    );
    const queryKey =
      query === "shared"
        ? ["shared-comments", shareToken]
        : ["screen-comments", recordingId];
    const addComment = (comment: RecordingComment) => {
      queryClient.setQueryData<RecordingComment[]>(queryKey, (comments) => {
        const current = comments ?? [];
        // A successful POST has already added the author's comment locally.
        return current.some(({ id }) => id === comment.id)
          ? current
          : [...current, comment];
      });
    };

    socket.on("connect", () => {
      socket.emit("join-recording-comments", shareToken, () => {
        // Covers the short period between the initial HTTP request and the
        // socket joining its room, including reconnects after a network blip.
        void queryClient.invalidateQueries({ queryKey });
      });
    });
    socket.on("recording-comment-created", addComment);

    return () => {
      socket.disconnect();
    };
  }, [query, queryClient, recordingId, shareToken]);
};
