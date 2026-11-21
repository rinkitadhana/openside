import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/lib/toast";
import { backdropMotion, panelMotion, usePresence } from "@/hooks/usePresence";
import { useCreateCheckout, useUsage, type Usage } from "@/hooks/useUsage";

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
}

const plans: {
  id: Usage["plan"];
  name: string;
  price: string;
  priceSuffix?: string;
  description: string;
  features: string[];
  featured?: boolean;
}[] = [
  {
    id: "demo",
    name: "Demo",
    price: "Free",
    description: "Try Openside instantly, no keys or setup required.",
    features: [
      "720p recording",
      "44.1kHz audio",
      "15 minutes of recording",
      "Up to 2 participants",
      "48-hour retention",
      "Includes watermark",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$8.99",
    priceSuffix: "/mo",
    description: "Managed infrastructure with zero setup. Just hit record.",
    features: [
      "Up to 4K recording",
      "48kHz audio",
      "20 hrs recording/month",
      "Up to 5 participants",
      "30-day recording retention",
      "No watermark",
      "Cloud backup",
      "Upload videos",
    ],
    featured: true,
  },
  {
    id: "selfhost",
    name: "Self-host",
    price: "Free",
    description: "Unlimited when you run it on your own LiveKit and R2 keys.",
    features: [
      "Up to 4K recording",
      "48kHz audio",
      "Unlimited recording",
      "Unlimited participants",
      "Unlimited retention",
      "No watermark",
      "Cloud backup",
      "Upload videos",
    ],
  },
];

/** Plan picker shown over the dashboard when a free user hits Upgrade. */
const PricingModal = ({ open, onClose }: PricingModalProps) => {
  const navigate = useNavigate();
  const { data: usage } = useUsage();
  const checkout = useCreateCheckout();
  const currentPlan = usage?.plan ?? "demo";

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const { rendered, isClosing } = usePresence(open);
  if (!rendered) return null;

  const handleSelect = (planId: Usage["plan"]) => {
    if (planId === "pro") {
      checkout.mutate(undefined, {
        onSuccess: (url) => {
          window.location.href = url;
        },
        onError: () =>
          toast.error("Couldn't start checkout. Try again in a moment."),
      });
    } else if (planId === "selfhost") {
      onClose();
      navigate("/dashboard/settings?section=selfhost");
    }
  };

  const ctaLabel = (planId: Usage["plan"]) => {
    if (planId === currentPlan) return "Current plan";
    if (planId === "pro")
      return checkout.isPending ? "Starting..." : "Upgrade to Pro";
    if (planId === "selfhost") return "Set up self-host";
    return "Free";
  };

  // Portaled so a transformed ancestor (e.g. the mobile sidebar drawer) can't trap it.
  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm ${backdropMotion(isClosing)}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-modal-title"
      onClick={onClose}
    >
      <div
        className={`relative my-auto w-full max-w-4xl rounded-2xl border border-border/50 bg-[#f9f9fb] p-5 sm:p-6 dark:bg-[#0f0f11] ${panelMotion(isClosing)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={16} />
        </button>

        <div className="pr-10">
          <h2
            id="pricing-modal-title"
            className="text-lg font-semibold text-foreground"
          >
            Choose your plan
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Self-host it for free, or let us handle the infrastructure. Cancel
            anytime.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const disabled =
              isCurrent ||
              plan.id === "demo" ||
              (plan.id === "pro" && checkout.isPending);

            return (
              <div
                key={plan.id}
                className={`flex min-h-[460px] flex-col rounded-xl border p-6 ${
                  plan.featured
                    ? "border-brand/40 bg-brand/5 ring-1 ring-brand/20"
                    : "border-border/50 bg-primary"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-foreground">
                    {plan.name}
                  </h3>
                  {isCurrent ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-fg-muted">
                      Current
                    </span>
                  ) : (
                    plan.featured && (
                      <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-medium text-brand">
                        Popular
                      </span>
                    )
                  )}
                </div>

                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tracking-tight text-foreground">
                    {plan.price}
                  </span>
                  {plan.priceSuffix && (
                    <span className="text-sm text-fg-subtle">
                      {plan.priceSuffix}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-sm leading-6 text-fg-muted">
                  {plan.description}
                </p>

                <ul className="mt-6 mb-8 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-foreground/80"
                    >
                      <Check
                        size={15}
                        className={`mt-0.5 shrink-0 ${
                          plan.featured ? "text-brand" : "text-foreground"
                        }`}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => handleSelect(plan.id)}
                  disabled={disabled}
                  className={`mt-auto h-9 w-full cursor-pointer rounded-lg px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                    plan.featured
                      ? "bg-brand text-white"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {ctaLabel(plan.id)}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PricingModal;
