"use client"

import { useGetMe } from "@/hooks/useUserQuery"
import { useEffect } from "react"

const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:5173";

export default function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe()

  useEffect(() => {
    if (!isLoading && user) {
      // Redirect to web app if user is already logged in
      window.location.href = WEB_APP_URL;
    }
  }, [user, isLoading])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    )
  }

  if (user) {
    return null
  }

  return <>{children}</>
}

