"use client"

import AppLoader from "@/components/shared/AppLoader"
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
    return <AppLoader />
  }

  if (!user) {
    return null
  }

  return <>{children}</>
}
