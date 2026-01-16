import { useQuery } from "@tanstack/react-query"
import api from "@/shared/lib/axiosInstance"

export const useGetMe = () => {
  return useQuery({
    queryKey: ["get-me"],
    queryFn: async () => {
      try {
        const { data } = await api.get("/auth/me")
        return data.data || null
      } catch {
        return null
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}