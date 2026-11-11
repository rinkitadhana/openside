import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  GitCommitHorizontal,
  Heart,
  Star,
} from "lucide-react";
import { SiLoom } from "react-icons/si";
import { Link } from "react-router-dom";

import { RiversideIcon } from "@/components/landing/BrandIcons";
import MarketingLayout from "@/components/landing/MarketingLayout";
import { PageHero } from "@/components/landing/sections";
import { timeAgo, useGithubRepo } from "@/hooks/useGithubRepo";

const REPO_URL = "https://github.com/rinkitadhana/openside";

const repoFacts = [
  { label: "License", value: "MIT" },
  { label: "Language", value: "TypeScript" },
  { label: "Apps", value: "web + core" },
];

const terminalLines = [
  { prompt: true, text: `git clone ${REPO_URL}.git` },
  { prompt: true, text: "cd openside/core && pnpm install" },
  { prompt: true, text: "pnpm db:migrate && pnpm dev" },
  { prompt: false, text: "API ready, worker listening for jobs" },
];

const hostingOptions = [
  {
    name: "Bring your own keys",
    tagline: "Use openside.pro on your own infrastructure.",
    need: [
      "A LiveKit project, on LiveKit Cloud or your own server",
      "A Cloudflare R2 bucket",
    ],
    get: [
      "Unlimited recording time, participants, and retention",
      "No watermark and no Openside fee",
      "Keys encrypted with AES-256-GCM, never shown back in full",
      "Calls on your LiveKit, recordings in your bucket",
    ],
  },
  {
    name: "Deploy everything",
    tagline: "Run the whole app from the repository.",
    need: [
      "Node.js 20+ and pnpm 10+",
      "PostgreSQL and Redis",
      "LiveKit, Cloudflare R2, and a Clerk app",
    ],
    get: [
      "Every part of Openside on servers you run",
      "The web app on Cloudflare Workers",
      "API and media workers you can scale on their own",
      "Full control to modify anything",
    ],
  },
];

const alternativePoints = [
  "Remote podcasts with a local track per guest",
  "Screen recordings with a camera bubble",
  "Comments and links you can switch off",
  "Downloads as MP4, WebM, MP3, or WAV",
  "Free self-hosting on your own LiveKit and R2",
];

