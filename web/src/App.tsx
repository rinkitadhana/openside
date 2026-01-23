import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { QueryProvider } from "@/utils/QueryProvider";
import { SocketProvider } from "@/context/socket";
import ProtectedRoute from "@/components/shared/ProtectedRoute";
import DashboardPage from "@/pages/Dashboard/DashboardPage";
import SpacePage from "@/pages/Space/SpacePage";
import DashboardWrapper from "@/components/Dashboard/DashboardWrapper";

function App() {
  console.log('[App] Rendering...');

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <QueryProvider>
        <SocketProvider>
          <BrowserRouter>
            <Routes>
              {/* Redirect root to dashboard */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              {/* Dashboard routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardWrapper>
                      <DashboardPage />
                    </DashboardWrapper>
                  </ProtectedRoute>
                }
              />

              {/* Space/Video call routes */}
              <Route
                path="/space/:roomId"
                element={
                  <ProtectedRoute>
                    <SpacePage />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </BrowserRouter>
        </SocketProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

export default App;
