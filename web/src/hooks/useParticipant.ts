import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import type {
  JoinSpacePayload,
  JoinSpaceResponse,
  UpdateRolePayload,
  UpdateRoleResponse,
  KickParticipantResponse,
  StopParticipantTrackPayload,
  StopParticipantTrackResponse,
} from "@/types/participantTypes";

// ============================================================================
// Join Space
// ============================================================================

export const useJoinSpace = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: JoinSpacePayload) => {
      const { data } = await api.post<JoinSpaceResponse>(
        `/participant/${spaceId}/join`,
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["participants", spaceId] });
    },
  });
};

// ============================================================================
// Update Participant Role
// ============================================================================

export const useUpdateParticipantRole = (
  spaceId: string,
  participantId: string
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateRolePayload) => {
      const { data } = await api.patch<UpdateRoleResponse>(
        `/participant/${spaceId}/participant/${participantId}/role`,
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["participants", spaceId] });
    },
  });
};

// ============================================================================
// Kick Participant
// ============================================================================

export const useKickParticipant = (spaceId: string, participantId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<KickParticipantResponse>(
        `/participant/${spaceId}/participant/${participantId}/kick`
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["participants", spaceId] });
    },
  });
};

// ============================================================================
// Stop Participant Track
// ============================================================================

export const useStopParticipantTrack = (
  spaceId: string,
  participantId: string
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: StopParticipantTrackPayload) => {
      const { data } = await api.post<StopParticipantTrackResponse>(
        `/participant/${spaceId}/participant/${participantId}/stop-track`,
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["participants", spaceId] });
    },
  });
};
