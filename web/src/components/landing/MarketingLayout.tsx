import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import { Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

import AuthModal, { type AuthMode } from "@/components/auth/AuthModal";
import GithubStarButton from "@/components/landing/GithubStarButton";
import JsonLd from "@/components/landing/JsonLd";
import { HeaderAuthCTA } from "@/components/landing/LandingAuthCTA";
import {
  EASE,
  containerVariants,
  riseVariants,
} from "@/components/landing/motion";
import { useHydrated } from "@/hooks/useHydrated";
import { useSeoMeta } from "@/hooks/useSeoMeta";
import { getStructuredData } from "@/lib/seo";

export const NAV_LINKS = [
  { to: "/#features", label: "Features" },
  { to: "/#use-cases", label: "Use cases" },
  { to: "/open-source", label: "Open source" },
  { to: "/pricing", label: "Pricing" },
];

type OpenAuth = (mode: AuthMode) => void;

// Lets CTAs anywhere on a marketing page open the shared auth modal.
const OpenAuthContext = createContext<OpenAuth>(() => {});
export const useOpenAuth = () => useContext(OpenAuthContext);

// Full-width horizontal line between stacked sections, with a small square
// where it meets each side border. Desktop-only chrome.
export const SectionDivider = () => (
  <div className="relative hidden border-t border-border md:block">
    <span className="absolute left-[-0.5px] top-[-0.5px] z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-border bg-background" />
    <span className="absolute right-[-0.5px] top-[-0.5px] z-10 size-2.5 translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-border bg-background" />
  </div>
);

const themeOptions = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();
  // The prerendered HTML can't know the stored theme, so show "system" until
  // hydration is done, then the real choice.
  const hydrated = useHydrated();
  const current = (hydrated && theme) || "system";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex w-fit items-center gap-0.5 rounded-lg border border-white/20 bg-white/5 p-0.5"
    >
      {themeOptions.map(({ id, label, icon: Icon }) => {
        const selected = current === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={`flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors ${
              selected
                ? "bg-white/20 text-white"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
};

const MarketingHeader = ({ onOpenAuth }: { onOpenAuth: OpenAuth }) => {
  const { pathname, hash } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Clicking the section link you're already on doesn't change the URL, so
  // the layout's hash effect won't fire - scroll to it here instead.
  const scrollIfCurrent = (to: string) => {
    if (to.includes("#") && `${pathname}${hash}` === to) {
      document
        .getElementById(to.split("#")[1])
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <nav className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-4 py-3 sm:px-0">
        <Link to="/" className="flex items-center gap-2 justify-self-start">
          <img
            src="/logo/logo-dark.png"
            className="h-full w-[24px] select-none"
            alt="Openside"
          />
          <span className="text-lg font-bold uppercase text-white">
            Openside
          </span>
        </Link>

        <nav
          aria-label="Main navigation"
          className="col-start-2 hidden items-center gap-2 justify-self-center text-sm font-medium text-white/80 md:flex"
        >
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              onClick={() => scrollIfCurrent(to)}
              aria-current={pathname === to ? "page" : undefined}
              className={`rounded-full px-3 py-2 transition-colors hover:bg-white/10 hover:text-white ${
                pathname === to ? "bg-white/10 text-white" : ""
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="col-start-3 flex items-center justify-self-end gap-1.5 sm:gap-2">
          <span className="hidden sm:inline-flex">
            <GithubStarButton />
          </span>
          <span className="hidden md:inline-flex">
            <HeaderAuthCTA onOpenAuth={onOpenAuth} />
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 md:hidden"
          >
            {mobileMenuOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden md:hidden"
          >
            <nav
              aria-label="Mobile navigation"
              className="mx-4 mb-3 flex flex-col gap-1 rounded-2xl bg-[#0041aa] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.25)]"
            >
              {NAV_LINKS.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    scrollIfCurrent(to);
                  }}
                  className="rounded-xl px-4 py-3 text-sm font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {label}
                </Link>
              ))}
              <div className="mt-1 flex items-center gap-2 border-t border-white/15 pt-3">
                <span className="sm:hidden">
                  <GithubStarButton />
                </span>
                <span className="ml-auto">
                  <HeaderAuthCTA onOpenAuth={onOpenAuth} />
                </span>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

const footerColumns = [
  {
    title: "Product",
    links: NAV_LINKS,
  },
  {
    title: "Company",
    links: [
      { to: "/sponsor", label: "Sponsor" },
      { to: "https://x.com/damngruz", label: "Contact us" },
      { to: "https://github.com/rinkitadhana/openside", label: "GitHub" },
    ],
  },
  {
    title: "Legal",
    links: [
      { to: "/privacy", label: "Privacy Policy" },
      { to: "/terms", label: "Terms of Service" },
    ],
  },
];

const MarketingFooter = () => (
  <footer className="relative overflow-hidden bg-[url('/img/landing/hero-bg.webp')] bg-cover bg-top px-4 py-20 sm:px-6 sm:py-24">
    <div className="absolute inset-0 bg-black/20" />
    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
    <motion.div
      className="relative mx-auto grid max-w-5xl grid-cols-2 gap-12 sm:grid-cols-[1.4fr_1fr_1fr_1fr]"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-100px" }}
      variants={containerVariants}
    >
      <motion.div variants={riseVariants} className="col-span-2 sm:col-span-1">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src="/logo/logo-dark.png"
            className="w-7 select-none"
            alt="Openside"
          />
          <span className="font-bricolage text-xl font-bold uppercase text-white">
            Openside
          </span>
        </Link>
        <p className="mt-4 max-w-xs text-base leading-7 text-white/70">
          Open-source, self-hostable recording studio for podcasts, meetings,
          and interviews.
        </p>
        <div className="mt-5 flex items-center gap-2.5">
          <a
            href="https://github.com/rinkitadhana/openside"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="flex size-10 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white transition-colors hover:bg-white/15"
          >
            <FaGithub className="size-4" />
          </a>
          <a
            href="https://x.com/damngruz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X (Twitter)"
            className="flex size-10 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white transition-colors hover:bg-white/15"
          >
            <FaXTwitter className="size-4" />
          </a>
        </div>
      </motion.div>

      {footerColumns.map(({ title, links }) => (
        <motion.div key={title} variants={riseVariants}>
          <p className="text-sm font-semibold uppercase tracking-wide text-white/50">
            {title}
          </p>
          <div className="mt-4 flex flex-col gap-3 text-base text-white/75">
            {links.map(({ to, label }) =>
              to.startsWith("http") ? (
                <a
                  key={to}
                  href={to}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit hover:text-white"
                >
                  {label}
                </a>
              ) : (
                <Link key={to} to={to} className="w-fit hover:text-white">
                  {label}
                </Link>
              ),
            )}
          </div>
        </motion.div>
      ))}
    </motion.div>
    <motion.div
      className="relative mx-auto mt-12 flex max-w-5xl flex-col gap-2 border-t border-white/20 pt-6 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-100px" }}
      variants={riseVariants}
    >
      <p>
        © {new Date().getFullYear()} Openside. Open source under the MIT
        License.
      </p>
      <div className="flex items-center gap-4">
        <p className="text-white/50">Built for creators who own their footage.</p>
        <ThemeSwitcher />
      </div>
    </motion.div>
  </footer>
);

// Shell for every public marketing page: the header and hero band on the
// hero artwork, the bordered content column, the footer, and the auth modal.
const MarketingLayout = ({
  hero,
  heroClassName = "",
  heroArt = "sky",
  children,
}: {
  hero: ReactNode;
  heroClassName?: string;
  /**
   * "full" shows the whole scene (the full-height home hero). "sky" draws the
   * same scene at the same size, cut off below a short band.
   */
  heroArt?: "full" | "sky";
  children: ReactNode;
}) => {
  const { pathname, hash } = useLocation();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");

  useSeoMeta();
  const structuredData = getStructuredData(pathname);

  // Each marketing page starts at the top, unless the link targets a section.
  // Instant, because the global smooth scrolling would otherwise glide up
  // from wherever the previous page was scrolled to.
  // Client-side navigation doesn't jump to the hash, so find the section
  // ourselves (retrying briefly while the page renders).
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }
    let frame = 0;
    let tries = 0;
    const scrollToHash = () => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (tries++ < 30) frame = requestAnimationFrame(scrollToHash);
    };
    scrollToHash();
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  // Stable so the memoized auth CTAs don't re-render on every page render.
  const openAuth = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  return (
    <OpenAuthContext.Provider value={openAuth}>
      <div className="landing relative min-h-screen bg-background text-foreground">
        {structuredData && <JsonLd data={structuredData} />}
        <MarketingHeader onOpenAuth={openAuth} />

        <main>
          <div
            className={`relative overflow-hidden bg-background px-4 pt-24 sm:px-6 sm:pt-28 ${
              heroArt === "sky" ? "min-h-[31rem] sm:min-h-[34rem]" : ""
            } ${heroClassName}`}
          >
            {/* The sky band has a fixed minimum height so it doesn't change
                between pages, and draws the artwork at the home hero's height
                so the image doesn't shift when switching from the home page. */}
            <div
              className={`absolute inset-x-0 top-0 z-0 bg-[url('/img/landing/hero-bg.webp')] bg-cover bg-bottom ${
                heroArt === "full" ? "bottom-0" : "h-(--hero-art-height)"
              }`}
            />
            {hero}
          </div>

          <div className="mx-auto max-w-6xl border-x-0 border-border md:border-x">
            {children}
          </div>
        </main>

        <MarketingFooter />

        <AuthModal
          open={authOpen}
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthOpen(false)}
        />
      </div>
    </OpenAuthContext.Provider>
  );
};

export default MarketingLayout;