const Block = ({
  id,
  eyebrow,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  /** Sits opposite the heading on wide screens, e.g. a "view all" link. */
  aside?: ReactNode;
  children: ReactNode;
}) => (
  <section
    id={id}
    className="scroll-mt-6 border-b border-border px-4 py-16 last:border-b-0 sm:px-6 sm:py-20"
  >
    <div className="mx-auto max-w-5xl">
      <div
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="max-w-xl">
          <p className="text-sm font-medium text-foreground/60">{eyebrow}</p>
          <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          {description && (
            <p className="mt-3 text-base leading-7 text-foreground/70">
              {description}
            </p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </div>
  </section>
);

const ExternalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="group inline-flex w-fit shrink-0 items-center gap-1.5 text-sm font-medium text-foreground/70 transition-colors hover:text-foreground"
  >
    {children}
    <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
  </a>
);

const RepoSection = () => (
  <section className="border-b border-border px-4 py-16 sm:px-6 sm:py-20">
    <div
      className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-14"
    >
      <div>
        <p className="text-sm font-medium text-foreground/60">The repository</p>
        <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          MIT licensed, every line public.
        </h2>
        <p className="mt-3 text-base leading-7 text-foreground/70">
          Use, modify, and deploy Openside however you like, including for
          commercial work. You can read exactly how recordings and keys are
          handled before you trust it with either.
        </p>
        <dl className="mt-6 flex flex-wrap gap-2">
          {repoFacts.map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg border border-border bg-foreground/[0.03] px-3 py-1.5 text-sm"
            >
              <dt className="text-foreground/55">{label}</dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div
        className="overflow-hidden rounded-2xl border border-border bg-[#131313] shadow-[0_14px_38px_rgba(0,0,0,0.16)]"
      >
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs text-white/40">openside</span>
        </div>
        <pre className="overflow-x-auto p-5 font-mono text-[0.8125rem] leading-7">
          {terminalLines.map(({ prompt, text }) => (
            <div key={text} className={prompt ? "text-white/90" : "text-green-400"}>
              {prompt && <span className="mr-2 select-none text-white/35">$</span>}
              {text}
            </div>
          ))}
        </pre>
      </div>
    </div>
  </section>
);

const HostingSection = () => (
  <Block
    id="self-host"
    eyebrow="Self-hosting"
    title="Two ways to run it yourself."
    description="Keep the hosted app and plug in your own infrastructure, or deploy the entire thing from the repository."
  >
    <div
      className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2"
    >
      {hostingOptions.map(({ name, tagline, need, get }, index) => (
        <div
          key={name}
          className="flex flex-col rounded-2xl border border-border bg-foreground/[0.03]"
        >
          <div className="p-6">
            <span className="text-sm font-medium tabular-nums text-foreground/40">
              Option {index + 1}
            </span>
            <h3 className="font-bricolage mt-1 text-xl font-semibold tracking-tight text-foreground">
              {name}
            </h3>
            <p className="mt-1 text-sm text-foreground/60">{tagline}</p>
          </div>
          <div className="border-t border-border p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/45">
              You need
            </p>
            <ul className="mt-3 space-y-2">
              {need.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-sm text-foreground/75"
                >
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/35" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/45">
              You get
            </p>
            <ul className="mt-3 space-y-2">
              {get.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-sm text-foreground/75"
                >
                  <Check className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  </Block>
);

// The changelog is the commit log: real, current, and nothing to maintain.
const ShippedSection = () => {
  const repo = useGithubRepo();

  return (
    <Block
      id="shipped"
      eyebrow="Changelog"
      title="Recently shipped."
      description="Straight from the commit history, so you can see how actively it's built."
      aside={
        <ExternalLink href={`${REPO_URL}/commits/main`}>
          Full history
        </ExternalLink>
      }
    >
      <div
        className="mt-10 overflow-hidden rounded-2xl border border-border bg-foreground/[0.03]"
      >
        {repo.status === "ready" && repo.data.commits.length > 0 ? (
          <ul className="divide-y divide-border">
            {repo.data.commits.map(({ sha, message, date, url }) => (
              <li key={sha}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-foreground/[0.04]"
                >
                  <GitCommitHorizontal className="size-4 shrink-0 text-foreground/40" />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-foreground/85 group-hover:text-foreground">
                    {message}
                  </span>
                  <code className="hidden shrink-0 rounded bg-(--landing-chip) px-1.5 py-0.5 font-mono text-xs text-foreground/60 sm:block">
                    {sha.slice(0, 7)}
                  </code>
                  <span className="w-24 shrink-0 text-right text-xs text-foreground/50 first-letter:uppercase">
                    {timeAgo(date)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : repo.status === "error" ? (
          <p className="px-5 py-10 text-center text-sm text-foreground/60">
            Couldn't load commits from GitHub right now.{" "}
            <a
              href={`${REPO_URL}/commits/main`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-4"
            >
              See them on GitHub
            </a>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="flex items-center gap-4 px-5 py-4">
                <span className="size-4 shrink-0 rounded-full bg-foreground/10" />
                <span
                  className="h-3.5 animate-pulse rounded bg-foreground/10"
                  style={{ width: `${70 - index * 7}%` }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  );
};

const REPO_OWNER = "rinkitadhana";

// Empty cells that square off the last row of a gap-px grid, so the border
// color doesn't show through as a solid block. One set per breakpoint.
const gridFillers = (count: number) => {
  const fill = (cols: number) => (cols - (count % cols)) % cols;
  return [
    ...Array.from({ length: fill(2) }, (_, i) => ({
      key: `sm-${i}`,
      className: "hidden sm:block lg:hidden",
    })),
    ...Array.from({ length: fill(3) }, (_, i) => ({
      key: `lg-${i}`,
      className: "hidden lg:block",
    })),
  ];
};

const ContributeSection = () => {
  const repo = useGithubRepo();
  const contributors = repo.status === "ready" ? repo.data.contributors : [];
  const totalCommits = contributors.reduce((sum, c) => sum + c.contributions, 0);

  return (
    <Block
      id="contribute"
      eyebrow="Contributors"
      title="Built in the open."
      description={
        contributors.length > 1
          ? `${contributors.length} people have shipped ${totalCommits.toLocaleString()} commits to Openside so far. Bug reports, ideas, and pull requests are all welcome, and small fixes count.`
          : "Everyone who ships code to Openside is listed here. Bug reports, ideas, and pull requests are all welcome, and small fixes count."
      }
      aside={
        <div className="flex flex-wrap gap-x-6 gap-y-2.5 sm:flex-col sm:items-end">
          <ExternalLink href={`${REPO_URL}/issues/new`}>Report a bug</ExternalLink>
          <ExternalLink href={`${REPO_URL}/security/advisories/new`}>
            Report a vulnerability
          </ExternalLink>
        </div>
      }
    >
      <div className="mt-10">
        {repo.status === "error" ? (
          <p className="rounded-2xl border border-border bg-foreground/[0.03] px-5 py-10 text-center text-sm text-foreground/60">
            Couldn't load contributors.{" "}
            <a
              href={`${REPO_URL}/graphs/contributors`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-4"
            >
              See them on GitHub
            </a>
            .
          </p>
        ) : (
          <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {repo.status === "loading" &&
              Array.from({ length: 3 }, (_, index) => (
                <li
                  key={index}
                  aria-hidden
                  className="flex items-center gap-4 bg-background p-5"
                >
                  <span className="size-11 shrink-0 animate-pulse rounded-full bg-foreground/10" />
                  <span className="flex flex-col gap-2">
                    <span className="h-3.5 w-28 animate-pulse rounded bg-foreground/10" />
                    <span className="h-3 w-16 animate-pulse rounded bg-foreground/10" />
                  </span>
                </li>
              ))}
            {contributors.map(({ login, avatarUrl, url, contributions }, index) => (
              <li key={login} className="bg-background">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full items-center gap-4 p-5 transition-colors hover:bg-foreground/[0.04]"
                >
                  <img
                    src={`${avatarUrl}&s=88`}
                    alt=""
                    loading="lazy"
                    className="size-11 shrink-0 rounded-full bg-foreground/10 ring-1 ring-border"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium text-foreground">
                      {login}
                    </span>
                    <span className="mt-0.5 block text-sm tabular-nums text-foreground/50">
                      {contributions.toLocaleString()}{" "}
                      {contributions === 1 ? "commit" : "commits"}
                      {login === REPO_OWNER && " · Maintainer"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-foreground/30 transition-colors group-hover:text-foreground/60">
                    #{index + 1}
                  </span>
                </a>
              </li>
            ))}
            {gridFillers(
              repo.status === "loading" ? 3 : contributors.length,
            ).map(({ key, className }) => (
              <li key={key} aria-hidden className={`bg-background ${className}`} />
            ))}
          </ol>
        )}
      </div>
    </Block>
  );
};

const AlternativeSection = () => (
  <section className="border-b border-border px-4 py-16 sm:px-6 sm:py-20">
    <div
      className="mx-auto grid max-w-5xl grid-cols-1 gap-10 md:grid-cols-2 md:gap-16"
    >
      <div>
        <p className="text-sm font-medium text-foreground/60">Alternative</p>
        <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          An open-source alternative to Riverside and Loom.
        </h2>
        <p className="mt-3 text-base leading-7 text-foreground/70">
          Openside covers what most people reach for{" "}
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <RiversideIcon className="size-3.5" />
            Riverside
          </span>{" "}
          for, high-quality remote recording with separate tracks, and what
          they use{" "}
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <SiLoom className="size-3.5" />
            Loom
          </span>{" "}
          for, quick screen recordings shared with a link. It does both in one
          app, and you can read and run all of its code.
        </p>
      </div>
      <ul
        className="divide-y divide-border self-start overflow-hidden rounded-2xl border border-border bg-foreground/[0.03]"
      >
        {alternativePoints.map((point) => (
          <li
            key={point}
            className="flex items-start gap-3 px-5 py-3.5 text-[0.9375rem] leading-6 text-foreground/75"
          >
            <Check className="mt-1 size-4 shrink-0 text-green-600 dark:text-green-400" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  </section>
);

// Closing call to action: open and centered, no card, so it reads as the
// end of the page rather than one more box.
const SupportSection = () => (
  <section className="px-4 py-20 sm:px-6 sm:py-28">
    <div
      className="mx-auto flex max-w-2xl flex-col items-center text-center"
    >
      <span
        className="flex size-12 items-center justify-center rounded-xl bg-[#db61a2]/12 ring-1 ring-[#db61a2]/25"
      >
        <Heart className="size-5 fill-[#db61a2] text-[#db61a2]" />
      </span>
      <h2
        className="font-bricolage mt-6 text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl"
      >
        Help keep Openside open.
      </h2>
      <p
        className="mt-4 max-w-lg text-base leading-7 text-pretty text-foreground/65"
      >
        Sponsorships fund development and keep self-hosting free. A star on
        GitHub helps more people find it.
      </p>
      <div
        className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row"
      >
        <Link
          to="/sponsor"
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
        >
          <Heart className="size-4 fill-[#db61a2] text-[#db61a2]" />
          Become a sponsor
        </Link>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.05]"
        >
          <Star className="size-4" />
          Star on GitHub
        </a>
      </div>
      <p
        className="mt-4 text-xs text-foreground/45"
      >
        Monthly or one-time, through GitHub Sponsors.
      </p>
    </div>
  </section>
);

const OpenSourcePage = () => (
  <MarketingLayout
    hero={
      <PageHero
        eyebrow="Open source"
        title="An open-source recording studio you can run yourself"
        description="Openside is MIT licensed and built in the open. Use the hosted version, bring your own keys, or deploy the whole app from GitHub."
      />
    }
  >
    <RepoSection />
    <HostingSection />
    <ShippedSection />
    <ContributeSection />
    <AlternativeSection />
    <SupportSection />
  </MarketingLayout>
);

export default OpenSourcePage;
