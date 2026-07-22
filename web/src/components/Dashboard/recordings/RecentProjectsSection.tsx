import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useGetUserSpaces } from "@/hooks/useSpace";
import ProjectCard from "./ProjectCard";

const RecentProjectsSection = () => {
  const navigate = useNavigate();
  const { data: spaces = [], isLoading } = useGetUserSpaces("hosted");

  const recentProjects = useMemo(
    () =>
      spaces
        .filter((space) => (space._count?.recordingSessions ?? 0) > 0)
        .sort(
          (a, b) =>
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime(),
        )
        .slice(0, 4),
    [spaces],
  );

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl px-2">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-5 w-36 animate-pulse rounded bg-call-primary" />
          <div className="h-4 w-14 animate-pulse rounded bg-call-primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="aspect-[4/3] animate-pulse rounded-xl border border-call-border bg-call-primary"
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-2">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Recent projects</h3>
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="flex items-center gap-1 text-xs font-medium text-foreground/60 transition-colors hover:text-foreground cursor-pointer"
        >
          View all
          <ChevronRight size={14} />
        </button>
      </div>

      {recentProjects.length === 0 ? (
        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-sm text-foreground/40">
          Your recordings will show up here
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {recentProjects.map((space) => (
            <ProjectCard
              key={space.id}
              space={space}
              onOpen={(item) => navigate(`/dashboard/project/${item.id}`)}
              showOptions={false}
              showRetention={false}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default RecentProjectsSection;
