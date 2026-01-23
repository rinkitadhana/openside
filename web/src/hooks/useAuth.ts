import { supabase } from "@/lib/supabaseClient"
import { useQueryClient } from "@tanstack/react-query"

const LANDING_URL = import.meta.env.VITE_LANDING_URL || "http://localhost:3000";

export function useAuth() {
  const queryClient = useQueryClient()

  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${LANDING_URL}/callback` },
    })
  }

  const logout = async () => {
    await supabase.auth.signOut()
    queryClient.removeQueries({ queryKey: ["get-me"] })
    // Redirect to landing page
    window.location.href = LANDING_URL;
  }

  return { loginWithGoogle, logout }
}
