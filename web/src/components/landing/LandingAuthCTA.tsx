import { memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/shared/ui/button";
import type { AuthMode } from "@/components/auth/AuthModal";
import { useCreateCheckout } from "@/hooks/useUsage";
import { toast } from "@/lib/toast";

// These components read Clerk's auth state themselves so the auth check runs in
// the background without re-rendering the whole landing page. While Clerk is
// still loading we keep the page interactive and just show a spinner inside the
// buttons.

type OpenAuth = (mode: AuthMode) => void;

export const HeaderAuthCTA = memo(
  ({ onOpenAuth }: { onOpenAuth: OpenAuth }) => {
    const { isSignedIn, isLoaded } = useAuth();

    if (!isLoaded) {
      return (
        <Button
          disabled
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          <Loader2 className="animate-spin" />
        </Button>
      );
    }

    if (isSignedIn) {
      return (
        <Button
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
          asChild
        >
          <Link to="/dashboard/home">Dashboard</Link>
        </Button>
      );
    }

    return (
      <>
        <Button
          variant="ghost"
          className="hidden rounded-full hover:bg-muted sm:inline-flex"
          onClick={() => onOpenAuth("signin")}
        >
          Sign in
        </Button>
        <Button
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
          onClick={() => onOpenAuth("signup")}
        >
          Start Creating
        </Button>
      </>
    );
  },
);
HeaderAuthCTA.displayName = "HeaderAuthCTA";

export const HeroAuthCTA = memo(({ onOpenAuth }: { onOpenAuth: OpenAuth }) => {
  const { isSignedIn, isLoaded } = useAuth();

  const handleClick = () => {
    onOpenAuth("signup");
  };

  if (!isLoaded || isSignedIn) return null;

  return (
    <Button
      size="lg"
      className="group relative overflow-hidden rounded-full bg-foreground text-background hover:bg-foreground/90"
      onClick={handleClick}
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full -skew-x-12 bg-gradient-to-r from-transparent via-background/40 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
      Start Creating
    </Button>
  );
});
HeroAuthCTA.displayName = "HeroAuthCTA";

// The pricing-card button. Reads Clerk auth itself so the check stays isolated
// from the rest of the landing page. Signed out → open the auth modal. Signed in
// → Pro starts a Polar checkout, everything else goes to the dashboard.
export const PricingCTA = memo(
  ({
    label,
    featured,
    isPro,
    className,
    onOpenAuth,
  }: {
    label: string;
    featured: boolean;
    isPro: boolean;
    className: string;
    onOpenAuth: OpenAuth;
  }) => {
    const { isSignedIn, isLoaded } = useAuth();
    const navigate = useNavigate();
    const checkout = useCreateCheckout();

    const handleClick = () => {
      if (!isLoaded) return;
      if (!isSignedIn) {
        onOpenAuth("signup");
        return;
      }
      if (isPro) {
        checkout.mutate(undefined, {
          onSuccess: (url) => {
            window.location.href = url;
          },
          onError: () =>
            toast.error("Couldn't start checkout. Try again in a moment."),
        });
        return;
      }
      navigate("/dashboard/home");
    };

    const busy = checkout.isPending;

    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!isLoaded || busy}
        className={className}
      >
        {busy ? "Starting..." : label}
      </button>
    );
  },
);
PricingCTA.displayName = "PricingCTA";
