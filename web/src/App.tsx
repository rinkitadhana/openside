import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import DashboardWrapper from "@/components/Dashboard/DashboardWrapper";
import ProtectedRoute from "@/components/shared/ProtectedRoute";
import { SocketProvider } from "@/context/socket";
import AuthPage from "@/pages/AuthPage";
import DashboardHomePage from "@/pages/DashboardHomePage";
import DashboardProjectPage from "@/pages/DashboardProjectPage";
import RoomPage from "@/pages/RoomPage";
import { Navigate, Route, Routes } from "react-router-dom";

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/auth" replace />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/sso-callback"
        element={<AuthenticateWithRedirectCallback />}
      />
      <Route path="/dashboard" element={<Navigate to="/dashboard/home" replace />} />
      <Route
        path="/dashboard/home"
        element={
          <ProtectedRoute>
            <DashboardWrapper>
              <DashboardHomePage />
            </DashboardWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/project"
        element={
          <ProtectedRoute>
            <DashboardWrapper>
              <DashboardProjectPage />
            </DashboardWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/:roomId"
        element={
          <ProtectedRoute>
            <SocketProvider>
              <RoomPage />
            </SocketProvider>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  );
};

export default App;
