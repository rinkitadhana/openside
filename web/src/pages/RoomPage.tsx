import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { WifiOff } from "lucide-react";
import SpaceWrapper from "@/components/Space/SpaceWrapper";
import PreJoinScreen from "@/components/Space/PreJoinScreen";
import LiveKitSpaceScreen from "@/components/Space/LiveKitSpaceScreen";
import CallExitScreen, {
  type CallExitReason,
} from "@/components/Space/CallExitScreen";
import AppLoader from "@/components/shared/AppLoader";
import { useGetMe } from "@/hooks/useUserQuery";
import { useCreateSpace, useGetSpaceByJoinCode } from "@/hooks/useSpace";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import type { PreJoinSettings } from "@/types/preJoinTypes";
import type { SpaceResponse } from "@/types/spaceTypes";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

type SidebarType = "info" | "users" | "chat" | null;
type CreatedSpace = SpaceResponse["data"];

const hostJoinSettingsKey = (joinCode: string) =>
  `HOST_JOIN_SETTINGS_${joinCode}`;

// A room is only ever created through an explicit "new meeting" action in the
// app, which sets this one-time intent flag before navigating. Visiting a room
// URL directly (or any room that doesn't exist) must NOT create or enter a room
// - with no intent flag it falls through to the normal join/existence check.
export const createIntentKey = (joinCode: string) =>
  `CREATE_INTENT_${joinCode}`;

// Module-level cache of the in-flight create promise per room. Surviving a React
// StrictMode double-mount (or any remount/re-render) means a later mount adopts
// the SAME create instead of firing a second one - or cancelling the first.
const hostCreateInFlight = new Map<string, Promise<CreatedSpace>>();

