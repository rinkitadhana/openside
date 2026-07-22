import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import api from "@/lib/axiosInstance";
import type {
  CreateSpacePayload,
  UpdateSpacePayload,
  ScheduleSpacePayload,
  Space,
  SpaceResponse,
  UserSpacesResponse,
} from "@/types/spaceTypes";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";

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
      // Creating a space also provisions the LiveKit room, which can take a few
      // seconds. Give it more headroom than the default 12s client timeout so a
      // valid-but-slow create isn't aborted and retried.
      const { data } = await api.post<SpaceResponse>("/space/create", payload, {
        timeout: 30000,
      });
      return data.data;
    },
    retry: (failureCount, error) =>
      failureCount < 1 &&
      axios.isAxiosError(error) &&
      (!error.response || error.response.status >= 500),
    retryDelay: 1000,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
};

// ============================================================================
// Schedule Space
// ============================================================================

export const useScheduleSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ScheduleSpacePayload) => {
      const { data } = await api.post<SpaceResponse>("/space/schedule", payload);
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
    mutationFn: async ({
      spaceId,
      participantSessionId,
    }: {
      spaceId: string;
      participantSessionId?: string;
    }) => {
      const { data } = await api.post<SpaceResponse>(`/space/${spaceId}/end`, {
        participantSessionId,
      });
      return data.data;
    },
    onSuccess: (_, { spaceId }) => {
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
      } catch (error) {
        // Only a real 404 means that this project is unavailable. Keeping other
        // failures as errors prevents a brief network problem from looking like
        // a deleted project and bouncing the user away from the detail page.
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: enabled && !!spaceId,
    staleTime: 30000, // 30 seconds
    retry: (failureCount, error) =>
      !axios.isAxiosError(error) || error.response?.status !== 404
        ? failureCount < 2
        : false,
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
      } catch (error) {
        // A 404 means the room genuinely doesn't exist -> resolve to null so the
        // UI can show a clear "not found". Any other failure (network / 5xx) must
        // propagate so React Query can retry and the UI can show a connection
        // error instead of falsely telling the user the meeting doesn't exist.
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: enabled && !!joinCode,
    staleTime: 30000, // 30 seconds
    retry: (failureCount, error) => {
      // Don't retry a definitive 404; do retry transient connection errors.
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });
};

// ============================================================================
// Get User Spaces
// ============================================================================

export const useSendSpaceInvite = (spaceId: string) =>
  useMutation({
    mutationFn: async (email: string) => {
      await api.post(`/space/${spaceId}/invite`, { email });
    },
  });

// Rename/delete for the recordings library. Both apply the change optimistically
// - they almost always succeed, so the UI updates instantly and only rolls back
// if the request actually fails. `["spaces"]` covers every cached list variant
// (hosted / participated / all).
type SpacesSnapshot = [readonly unknown[], Space[] | undefined][];

export const useRenameSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ spaceId, title }: { spaceId: string; title: string }) => {
      await api.patch(`/space/${spaceId}`, { title });
    },
    onMutate: async ({ spaceId, title }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["spaces"] }),
        queryClient.cancelQueries({ queryKey: ["space", spaceId] }),
      ]);
      const previous = queryClient.getQueriesData<Space[]>({
        queryKey: ["spaces"],
      }) as SpacesSnapshot;
      const previousSpace = queryClient.getQueryData<Space | null>([
        "space",
        spaceId,
      ]);
      queryClient.setQueriesData<Space[]>({ queryKey: ["spaces"] }, (spaces) =>
        spaces?.map((space) =>
          space.id === spaceId ? { ...space, title } : space,
        ),
      );
      queryClient.setQueryData<Space | null>(["space", spaceId], (space) =>
        space ? { ...space, title } : space,
      );
      return { previous, previousSpace };
    },
    onError: (_error, _variables, context) => {
      context?.previous?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      queryClient.setQueryData(
        ["space", _variables.spaceId],
        context?.previousSpace,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
      queryClient.invalidateQueries({ queryKey: ["space"] });
    },
  });
};

export const useDeleteSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (spaceId: string) => {
      await api.delete(`/space/${spaceId}`);
    },
    onMutate: async (spaceId) => {
      await queryClient.cancelQueries({ queryKey: ["spaces"] });
      const previous = queryClient.getQueriesData<Space[]>({
        queryKey: ["spaces"],
      }) as SpacesSnapshot;
      queryClient.setQueriesData<Space[]>({ queryKey: ["spaces"] }, (spaces) =>
        spaces?.filter((space) => space.id !== spaceId),
      );
      return { previous };
    },
    onError: (_error, _spaceId, context) => {
      context?.previous?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
};

export const useGetUserSpaces = (
  filter: "hosted" | "participated" | "all" = "all"
) => {
  const { isLoaded, isSignedIn } = useClerkAuth();

  return useQuery({
    queryKey: ["spaces", "user", filter],
    queryFn: async () => {
      const { data } = await api.get<UserSpacesResponse>("/space/user", {
        params: { filter },
        timeout: 30000,
      });
      return data.data.spaces;
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 30000,
    retry: 1,
  });
};
