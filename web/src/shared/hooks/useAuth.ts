"use client"
import { supabase } from "@/shared/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
export function useAuth() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: process.env.NEXT_PUBLIC_REDIRECT_URL || "http://localhost:3000/callback" },
    })
  }

  const logout = async () => {
    await supabase.auth.signOut()
    queryClient.removeQueries({ queryKey: ["get-me"] })
    router.push("/")
  }

  return { loginWithGoogle, logout }
}
