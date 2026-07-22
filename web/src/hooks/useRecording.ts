import {
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import type { FinalOutput } from "@/types/outputTypes";
import type {
  StartSessionPayload,
  StopSessionPayload,
  CreateParticipantRecordingPayload,
  UpdateParticipantRecordingPayload,
  MarkRecordingCompletePayload,
  CreateSegmentPayload,
  StartSessionResponse,
  StopSessionResponse,
  GetSessionResponse,
  GetActiveSessionResponse,
  GetSessionsListResponse,
  CreateParticipantRecordingResponse,
  UpdateParticipantRecordingResponse,
  GetParticipantRecordingResponse,
  GetRecordingsListResponse,
  MarkRecordingCompleteResponse,
  CreateSegmentResponse,
  GetSegmentsListResponse,
} from "@/types/recordingTypes";

// RecordingSession Hooks

export const useStartRecordingSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: StartSessionPayload) => {
      const { data } = await api.post<StartSessionResponse>(
        "/recording/session/start",
        payload,
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["recording-sessions", data.spaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["space", data.spaceId] });
    },
  });
};

export const useStopRecordingSession = (sessionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: StopSessionPayload) => {
      const { data } = await api.post<StopSessionResponse>(
        `/recording/session/${sessionId}/stop`,
        payload,
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["recording-session", sessionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["recording-sessions", data.spaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["space", data.spaceId] });
    },
  });
};

export const useGetRecordingSession = (
  sessionId: string,
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ["recording-session", sessionId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetSessionResponse>(
          `/recording/session/${sessionId}`,
        );
        return data.data || null;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!sessionId,
    staleTime: 30000,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "STOPPED" || status === "PROCESSING" ? 4000 : false;
    },
    retry: false,
  });
};

export const useGetActiveRecordingSession = (
  spaceId: string,
  participantSessionId: string,
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ["active-recording-session", spaceId, participantSessionId],
    queryFn: async () => {
      const { data } = await api.get<GetActiveSessionResponse>(
        `/recording/space/${spaceId}/active-session`,
        { params: { participantSessionId } },
      );
      return data.data || null;
    },
    enabled: enabled && !!spaceId && !!participantSessionId,
    refetchInterval: enabled ? 5000 : false,
    staleTime: 2000,
    retry: false,
  });
};

export const useGetRecordingSessionsBySpace = (
  spaceId: string,
  enabled: boolean = true,
  refetchInterval:
    | number
    | false
    | ((
        query: Query<GetSessionsListResponse["data"] | null, Error>,
      ) => number | false) = false,
) => {
  return useQuery({
    queryKey: ["recording-sessions", spaceId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetSessionsListResponse>(
          `/recording/space/${spaceId}/sessions`,
        );
        return data.data;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!spaceId,
    staleTime: 30000,
    refetchInterval,
    retry: false,
  });
};

/** Create (or return) the public link for one host-owned Space recording. */
export const useShareSpaceRecording = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data } = await api.post(`/recording/session/${sessionId}/share`);
      return { sessionId, shareToken: data.data.shareToken as string };
    },
    onSuccess: ({ sessionId, shareToken }) => {
      queryClient.setQueryData<GetSessionsListResponse["data"]>(
        ["recording-sessions", spaceId],
        (data) =>
          data
            ? {
                ...data,
                sessions: data.sessions.map((session) =>
                  session.id === sessionId ? { ...session, shareToken } : session,
                ),
              }
            : data,
      );
    },
  });
};

