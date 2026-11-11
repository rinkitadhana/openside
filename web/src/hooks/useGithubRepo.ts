import { useEffect, useState } from "react";

const REPO = "rinkitadhana/openside";
const API = `https://api.github.com/repos/${REPO}`;

export interface GithubContributor {
  login: string;
  avatarUrl: string;
  url: string;
  contributions: number;
}

export interface GithubCommit {
  sha: string;
  message: string;
  date: string;
  url: string;
}

export interface GithubRepoData {
  contributors: GithubContributor[];
  commits: GithubCommit[];
}

const getJson = (path: string) =>
  fetch(`${API}${path}`).then((response) => {
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    return response.json();
  });

// Fetched once per page load and shared, so navigating back to the page
// doesn't spend more of GitHub's unauthenticated rate limit.
let request: Promise<GithubRepoData | null> | null = null;
let cached: GithubRepoData | null = null;

const fetchRepo = () => {
  request ??= Promise.all([
    getJson("/contributors?per_page=100"),
    getJson("/commits?per_page=20"),
  ])
    .then(([contributors, commits]) => {
      cached = {
        contributors: contributors
          .filter((c: { type: string }) => c.type === "User")
          .map(
            (c: {
              login: string;
              avatar_url: string;
              html_url: string;
              contributions: number;
            }) => ({
              login: c.login,
              avatarUrl: c.avatar_url,
              url: c.html_url,
              contributions: c.contributions,
            }),
          ),
        commits: commits
          .filter((c: { parents: unknown[] }) => c.parents.length < 2)
          .slice(0, 6)
          .map(
            (c: {
              sha: string;
              html_url: string;
              commit: { message: string; author: { date: string } };
            }) => ({
              sha: c.sha,
              message: c.commit.message.split("\n")[0],
              date: c.commit.author.date,
              url: c.html_url,
            }),
          ),
      };
      return cached;
    })
    .catch(() => null);
  return request;
};

export type GithubRepoState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: GithubRepoData };

/** Live contributors and recent commits. Client-only. */
export function useGithubRepo(): GithubRepoState {
  const [state, setState] = useState<GithubRepoState>(
    cached ? { status: "ready", data: cached } : { status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    fetchRepo().then((data) => {
      if (cancelled) return;
      setState(data ? { status: "ready", data } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** ISO date -> "today", "3 days ago", "2 months ago". */
export const timeAgo = (iso: string) => {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return relative.format(-days, "day");
  if (days < 365) return relative.format(-Math.round(days / 30), "month");
  return relative.format(-Math.round(days / 365), "year");
};
