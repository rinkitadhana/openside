import PageTitle from "@/components/shared/PageTitle";
import RecordingsLibrary, {
  ProjectDetail,
} from "@/components/Dashboard/recordings/RecordingsLibrary";
import ScreenProjectDetail from "@/components/Dashboard/recordings/ScreenProjectDetail";
import {
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

const DashboardProjectPage = () => {
  const { spaceId, screenSessionId } = useParams<{
    spaceId?: string;
    screenSessionId?: string;
  }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const legacyState = location.state as {
    spaceId?: string;
    recordingSessionId?: string;
  } | null;
  const legacySpaceId =
    legacyState?.spaceId ??
    searchParams.get("spaceId") ??
    searchParams.get("space");
  const focusedRecordingSessionId =
    legacyState?.recordingSessionId ?? searchParams.get("recordingSessionId");

  if (!spaceId && legacySpaceId) {
    const params = new URLSearchParams();
    if (focusedRecordingSessionId) {
      params.set("recordingSessionId", focusedRecordingSessionId);
    }
    const search = params.size > 0 ? `?${params.toString()}` : "";
    return (
      <Navigate to={`/dashboard/project/${legacySpaceId}${search}`} replace />
    );
  }

  return (
    <>
      <PageTitle title="Projects" />
      {screenSessionId ? (
        <ScreenProjectDetail sessionId={screenSessionId} />
      ) : spaceId ? (
        <ProjectDetail spaceId={spaceId} />
      ) : (
        <RecordingsLibrary />
      )}
    </>
  );
};

export default DashboardProjectPage;
