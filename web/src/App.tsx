import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import ProtectedRoute from "@/components/shared/ProtectedRoute";
import LandingPage from "@/pages/LandingPage";
import LocalMediaProvider from "@/components/ScreenRecorder/LocalMediaProvider";
import ScreenRecordingProvider from "@/components/ScreenRecorder/ScreenRecordingProvider";
import RecordingChunkDrainer from "@/components/Space/recording/RecordingChunkDrainer";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import AppLoader from "@/components/shared/AppLoader";

// Only the landing page ships in the main bundle; every other page (and the
// call/recorder code behind it) downloads when it's first visited.
const OpenSourcePage = lazy(() => import("@/pages/OpenSourcePage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const SponsorPage = lazy(() => import("@/pages/SponsorPage"));
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
const DashboardWrapper = lazy(
  () => import("@/components/Dashboard/DashboardWrapper"),
);
const DashboardHomePage = lazy(() => import("@/pages/DashboardHomePage"));
const DashboardCalendarPage = lazy(
  () => import("@/pages/DashboardCalendarPage"),
);
const DashboardProjectPage = lazy(() => import("@/pages/DashboardProjectPage"));
const DashboardSettingsPage = lazy(
  () => import("@/pages/DashboardSettingsPage"),
);
const ScreenRecorderPage = lazy(() => import("@/pages/ScreenRecorderPage"));
const SharedRecordingPage = lazy(() => import("@/pages/SharedRecordingPage"));
const MeetingEndedPage = lazy(() => import("@/pages/MeetingEndedPage"));
const RoomPage = lazy(() => import("@/pages/RoomPage"));
const SocketProvider = lazy(() =>
  import("@/context/socket").then((m) => ({ default: m.SocketProvider })),
);
const ClockSyncProvider = lazy(() =>
  import("@/context/clockSync").then((m) => ({ default: m.ClockSyncProvider })),
);

const App = () => {
  return (
    // Camera/mic + recording state live above the routes so they survive page
    // navigation (Meet-style): the floating widget keeps a preview + controls
    // visible while the user is away from the recorder.
    <LocalMediaProvider>
      <ScreenRecordingProvider>
        <RecordingChunkDrainer />
        <Suspense fallback={<AppLoader />}>
        <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/open-source" element={<OpenSourcePage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/sponsor" element={<SponsorPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route
        path="/sso-callback"
        element={
          // Google sign-ups (new accounts) take the sign-up branch, which
          // otherwise falls back to Clerk's default "/".
          <AuthenticateWithRedirectCallback
            signInFallbackRedirectUrl="/dashboard/home"
            signUpFallbackRedirectUrl="/dashboard/home"
          />
        }
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
        </Suspense>
      </ScreenRecordingProvider>
    </LocalMediaProvider>
  );
};

export default App;
