/**
 * Profile + recording-preference mutations, with optimistic updates.
 *
 * Each mutation patches the cached ["get-me"] user immediately and rolls back
 * on error, so the UI reflects the change with no wait. The server response
 * (the canonical profile, incl. a fresh presigned avatar URL) is written back
 * on success.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import { GET_ME_QUERY_KEY, type MeUser } from "@/hooks/useUserQuery";

export interface ProfileUpdate {
  name?: string;
  brandColor?: string | null;
  avatarKey?: string | null;
}

/**
 * Optimistically merge a partial user into every cached ["get-me"] entry and
 * return a rollback that restores the prior snapshots.
 */
const optimisticallyPatchMe = async (
  queryClient: QueryClient,
  patch: Partial<MeUser>,
) => {
  await queryClient.cancelQueries({ queryKey: GET_ME_QUERY_KEY });
  const previous = queryClient.getQueriesData<MeUser | null>({
    queryKey: GET_ME_QUERY_KEY,
  });

  queryClient.setQueriesData<MeUser | null>(
    { queryKey: GET_ME_QUERY_KEY },
    (old) => (old ? { ...old, ...patch } : old),
  );

  return () => {
    for (const [key, value] of previous) {
      queryClient.setQueryData(key, value);
    }
  };
};

const writeMe = (queryClient: QueryClient, user: MeUser) => {
  queryClient.setQueriesData<MeUser | null>(
    { queryKey: GET_ME_QUERY_KEY },
    (old) => (old ? { ...old, ...user } : old),
  );
};

/** Update name / brand color / avatar. Optimistic. */
export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (update: ProfileUpdate) => {
      const { data } = await api.patch<{ data: MeUser }>(
        "/settings/profile",
        update,
      );
      return data.data;
    },
    onMutate: async (update) => {
      // The avatarKey is a storage key, not a URL - don't optimistically write
      // it into `avatar`. Callers pass a local preview via a separate flow.
      const patch: Partial<MeUser> = {};
      if (update.name !== undefined) patch.name = update.name;
      if (update.brandColor !== undefined) patch.brandColor = update.brandColor;
      const rollback = await optimisticallyPatchMe(queryClient, patch);
      return { rollback };
    },
    onError: (_error, _vars, context) => {
      context?.rollback?.();
    },
    onSuccess: (user) => {
      writeMe(queryClient, user);
    },
  });
};

export interface RecordingSettingsUpdate {
  cloudBackupEnabled?: boolean;
  /** Frame-rate preference; only 24 or 30 are accepted server-side. */
  targetFps?: number;
  videoResolution?: 720 | 1080 | 2160;
  audioSampleRate?: 44100 | 48000;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  recordingMode?: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
}

/** Update the user-level recording preferences (cloud backup, frame rate).
 *  Optimistic. */
export const useUpdateRecordingSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (update: RecordingSettingsUpdate) => {
      const { data } = await api.patch<{ data: MeUser }>(
        "/settings/recording",
        update,
      );
      return data.data;
    },
    onMutate: async (update) => {
      const rollback = await optimisticallyPatchMe(queryClient, update);
      return { rollback };
    },
    onError: (_error, _vars, context) => {
      context?.rollback?.();
    },
    onSuccess: (user) => {
      writeMe(queryClient, user);
    },
  });
};

/**
 * Upload an avatar image: presign → PUT to R2 → save the key. Returns the
 * updated profile (with a fresh presigned avatar URL). Optimistically shows a
 * local object-URL preview while the upload is in flight.
 */
export const useUploadAvatar = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const { data: presign } = await api.post<{
        data: { url: string; key: string };
      }>("/settings/avatar/presign", { contentType: file.type });

      await fetch(presign.data.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      }).then((res) => {
        if (!res.ok) throw new Error("Avatar upload failed");
      });

      const { data } = await api.patch<{ data: MeUser }>("/settings/profile", {
        avatarKey: presign.data.key,
      });
      return data.data;
    },
    onMutate: async (file) => {
      const previewUrl = URL.createObjectURL(file);
      const rollback = await optimisticallyPatchMe(queryClient, {
        avatar: previewUrl,
      });
      return { rollback, previewUrl };
    },
    onError: (_error, _vars, context) => {
      context?.rollback?.();
      if (context?.previewUrl) URL.revokeObjectURL(context.previewUrl);
    },
    onSuccess: (user, _vars, context) => {
      writeMe(queryClient, user);
      if (context?.previewUrl) URL.revokeObjectURL(context.previewUrl);
    },
  });
};

/** Remove the uploaded avatar (revert to initials). Optimistic. */
export const useRemoveAvatar = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<{ data: MeUser }>("/settings/profile", {
        avatarKey: null,
      });
      return data.data;
    },
    onMutate: async () => {
      const rollback = await optimisticallyPatchMe(queryClient, {
        avatar: null,
      });
      return { rollback };
    },
    onError: (_error, _vars, context) => {
      context?.rollback?.();
    },
    onSuccess: (user) => {
      writeMe(queryClient, user);
    },
  });
};
