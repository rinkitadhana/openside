import { useLocation, useNavigate } from "react-router-dom";
import CallExitScreen, {
  type CallExitReason,
} from "@/components/Space/CallExitScreen";
import PageTitle from "@/components/shared/PageTitle";

// Terminal exits (the meeting ended, you were removed, etc.) land here instead
// of staying on the /:roomId route. That way a refresh shows the message again
// rather than re-running the join flow against a space that's being torn down.
const TERMINAL_REASONS: CallExitReason[] = ["ended", "removed", "notfound"];

const MeetingEndedPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const stateReason = (location.state as { reason?: CallExitReason } | null)
    ?.reason;
  const reason: CallExitReason =
    stateReason && TERMINAL_REASONS.includes(stateReason)
      ? stateReason
      : "ended";

  return (
    <>
      <PageTitle title="Recording Session Ended" />
      <CallExitScreen
        reason={reason}
        onRejoin={() => navigate("/dashboard/home")}
        onDashboard={() => navigate("/dashboard/home")}
      />
    </>
  );
};

export default MeetingEndedPage;
