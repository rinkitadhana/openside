"use client";

import { Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { GoSidebarCollapse, GoSidebarExpand } from "react-icons/go";
import { FaGithub } from "react-icons/fa";

const GITHUB_REPO_URL = "https://github.com/rinkitadhana/openside";
const GITHUB_REPO_API_URL = "https://api.github.com/repos/rinkitadhana/openside";

interface GitHubRepository {
  stargazers_count: number;
}

const formatStarCount = (count: number) =>
  Intl.NumberFormat("en", {
    notation: count >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(count);

interface DashboardHeaderProps {
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

const DashboardHeader = ({
  onToggleSidebar,
  isSidebarOpen,
}: DashboardHeaderProps) => {
  const { data: githubStars } = useQuery({
    queryKey: ["github-stars", "rinkitadhana/openside"],
    queryFn: async () => {
      const response = await fetch(GITHUB_REPO_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });

      if (!response.ok) {
        throw new Error("Failed to load GitHub stars");
      }

      const repository = (await response.json()) as GitHubRepository;
      return repository.stargazers_count;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-border bg-background pl-2 pr-4">
      <button
        type="button"
        title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
        onClick={onToggleSidebar}
        className="flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted cursor-pointer"
      >
        {isSidebarOpen ? (
          <GoSidebarExpand size={20} />
        ) : (
          <GoSidebarCollapse size={20} />
        )}
      </button>

      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        title={`GitHub repository${
          githubStars === undefined ? "" : `, ${githubStars} stars`
        }`}
        className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <FaGithub size={18} />
        <span className="flex items-center gap-1 tabular-nums">
          <Star size={12} fill="currentColor" />
          {githubStars === undefined ? "..." : formatStarCount(githubStars)}
        </span>
      </a>
    </header>
  );
};

export default DashboardHeader;
