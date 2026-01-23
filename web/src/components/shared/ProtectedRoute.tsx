import { useGetMe } from "@/hooks/useUserQuery";
import { useEffect } from "react";

const LANDING_URL = import.meta.env.VITE_LANDING_URL || "http://localhost:3000";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();

  console.log('[ProtectedRoute]', { user, isLoading });

  useEffect(() => {
    if (!isLoading && !user) {
      console.log('[ProtectedRoute] Redirecting to login...');
      // Redirect to landing page login
      window.location.href = `${LANDING_URL}/login`;
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Redirecting to login...</p>
      </div>
    );
  }

  return <>{children}</>;
}
