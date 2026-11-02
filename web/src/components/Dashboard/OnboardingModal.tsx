import { useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import {
  BookOpen,
  Briefcase,
  Check,
  Clapperboard,
  Code,
  Ellipsis,
  GraduationCap,
  Megaphone,
  MessagesSquare,
  Mic,
  MonitorPlay,
  Presentation,
  Rocket,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import {
  FaGoogle,
  FaLinkedin,
  FaProductHunt,
  FaRedditAlien,
  FaXTwitter,
} from "react-icons/fa6";
import { backdropMotion, panelMotion, usePresence } from "@/hooks/usePresence";
import { useGetMe } from "@/hooks/useUserQuery";
import { type OnboardingAnswers, useSaveOnboarding } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";

// Shown once, right after signup. The ids match core/src/lib/onboarding.ts,
// which drops anything not on its list.

interface Option {
  id: string;
  label: string;
  icon?: ReactNode;
}

const HEARD_FROM: Option[] = [
  { id: "google", label: "Google search", icon: <FaGoogle /> },
  { id: "ai_assistant", label: "AI assistant", icon: <Sparkles /> },
  { id: "x", label: "X (Twitter)", icon: <FaXTwitter /> },
  { id: "linkedin", label: "LinkedIn", icon: <FaLinkedin /> },
  { id: "reddit", label: "Reddit", icon: <FaRedditAlien /> },
  { id: "product_hunt", label: "Product Hunt", icon: <FaProductHunt /> },
  { id: "friend", label: "Friend or colleague", icon: <Users /> },
  { id: "other", label: "Other", icon: <Ellipsis /> },
];

const ROLES: Option[] = [
  { id: "podcaster", label: "Podcaster", icon: <Mic /> },
  { id: "creator", label: "Content creator", icon: <Clapperboard /> },
  { id: "founder", label: "Founder", icon: <Rocket /> },
  { id: "marketer", label: "Marketer", icon: <Megaphone /> },
  { id: "educator", label: "Educator", icon: <GraduationCap /> },
  { id: "developer", label: "Developer", icon: <Code /> },
  { id: "agency", label: "Agency", icon: <Briefcase /> },
  { id: "other", label: "Other", icon: <Ellipsis /> },
];

const USE_CASES: Option[] = [
  { id: "podcasts", label: "Podcasts", icon: <Mic /> },
  { id: "interviews", label: "Interviews", icon: <MessagesSquare /> },
  { id: "video_content", label: "Video content", icon: <Video /> },
  { id: "webinars", label: "Webinars and events", icon: <Presentation /> },
  { id: "meetings", label: "Meetings", icon: <Users /> },
  { id: "tutorials", label: "Tutorials and demos", icon: <MonitorPlay /> },
  { id: "courses", label: "Courses and lessons", icon: <BookOpen /> },
  { id: "other", label: "Something else", icon: <Ellipsis /> },
];

const MONTHLY_HOURS: Option[] = [
  { id: "under_2", label: "Less than 2 hours" },
  { id: "2_5", label: "2–5 hours" },
  { id: "5_10", label: "5–10 hours" },
  { id: "10_20", label: "10–20 hours" },
  { id: "20_50", label: "20–50 hours" },
  { id: "50_plus", label: "More than 50 hours" },
];

type StepId = "heardFrom" | "role" | "useCases" | "monthlyHours";

const STEPS: {
  id: StepId;
  title: string;
  hint: string;
  options: Option[];
  multi?: boolean;
}[] = [
  {
    id: "heardFrom",
    title: "How did you hear about Openside?",
    hint: "Helps us know where to show up.",
    options: HEARD_FROM,
  },
  {
    id: "role",
    title: "What best describes you?",
    hint: "So we can shape Openside around your work.",
    options: ROLES,
  },
  {
    id: "useCases",
    title: "What will you record?",
    hint: "Pick as many as you like.",
    options: USE_CASES,
    multi: true,
  },
  {
    id: "monthlyHours",
    title: "How much will you record each month?",
    hint: "A rough guess is fine. Last one.",
    options: MONTHLY_HOURS,
  },
];

const OnboardingModal = () => {
  const { data: user } = useGetMe();
  const saveOnboarding = useSaveOnboarding();
  const presence = usePresence(user?.needsOnboarding === true);

  const [stepIndex, setStepIndex] = useState(0);
  // The first question's card height, which every later question keeps.
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [heardFrom, setHeardFrom] = useState<string | null>(null);
  const [heardFromOther, setHeardFromOther] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [roleOther, setRoleOther] = useState("");
  const [useCases, setUseCases] = useState<string[]>([]);
  const [monthlyHours, setMonthlyHours] = useState<string | null>(null);

  if (!presence.rendered) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const firstName = user?.name?.trim().split(" ")[0];

  const answers = (skipped: boolean): OnboardingAnswers => ({
    heardFrom,
    heardFromOther,
    role,
    roleOther,
    useCases,
    monthlyHours,
    skipped,
  });

  const save = (answered: OnboardingAnswers) => {
    saveOnboarding.mutate(answered);
  };

  const next = () => {
    if (isLast) save(answers(false));
    else setStepIndex((index) => index + 1);
  };

  const selected = (id: string) => {
    switch (step.id) {
      case "heardFrom":
        return heardFrom === id;
      case "role":
        return role === id;
      case "useCases":
        return useCases.includes(id);
      case "monthlyHours":
        return monthlyHours === id;
    }
  };

  const toggle = (id: string) => (current: string[]) =>
    current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];

  const choose = (id: string) => {
    switch (step.id) {
      case "heardFrom":
        setHeardFrom(id);
        break;
      case "role":
        setRole(id);
        break;
      case "useCases":
        setUseCases(toggle(id));
        return;
      case "monthlyHours":
        setMonthlyHours(id);
        break;
    }
    // A single choice moves on by itself - except "Other", which asks for
    // a few words first.
    if (id === "other") return;
    if (isLast) save({ ...answers(false), monthlyHours: id });
    else setStepIndex((index) => index + 1);
  };

  const otherText =
    step.id === "heardFrom" && heardFrom === "other"
      ? { value: heardFromOther, set: setHeardFromOther }
      : step.id === "role" && role === "other"
        ? { value: roleOther, set: setRoleOther }
        : null;

  // Something picked - and "Other" needs a few words too.
  const hasAnswer =
    step.options.some((option) => selected(option.id)) &&
    (!otherText || otherText.value.trim().length > 0);

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm ${backdropMotion(presence.isClosing)}`}
    >
      <div
        className={`my-auto flex w-full max-w-lg select-none flex-col gap-3 ${panelMotion(presence.isClosing)}`}
      >
        {/* The greeting sits in its own box above the questions. */}
        <div className="rounded-2xl border border-border/50 bg-[#f9f9fb] px-5 py-4 sm:px-6 dark:bg-[#0f0f11]">
          <p className="text-xl font-semibold tracking-tight text-foreground">
            Welcome to Openside
            {firstName && (
              <>
                {", "}
                <span className="font-bricolage">{firstName}</span>
              </>
            )}
          </p>
        </div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          // Every question keeps the first one's height, with Back/Next
          // pinned to the bottom, so the card doesn't jump between them.
          ref={(element) => {
            if (element && cardHeight === null && stepIndex === 0) {
              setCardHeight(element.offsetHeight);
            }
          }}
          style={cardHeight ? { minHeight: cardHeight } : undefined}
          className="relative flex w-full flex-col rounded-2xl border border-border/50 bg-[#f9f9fb] p-5 sm:p-6 dark:bg-[#0f0f11]"
        >
          <p className="text-xs font-medium text-fg-subtle">
            {stepIndex + 1} of {STEPS.length}
          </p>

          <div className="mt-3 flex gap-1.5" aria-hidden="true">
            {STEPS.map((item, index) => (
              <span
                key={item.id}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-200",
                  index <= stepIndex ? "bg-brand" : "bg-muted",
                )}
              />
            ))}
          </div>

          <h2
            id="onboarding-title"
            className="mt-5 text-lg font-semibold text-foreground"
          >
            {step.title}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">{step.hint}</p>

          <div
            key={step.id}
            role={step.multi ? "group" : "radiogroup"}
            aria-labelledby="onboarding-title"
            className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 animate-in fade-in-0 duration-150"
          >
            {step.options.map((option) => {
              const isSelected = selected(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role={step.multi ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  onClick={() => choose(option.id)}
                  className={cn(
                    "flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    isSelected
                      ? "border-brand bg-brand/10 text-foreground"
                      : "border-border bg-primary text-fg-muted hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {option.icon && (
                      <span
                        className={cn(
                          "flex shrink-0 text-base [&>svg]:size-4",
                          isSelected ? "text-brand" : "text-fg-subtle",
                        )}
                        aria-hidden="true"
                      >
                        {option.icon}
                      </span>
                    )}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {isSelected && (
                    <Check className="size-4 shrink-0 text-brand" />
                  )}
                </button>
              );
            })}
          </div>

          {otherText && (
            <input
              type="text"
              autoFocus
              maxLength={120}
              placeholder="Tell us more"
              value={otherText.value}
              onChange={(event) => otherText.set(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && hasAnswer) next();
              }}
              className="mt-3 w-full rounded-lg border border-border bg-primary px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-fg-faint focus:border-brand"
            />
          )}

          <div className="mt-auto flex items-center justify-between gap-3 pt-6">
            <button
              type="button"
              onClick={() => setStepIndex((index) => index - 1)}
              className={cn(
                "h-9 cursor-pointer rounded-lg border border-border bg-primary px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted",
                stepIndex === 0 && "invisible",
              )}
            >
              Back
            </button>
            {/* Only once something is picked (single choices also advance on
                click). */}
            {hasAnswer && (
              <button
                type="button"
                onClick={next}
                className="h-9 cursor-pointer rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 animate-in fade-in-0 duration-150"
              >
                {isLast ? "Finish" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default OnboardingModal;
