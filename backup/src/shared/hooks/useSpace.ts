import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/shared/lib/axiosInstance";
import type {
  CreateSpacePayload,
  UpdateSpacePayload,
  SpaceResponse,
} from "@/shared/types/spaceTypes";

// ============================================================================
// Create Space
// ============================================================================

export const useCreateSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateSpacePayload) => {
      const { data } = await api.post<SpaceResponse>("/space/create", payload);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
};

// ============================================================================
// Update Space
// ============================================================================

export const useUpdateSpace = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateSpacePayload) => {
      const { data } = await api.patch<SpaceResponse>(
        `/space/${spaceId}`,
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
};

// ============================================================================
// End Space
// ============================================================================

export const useEndSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (spaceId: string) => {
      const { data } = await api.post<SpaceResponse>(`/space/${spaceId}/end`);
      return data.data;
    },
    onSuccess: (_, spaceId) => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
};

// ============================================================================
// Get Space by ID
// ============================================================================

export const useGetSpaceById = (spaceId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["space", spaceId],
    queryFn: async () => {
      try {
        const { data } = await api.get<SpaceResponse>(`/space/${spaceId}`);
        return data.data || null;
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
// Get Space by Join Code
// ============================================================================

export const useGetSpaceByJoinCode = (
  joinCode: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["space-by-code", joinCode],
    queryFn: async () => {
      try {
        const { data } = await api.get<SpaceResponse>(
          `/space/code/${joinCode}`
        );
        return data.data || null;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!joinCode,
    staleTime: 30000, // 30 seconds
    retry: false,
  });
};


