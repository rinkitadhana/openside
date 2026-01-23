"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"

const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:5173";

export default function CallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async (): Promise<void> => {
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        // Redirect to web app after successful login
        window.location.href = WEB_APP_URL;
      } else {
        router.push("/login")
      }
    }

    setTimeout(() => handleCallback().catch(console.error), 1000)
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p>Redirecting...</p>
    </div>
  )
}