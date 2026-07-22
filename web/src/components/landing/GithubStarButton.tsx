import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { FaGithub } from "react-icons/fa";

const REPO = "rinkitadhana/openside";

const formatStars = (count: number) => {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(count);
};

const GithubStarButton = () => {
  const [stars, setStars] = useState<number | null>(null);
  // Counts up (1, 2, 3, …) while the fetch is in flight so the button never
  // shows a dead placeholder - it snaps to the real value once it arrives.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(`https://api.github.com/repos/${REPO}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {
        // Non-critical - just hide the count if the API call fails.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stars !== null) return;
    const id = setInterval(() => setTick((value) => value + 1), 70);
    return () => clearInterval(id);
  }, [stars]);

  return (
    <a
      href={`https://github.com/${REPO}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub repository"
      title="GitHub repository"
      className="flex items-center gap-2 rounded-full border border-border bg-primary px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
    >
      <FaGithub className="size-4" />
      <span className="flex items-center gap-1 border-l border-border pl-2 tabular-nums">
        <Star className="size-3.5 fill-current" />
        {stars === null ? tick : formatStars(stars)}
      </span>
    </a>
  );
};

export default GithubStarButton;