/** Disable a Space recording's public link. */
export const useUnshareSpaceRecording = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/recording/session/${sessionId}/share`);
      return sessionId;
    },
    onSuccess: (sessionId) => {
      queryClient.setQueryData<GetSessionsListResponse["data"]>(
        ["recording-sessions", spaceId],
        (data) =>
          data
            ? {
                ...data,
                sessions: data.sessions.map((session) =>
                  session.id === sessionId
                    ? { ...session, shareToken: null }
                    : session,
                ),
              }
            : data,
      );
    },
  });
};

export const useRenameRecordingSession = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      title,
    }: {
      sessionId: string;
      title: string;
    }) => {
      const { data } = await api.patch(`/recording/session/${sessionId}`, {
        title,
      });
      return data.data as { id: string; spaceId: string; title: string };
    },
    onMutate: async ({ sessionId, title }) => {
      await queryClient.cancelQueries({
        queryKey: ["recording-sessions", spaceId],
      });
      const previous = queryClient.getQueryData<
        GetSessionsListResponse["data"]
      >(["recording-sessions", spaceId]);
      queryClient.setQueryData<GetSessionsListResponse["data"]>(
        ["recording-sessions", spaceId],
        (data) =>
          data
            ? {
                ...data,
                sessions: data.sessions.map((session) =>
                  session.id === sessionId ? { ...session, title } : session,
                ),
              }
            : data,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(
        ["recording-sessions", spaceId],
        context?.previous,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["recording-sessions", spaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["final-outputs", spaceId] });
    },
  });
};

export const useDeleteRecordingSession = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/recording/session/${sessionId}`);
    },
    onMutate: async (sessionId) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: ["recording-sessions", spaceId],
        }),
        queryClient.cancelQueries({ queryKey: ["final-outputs", spaceId] }),
      ]);
      const previousSessions = queryClient.getQueryData<
        GetSessionsListResponse["data"]
      >(["recording-sessions", spaceId]);
      const previousOutputs = queryClient.getQueryData<FinalOutput[]>([
        "final-outputs",
        spaceId,
      ]);
      queryClient.setQueryData<GetSessionsListResponse["data"]>(
        ["recording-sessions", spaceId],
        (data) =>
          data
            ? {
                ...data,
                sessions: data.sessions.filter(
                  (session) => session.id !== sessionId,
                ),
              }
            : data,
      );
      queryClient.setQueryData<FinalOutput[]>(
        ["final-outputs", spaceId],
        (outputs) =>
          outputs?.filter((output) => output.recordingSessionId !== sessionId),
      );
      return { previousSessions, previousOutputs };
    },
    onError: (_error, _sessionId, context) => {
      queryClient.setQueryData(
        ["recording-sessions", spaceId],
        context?.previousSessions,
      );
      queryClient.setQueryData(
        ["final-outputs", spaceId],
        context?.previousOutputs,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["recording-sessions", spaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["final-outputs", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
};

// ParticipantRecording Hooks

export const useCreateParticipantRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateParticipantRecordingPayload) => {
      const { data } = await api.post<CreateParticipantRecordingResponse>(
        "/recording/participant",
        payload,
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["session-recordings", data.recordingSessionId],
      });
    },
  });
};

export const useUpdateParticipantRecording = (recordingId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateParticipantRecordingPayload) => {
      const { data } = await api.patch<UpdateParticipantRecordingResponse>(
        `/recording/participant/${recordingId}`,
        payload,
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["participant-recording", recordingId],
      });
      queryClient.invalidateQueries({
        queryKey: ["session-recordings", data.recordingSessionId],
      });
    },
  });
};

export const useGetParticipantRecording = (
  recordingId: string,
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ["participant-recording", recordingId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetParticipantRecordingResponse>(
          `/recording/participant/${recordingId}`,
        );
        return data.data || null;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!recordingId,
    staleTime: 30000,
    retry: false,
  });
};

export const useGetRecordingsBySession = (
  sessionId: string,
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ["session-recordings", sessionId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetRecordingsListResponse>(
          `/recording/session/${sessionId}/recordings`,
        );
        return data.data;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!sessionId,
    staleTime: 30000,
    retry: false,
  });
};

export const useMarkRecordingComplete = (recordingId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: MarkRecordingCompletePayload) => {
      const { data } = await api.post<MarkRecordingCompleteResponse>(
        `/recording/participant/${recordingId}/complete`,
        payload,
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["participant-recording", recordingId],
      });
      queryClient.invalidateQueries({
        queryKey: ["session-recordings", data.recordingSessionId],
      });
    },
  });
};

// RecordingSegment Hooks

export const useCreateSegment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateSegmentPayload) => {
      const { data } = await api.post<CreateSegmentResponse>(
        "/recording/segment",
        payload,
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["recording-segments", data.participantRecordingId],
      });
      queryClient.invalidateQueries({
        queryKey: ["participant-recording", data.participantRecordingId],
      });
    },
  });
};

export const useGetSegmentsByRecording = (
  recordingId: string,
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ["recording-segments", recordingId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetSegmentsListResponse>(
          `/recording/participant/${recordingId}/segments`,
        );
        return data.data;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!recordingId,
    staleTime: 30000,
    retry: false,
  });
};
