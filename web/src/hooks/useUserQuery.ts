import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";

interface MeUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export const useGetMe = () => {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const query = useQuery({
    queryKey: ["get-me", isSignedIn],
    queryFn: async () => {
      try {
        const { data } = await api.get("/auth/me");
        return (data.data as MeUser) || null;
      } catch {
        return null;
      }
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: Infinity,
    retry: false,
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

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
  };
};
