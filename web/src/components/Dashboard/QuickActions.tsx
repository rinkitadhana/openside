"use client";
import { useState } from "react";
import generateRoomId from "@/utils/GenerateRoomId";
import { createIntentKey } from "@/pages/RoomPage";
import { CalendarDays, ChevronRight, CalendarClock } from "lucide-react";
import { BsFillRecordCircleFill } from "react-icons/bs";
import { RiMovie2Line } from "react-icons/ri";
import { FiMonitor } from "react-icons/fi";
import ActionCard from "./ActionCard";
import ScheduleModal from "./ScheduleModal";
import { useNavigate } from "react-router-dom";
import { DASHBOARD_IMAGE } from "@/constants/assets";
import { useGetUserSpaces } from "@/hooks/useSpace";

const UpcomingSessionsSkeleton = () => (
  <div className="flex flex-col gap-2">
    {Array.from({ length: 2 }).map((_, index) => (
      <div
        key={index}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-2 py-1.5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-9 shrink-0 animate-pulse rounded-md bg-primary" />
          <div className="space-y-2">
            <div className="h-3.5 w-32 animate-pulse rounded bg-primary" />
            <div className="h-3 w-24 animate-pulse rounded bg-primary" />
          </div>
        </div>
        <div className="h-7 w-14 shrink-0 animate-pulse rounded-md bg-primary" />
      </div>
    ))}
  </div>
);

const QuickActions = () => {
  const navigate = useNavigate();
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);

  const handleNewMeeting = () => {
    const roomId = generateRoomId();
    // Mark this as an intentional room creation so RoomPage is allowed to create
    // the space. Without this flag, visiting the URL only ever joins an existing
    // room (and shows "not found" if it doesn't exist).
    sessionStorage.setItem(createIntentKey(roomId), "1");
    navigate(`/${roomId}`);
  };

  const compositeImage = DASHBOARD_IMAGE;

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const { data: spaces = [], isLoading } = useGetUserSpaces("hosted");
  const now = Date.now();
  const upcoming = spaces
    .filter(
      (space) =>
        space.status === "SCHEDULED" &&
        space.scheduledFor &&
        new Date(space.scheduledFor).getTime() >= now
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledFor!).getTime() -
        new Date(b.scheduledFor!).getTime()
    );

  const formatWhen = (value: string) =>
    new Intl.DateTimeFormat("en", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  const actions = [
    {
      id: 1,
      title: "Record",
      description: "Start a new recording",
      icon: <BsFillRecordCircleFill size={18} />,
      positionX: "0%",
      accentHex: "#dc2626", // red
      onClick: handleNewMeeting,
    },
    {
      id: 3,
      title: "Schedule",
      description: "Plan for later",
      icon: <CalendarDays size={18} />,
      positionX: "50%",
      accentHex: "#16a34a", // green
      primaryIcon: true,
      onClick: () => setIsScheduleOpen(true),
    },
    {
      id: 4,
      title: "Screen Recorder",
      description: "Capture your screen",
      icon: <FiMonitor size={18} />,
      positionX: "75%",
      accentHex: "#2563eb", // blue
      onClick: () => navigate("/dashboard/screen-recorder"),
      // Phone/tablet browsers can't capture the screen, so the card is
      // desktop-only.
      className: "max-lg:hidden",
    },
    {
      id: 5,
      title: "Recordings",
      description: "Browse your library",
      icon: <RiMovie2Line size={18} />,
      positionX: "100%",
      accentHex: "#7c3aed", // purple
      primaryIcon: true,
      onClick: () => navigate("/dashboard/project"),
      // With the screen recorder hidden, phones show 3 cards - the last one
      // spans the row so the 2-column grid doesn't leave a hole.
      className: "max-sm:col-span-2",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-2 py-6 md:py-12">
      <div className="mb-8 text-center md:mb-12">
        <h2 className="font-bricolage text-3xl font-semibold text-foreground sm:text-4xl">
          What will you create today?
        </h2>
        <p className="mt-3 text-sm text-fg-subtle">
          Pick where you want to start.
        </p>
      </div>

      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            title={action.title}
            description={action.description}
            icon={action.icon}
            image={compositeImage}
            positionX={action.positionX}
            accentHex={action.accentHex}
            primaryIcon={action.primaryIcon}
            onClick={action.onClick}
            className={action.className}
          />
        ))}
      </div>

      <div className="mt-12">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            Upcoming sessions
            <span className="ml-2 font-normal text-fg-subtle">{todayLabel}</span>
          </h3>
          <button
            type="button"
            onClick={() => navigate("/dashboard/calendar")}
            className="flex items-center gap-1 text-xs font-medium text-fg-muted transition-colors hover:text-foreground cursor-pointer"
          >
            View all
            <ChevronRight size={14} />
          </button>
        </div>

        {isLoading ? (
          <UpcomingSessionsSkeleton />
        ) : upcoming.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-sm text-fg-subtle">
            No upcoming recordings scheduled
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((space) => (
              <button
                key={space.id}
                type="button"
                onClick={() => navigate("/dashboard/calendar")}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-2 py-1.5 text-left transition-colors hover:bg-muted cursor-pointer"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-foreground">
                    <CalendarClock size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {space.title || "Untitled recording"}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {formatWhen(space.scheduledFor!)}
                    </span>
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-fg-subtle" />
              </button>
            ))}
          </div>
        )}
      </div>

      <ScheduleModal
        open={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
      />
    </div>
  );
};

export default QuickActions;
