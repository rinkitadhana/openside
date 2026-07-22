import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useGetUserSpaces } from "@/hooks/useSpace";
import RecentCreationsCard from "./RecentCreationsCard";

const pad = (n: number) => n.toString().padStart(2, "0");

const formatDuration = (startTime?: string, endTime?: string) => {
  if (!startTime || !endTime) return null;
  const secs = Math.round(
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000,
  );
  if (secs <= 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const formatRelativeDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const diffDays = Math.floor(
    (now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) /
      86400000,
  );
  if (diffDays === 0)
    return `Today, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const RecentCreationsSection = () => {
  const navigate = useNavigate();
  const { data: spaces = [], isLoading } = useGetUserSpaces("hosted");

  const recent = spaces
    .filter((s) => s.status !== "SCHEDULED")
    .sort(
      (a, b) =>
        new Date(b.startTime || b.createdAt || 0).getTime() -
        new Date(a.startTime || a.createdAt || 0).getTime(),
    )
    .slice(0, 4);

  if (isLoading || recent.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Recent Creations</h1>
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="flex items-center gap-0.5 text-xs font-medium text-foreground hover:text-foreground transition-colors duration-200 cursor-pointer"
        >
          View all
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {recent.map((space) => (
          <RecentCreationsCard
            key={space.id}
            title={space.title || "Untitled recording"}
            date={formatRelativeDate(space.startTime || space.createdAt)}
            duration={formatDuration(space.startTime, space.endTime) ?? "-"}
            avatar={space.host?.avatar}
            initial={(space.title || space.host?.name || "?")[0].toUpperCase()}
            onClick={() => navigate(`/dashboard/project/${space.id}`)}
          />
        ))}
      </div>
    </div>
  );
};

export default RecentCreationsSection;
