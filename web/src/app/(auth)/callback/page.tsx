"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { supabase } from "@/shared/lib/supabaseClient"

export default function CallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async (): Promise<void> => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (session) {
        router.push("/dashboard")
      } else {
        router.push("/login")
      }
    }

    setTimeout(() => handleCallback().catch(console.error), 1000)
  }, [router])

  return <p>Redirecting...</p>
}