import { memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { BsFillRecordCircleFill } from "react-icons/bs";

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
          className="w-[104px] rounded-full bg-foreground text-background hover:bg-foreground/90 sm:w-[132px]"
        >
          <Loader2 className="animate-spin" />
        </Button>
      );
    }

    if (isSignedIn) {
      return (
        <Button
          className="w-[104px] rounded-full bg-foreground text-background hover:bg-foreground/90 sm:w-[132px]"
          asChild
        >
          <Link to="/dashboard/home">Dashboard</Link>
        </Button>
      );
    }

    return (
      <Button
        className="w-[104px] rounded-full bg-foreground text-background hover:bg-foreground/90 sm:w-[132px]"
        onClick={() => onOpenAuth("signup")}
      >
        Get Started
      </Button>
    );
  },
);
HeaderAuthCTA.displayName = "HeaderAuthCTA";

// The hero's "Start Recording" button. Reads Clerk auth itself so the check
// stays isolated from the rest of the (animated) hero. Signed in → straight to
// the dashboard. Signed out → open the auth modal.
export const StartRecordingCTA = memo(
  ({ className, onOpenAuth }: { className: string; onOpenAuth: OpenAuth }) => {
    const { isSignedIn, isLoaded } = useAuth();
    const navigate = useNavigate();

    const handleClick = () => {
      if (!isLoaded) return;
      if (isSignedIn) {
        navigate("/dashboard/home");
        return;
      }
      onOpenAuth("signup");
    };

    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!isLoaded}
        className={className}
      >
        <BsFillRecordCircleFill className="size-4 animate-pulse text-red-500" />
        Start Recording
      </button>
    );
  },
);
StartRecordingCTA.displayName = "StartRecordingCTA";

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
