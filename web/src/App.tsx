import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import DashboardWrapper from "@/components/Dashboard/DashboardWrapper";
import ProtectedRoute from "@/components/shared/ProtectedRoute";
import { SocketProvider } from "@/context/socket";
import { ClockSyncProvider } from "@/context/clockSync";
import LandingPage from "@/pages/LandingPage";
import DashboardHomePage from "@/pages/DashboardHomePage";
import DashboardCalendarPage from "@/pages/DashboardCalendarPage";
import DashboardProjectPage from "@/pages/DashboardProjectPage";
import DashboardSettingsPage from "@/pages/DashboardSettingsPage";
import RoomPage from "@/pages/RoomPage";
import ScreenRecorderPage from "@/pages/ScreenRecorderPage";
import SharedRecordingPage from "@/pages/SharedRecordingPage";
import MeetingEndedPage from "@/pages/MeetingEndedPage";
import LocalMediaProvider from "@/components/ScreenRecorder/LocalMediaProvider";
import ScreenRecordingProvider from "@/components/ScreenRecorder/ScreenRecordingProvider";
import RecorderPip from "@/components/ScreenRecorder/RecorderPip";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

const App = () => {
  return (
    // Camera/mic + recording state live above the routes so they survive page
    // navigation (Meet-style): the floating widget keeps a preview + controls
    // visible while the user is away from the recorder.
    <LocalMediaProvider>
      <ScreenRecordingProvider>
        <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/sso-callback"
        element={<AuthenticateWithRedirectCallback />}
      />
      <Route path="/dashboard" element={<Navigate to="/dashboard/home" replace />} />
      <Route
        path="/dashboard/home"
        element={
          <ProtectedRoute>
            <DashboardWrapper noPadding>
              <DashboardHomePage />
            </DashboardWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/calendar"
        element={
          <ProtectedRoute>
            <DashboardWrapper noPadding>
              <DashboardCalendarPage />
            </DashboardWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/project"
        element={
          <ProtectedRoute>
            <DashboardWrapper>
              <Outlet />
            </DashboardWrapper>
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardProjectPage />} />
        <Route path="screen/:screenSessionId" element={<DashboardProjectPage />} />
        <Route path=":spaceId" element={<DashboardProjectPage />} />
      </Route>
      <Route
        path="/dashboard/settings"
        element={
          <ProtectedRoute>
            <DashboardWrapper>
              <DashboardSettingsPage />
            </DashboardWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/screen-recorder"
        element={
          <ProtectedRoute>
            <ScreenRecorderPage />
          </ProtectedRoute>
        }
      />
      <Route path="/meeting-ended" element={<MeetingEndedPage />} />
      {/* Public share link - no ProtectedRoute: the token is the credential.
          Must stay above /:roomId, which would otherwise swallow it. */}
      <Route path="/share/:token" element={<SharedRecordingPage />} />
      <Route
        path="/:roomId"
        element={
          <SocketProvider>
            <ClockSyncProvider>
              <RoomPage />
            </ClockSyncProvider>
          </SocketProvider>
        }
      />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <RecorderPip />
      </ScreenRecordingProvider>
    </LocalMediaProvider>
  );
};

export default App;