const RoomPage = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: user } = useGetMe();
  const { mutateAsync: createSpaceAsync } = useCreateSpace();
  const roomId = params.roomId as string;
  // Host (create) mode is driven by the one-time intent flag the app sets before
  // navigating from a "new meeting" action. Captured once at mount so consuming
  // the flag later can't flip a host into the join/existence path mid-session.
  const [isHost] = useState(
    () => sessionStorage.getItem(createIntentKey(roomId)) === "1",
  );
  // After leaving, the URL carries ?left=1 so a refresh shows the post-call
  // screen (with Rejoin) instead of silently re-running the join flow.
  const hasLeft = searchParams.get("left") === "1";
  const {
    data: spaceData,
    isLoading: isLoadingSpace,
    isError: isSpaceError,
    isFetching: isFetchingSpace,
    refetch: refetchSpace,
  } = useGetSpaceByJoinCode(roomId, !isHost);
  const [activeSidebar, setActiveSidebar] = useState<SidebarType>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [preJoinSettings, setPreJoinSettings] =
    useState<PreJoinSettings | null>(null);
  const hasJoinSettings = hasJoined && !!preJoinSettings?.livekit;
  const [spaceCreated, setSpaceCreated] = useState(false);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [exitReason, setExitReason] = useState<CallExitReason | null>(null);

  // Keep the latest user readable inside the async create handler without making
  // `user` a dependency of the create effect (its reference changes on refetch,
  // which would otherwise re-run/cancel the create mid-flight).
  const userRef = useRef(user);
  userRef.current = user;
  const hasUser = !!user;

  const participantSessionId = getOrCreateSessionId(roomId);

  const toggleSidebar = (sidebarType: SidebarType) => {
    if (activeSidebar === sidebarType) {
      setActiveSidebar(null);
    } else {
      setActiveSidebar(sidebarType);
    }
  };

  const closeSidebar = () => {
    setActiveSidebar(null);
  };

  const handleJoinCall = (settings: PreJoinSettings) => {
    setPreJoinSettings(settings);
    setHasJoined(true);
  };

  // Send the user back through the join flow (pre-join screen) so they reconnect
  // cleanly and the DB is reactivated via the normal join path. Also drop the
  // ?left=1 marker so the join flow isn't gated behind the post-call screen.
  const handleRejoin = () => {
    sessionStorage.removeItem(hostJoinSettingsKey(roomId));
    setExitReason(null);
    setPreJoinSettings(null);
    setHasJoined(false);
    setSearchParams({}, { replace: true });
  };

  const handleGoToDashboard = () => {
    navigate("/dashboard/home");
  };

  // Terminal exits (meeting ended / removed) can't be rejoined, so move the user
  // off the /:roomId route entirely. With the optimistic end flow the backend may
  // not have torn the space down yet, so staying here + refreshing would re-join
  // a dying meeting. For a normal leave we keep them on /:roomId but tag the URL
  // with ?left=1 so a refresh lands on the post-call screen (with Rejoin) rather
  // than auto-rejoining.
  const handleExit = (reason: CallExitReason) => {
    if (reason === "ended" || reason === "removed") {
      navigate("/meeting-ended", { replace: true, state: { reason } });
      return;
    }
    setExitReason(reason);
    setSearchParams({ left: "1" }, { replace: true });
  };

  const renderSpace = () => (
    <SpaceWrapper activeSidebar={activeSidebar} closeSidebar={closeSidebar}>
      <LiveKitSpaceScreen
        toggleSidebar={toggleSidebar}
        activeSidebar={activeSidebar}
        preJoinSettings={preJoinSettings}
        onExit={handleExit}
      />
    </SpaceWrapper>
  );

  useEffect(() => {
    document.title = `Openside - Space ${roomId}`;
    return () => {
      document.title = "Openside";
    };
  }, [roomId]);

  useEffect(() => {
    if (!isHost || hasLeft || !hasUser || spaceCreated || isCreatingSpace) {
      return;
    }

    // `active` only governs whether THIS mount applies the result. It never
    // cancels/ends the shared create, so a StrictMode unmount can't tear down a
    // legitimate in-flight create (the remount adopts the same promise below).
    let active = true;
    setIsCreatingSpace(true);

    // Adopt an in-flight create for this room if one exists, otherwise start one.
    let createPromise = hostCreateInFlight.get(roomId);
    if (!createPromise) {
      createPromise = createSpaceAsync({
        joinCode: roomId,
        participantSessionId,
      });
      hostCreateInFlight.set(roomId, createPromise);
    }

    createPromise
      .then((spaceData) => {
        hostCreateInFlight.delete(roomId);
        sessionStorage.removeItem(createIntentKey(roomId));
        if (!active) return;

        if (!spaceData?.joinCode) {
          console.error(
            "Create space returned an invalid response:",
            spaceData,
          );
          navigate("/dashboard/home");
          return;
        }

        setSpaceCreated(true);

        const currentUser = userRef.current;
        const defaultSettings: PreJoinSettings = {
          videoEnabled: true,
          audioEnabled: true,
          name: currentUser?.name || "Host",
          avatar: currentUser?.avatar ?? undefined,
          livekit: spaceData.livekit,
        };

        // Cached settings still mark this user as the room's host (used for
        // the instant host-only UI hints), but the host now goes through the
        // pre-join screen like everyone else instead of auto-joining.
        try {
          sessionStorage.setItem(
            hostJoinSettingsKey(spaceData.joinCode),
            JSON.stringify(defaultSettings),
          );
        } catch (error) {
          console.warn("Unable to cache host join settings:", error);
        }

        setIsCreatingSpace(false);
        navigate(`/${spaceData.joinCode}`, { replace: true });
      })
      .catch((error) => {
        hostCreateInFlight.delete(roomId);
        sessionStorage.removeItem(createIntentKey(roomId));
        console.error("Failed to create space:", error);
        if (!active) return;
        setIsCreatingSpace(false);
        if (!axios.isCancel(error)) {
          navigate("/dashboard/home");
        }
      });

    return () => {
      active = false;
    };
    // `spaceCreated`/`isCreatingSpace` are internal guards set inside this effect,
    // and `user` is read via a ref - listing them would re-run/cancel the create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isHost,
    hasLeft,
    hasUser,
    roomId,
    navigate,
    createSpaceAsync,
    participantSessionId,
  ]);

  if (exitReason) {
    return (
      <CallExitScreen
        reason={exitReason}
        onRejoin={handleRejoin}
        onDashboard={handleGoToDashboard}
      />
    );
  }

  // A refreshed/revisited ?left=1 URL: show the post-call screen instead of
  // re-entering the join flow.
  if (hasLeft) {
    return (
      <CallExitScreen
        reason="left"
        onRejoin={handleRejoin}
        onDashboard={handleGoToDashboard}
      />
    );
  }

  if (isHost && isCreatingSpace) {
    return <AppLoader message="Creating space..." />;
  }

  if (hasJoinSettings) {
    return renderSpace();
  }

  if (!isHost) {
    if (isLoadingSpace) {
      return <AppLoader message="Loading space..." />;
    }

    // A connection/server error (not a 404) must NOT be shown as "not found" -
    // that would wrongly tell the user the meeting doesn't exist over a transient
    // blip. Offer a retry instead so a real room stays reachable.
    if (isSpaceError) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary text-foreground">
            <WifiOff size={28} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">
              Can't reach the recording session
            </h1>
            <p className="max-w-sm text-sm text-foreground">
              We couldn't load this recording session. Check your connection and
              try again.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => refetchSpace()}
              disabled={isFetchingSpace}
              className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition-colors duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFetchingSpace ? "Retrying..." : "Try again"}
            </button>
            <button
              type="button"
              onClick={handleGoToDashboard}
              className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-primary"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      );
    }

    // A SCHEDULED session can be joined by anyone (host or invitee) - whoever
    // arrives first starts it. So let it fall straight through to the pre-join
    // screen below; the join call provisions the room and flips it LIVE.

    // The meeting must exist and be live or scheduled to join. A missing code
    // (404 -> null) or an ended/stale space should land on a clear "not found"
    // screen with a way back to the dashboard, instead of a dead pre-join/room.
    if (
      !spaceData ||
      (spaceData.status !== "LIVE" && spaceData.status !== "SCHEDULED")
    ) {
      return (
        <CallExitScreen
          reason="notfound"
          onRejoin={handleRejoin}
          onDashboard={handleGoToDashboard}
        />
      );
    }

    return (
      <PreJoinScreen
        onJoinCall={handleJoinCall}
        roomId={roomId}
        onRoomUnavailable={() => {
          // The space was marked LIVE but the room is actually gone/expired.
          // Drop the stale cache and show the not-found/expired screen.
          void refetchSpace();
          setExitReason("notfound");
        }}
        onSpaceFull={() => setExitReason("full")}
      />
    );
  }

  // Host flow: the space was just created, so the host picks devices on the
  // pre-join screen like everyone else. This also catches the host's Rejoin
  // path on the same mount.
  if (spaceCreated) {
    return (
      <PreJoinScreen
        onJoinCall={handleJoinCall}
        roomId={roomId}
        onRoomUnavailable={() => setExitReason("notfound")}
        onSpaceFull={() => setExitReason("full")}
      />
    );
  }

  return (
    <div className="bg-background h-dvh flex items-center justify-center">
      <div className="text-sm text-foreground/70">
        Unable to finish joining the new space. Please return to the dashboard
        and try again.
      </div>
    </div>
  );
};

export default RoomPage;
