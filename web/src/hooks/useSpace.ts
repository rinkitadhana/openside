import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import type {
  CreateSpacePayload,
  UpdateSpacePayload,
  SpaceResponse,
} from "@/types/spaceTypes";

type CachedSpace = SpaceResponse["data"] | null;

const mergeSpaceUpdate = (
  current: CachedSpace | undefined,
  update: Partial<SpaceResponse["data"]>
): CachedSpace | undefined => {
  if (!current) return current;

  return {
    ...current,
    ...update,
    host: update.host ?? current.host,
    participants: update.participants ?? current.participants,
    livekit: update.livekit ?? current.livekit,
  };
};

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
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["space", spaceId] }),
        queryClient.cancelQueries({ queryKey: ["space-by-code"] }),
      ]);

      const previousSpace = queryClient.getQueryData<CachedSpace>([
        "space",
        spaceId,
      ]);
      const previousSpacesByCode = queryClient.getQueriesData<CachedSpace>({
        queryKey: ["space-by-code"],
      });

      const applyOptimisticUpdate = (space: CachedSpace | undefined) => {
        if (!space || space.id !== spaceId) return space;
        return mergeSpaceUpdate(space, payload);
      };

      queryClient.setQueryData<CachedSpace>(
        ["space", spaceId],
        applyOptimisticUpdate
      );
      queryClient.setQueriesData<CachedSpace>(
        { queryKey: ["space-by-code"] },
        applyOptimisticUpdate
      );

      return { previousSpace, previousSpacesByCode };
    },
    onError: (_error, _payload, context) => {
      if (!context) return;

      queryClient.setQueryData(["space", spaceId], context.previousSpace);
      context.previousSpacesByCode.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSuccess: (space) => {
      queryClient.setQueryData<CachedSpace>(["space", spaceId], (current) =>
        mergeSpaceUpdate(current, space)
      );
      queryClient.setQueryData<CachedSpace>(
        ["space-by-code", space.joinCode],
        (current) => mergeSpaceUpdate(current, space)
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["space-by-code"] });
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
