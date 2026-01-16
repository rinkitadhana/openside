import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/shared/lib/axiosInstance";
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
  GetSessionsListResponse,
  CreateParticipantRecordingResponse,
  UpdateParticipantRecordingResponse,
  GetParticipantRecordingResponse,
  GetRecordingsListResponse,
  MarkRecordingCompleteResponse,
  CreateSegmentResponse,
  GetSegmentsListResponse,
} from "@/shared/types/recordingTypes";

// RecordingSession Hooks

export const useStartRecordingSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: StartSessionPayload) => {
      const { data } = await api.post<StartSessionResponse>(
        "/recording/session/start",
        payload
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recording-sessions", data.spaceId] });
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
        payload
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recording-session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["recording-sessions", data.spaceId] });
      queryClient.invalidateQueries({ queryKey: ["space", data.spaceId] });
    },
  });
};

export const useGetRecordingSession = (sessionId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["recording-session", sessionId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetSessionResponse>(
          `/recording/session/${sessionId}`
        );
        return data.data || null;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!sessionId,
    staleTime: 30000,
    retry: false,
  });
};

export const useGetRecordingSessionsBySpace = (
  spaceId: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["recording-sessions", spaceId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetSessionsListResponse>(
          `/recording/space/${spaceId}/sessions`
        );
        return data.data;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!spaceId,
    staleTime: 30000,
    retry: false,
  });
};

// ParticipantRecording Hooks

export const useCreateParticipantRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateParticipantRecordingPayload) => {
      const { data } = await api.post<CreateParticipantRecordingResponse>(
        "/recording/participant",
        payload
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
        payload
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["participant-recording", recordingId] });
      queryClient.invalidateQueries({
        queryKey: ["session-recordings", data.recordingSessionId],
      });
    },
  });
};

export const useGetParticipantRecording = (
  recordingId: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["participant-recording", recordingId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetParticipantRecordingResponse>(
          `/recording/participant/${recordingId}`
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
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["session-recordings", sessionId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetRecordingsListResponse>(
          `/recording/session/${sessionId}/recordings`
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
        payload
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["participant-recording", recordingId] });
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
        payload
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
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["recording-segments", recordingId],
    queryFn: async () => {
      try {
        const { data } = await api.get<GetSegmentsListResponse>(
          `/recording/participant/${recordingId}/segments`
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

