import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/shared/lib/axiosInstance";
import type {
  JoinSpacePayload,
  JoinSpaceResponse,
  LeaveSpacePayload,
  LeaveSpaceResponse,
  ParticipantsListResponse,
  UpdateRolePayload,
  UpdateRoleResponse,
  KickParticipantResponse,
} from "@/shared/types/participantTypes";

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
// Leave Space
// ============================================================================

export const useLeaveSpace = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: LeaveSpacePayload) => {
      const { data } = await api.post<LeaveSpaceResponse>(
        `/participant/${spaceId}/leave`,
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
// Get Participants List
// ============================================================================

export const useGetParticipants = (
  spaceId: string,
  activeOnly: boolean = true,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["participants", spaceId, activeOnly],
    queryFn: async () => {
      try {
        const { data } = await api.get<ParticipantsListResponse>(
          `/participant/${spaceId}/list`,
          {
            params: { active: activeOnly },
          }
        );
        return data.data;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!spaceId,
    staleTime: 30000, // 30 seconds
    retry: false,
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

