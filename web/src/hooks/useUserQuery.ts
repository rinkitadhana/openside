import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";

export interface MeUser {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  brandColor?: string | null;
  plan?: "DEMO" | "PRO";
  cloudBackupEnabled?: boolean;
  /** User-level recording frame-rate preference (24 or 30); default 30. */
  targetFps?: number;
  /** Host capture preferences, defaulted server-side to legacy behaviour. */
  videoResolution?: number;
  audioSampleRate?: number;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  recordingMode?: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
}

/** Query key for the current-user profile (shared so mutations can patch it). */
export const GET_ME_QUERY_KEY = ["get-me"] as const;

const isAxiosStatus = (error: unknown, status: number): boolean =>
  typeof error === "object" &&
  error !== null &&
  "response" in error &&
  (error as { response?: { status?: number } }).response?.status === status;

export const useGetMe = () => {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const query = useQuery({
    queryKey: ["get-me", isSignedIn],
    queryFn: async () => {
      try {
        const { data } = await api.get("/auth/me");
        return (data.data as MeUser) || null;
      } catch (error) {
        // Only a 401 is a definitive "not signed in to our backend". Anything
        // else (network error on cold load, 5xx, timeout) is transient - let
        // it throw so react-query retries instead of resolving to null, which
        // would bounce the user between /auth and /dashboard (blank screen).
        if (isAxiosStatus(error, 401)) {
          return null;
        }
        throw error;
      }
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 60 * 1000,
    // Retry transient failures a few times with backoff. A 401 short-circuits
    // to null above and never reaches here.
    retry: (failureCount, error) =>
      !isAxiosStatus(error, 401) && failureCount < 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  if (!isLoaded) {
    return {
      data: null,
      isLoading: true,
    };
  }

  if (!isSignedIn) {
    return {
      data: null,
      isLoading: false,
    };
  }

  // Keep showing the loading state while retries are in flight (status stays
  // "pending" until they're exhausted), rather than briefly reporting null.
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
  };
};
