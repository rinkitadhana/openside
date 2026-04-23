"use client"

import { useGetMe } from "@/hooks/useUserQuery"
import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/auth", { replace: true })
    }
  }, [user, isLoading, navigate])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return <>{children}</>
}
