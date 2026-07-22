/**
 * Tiny self-contained toast (no external library).
 *
 * The site removed react-hot-toast, so this is a minimal, purpose-built toast
 * for the few places that genuinely need a confirmation (e.g. "invite sent").
 * A module-level store drives a single <ToastHost /> mounted in AppProviders.
 *
 * USAGE:
 *   import { toast } from "@/lib/toast";
 *   toast.success("Invite sent to name@example.com");
 *   toast.error("Couldn't send the invite");
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FaSquareCheck, FaSquareMinus } from "react-icons/fa6";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

const emit = () => {
  for (const listener of listeners) listener();
};

const dismiss = (id: number) => {
  items = items.filter((item) => item.id !== id);
  emit();
};

const push = (message: string, variant: ToastVariant, durationMs: number) => {
  const id = nextId++;
  items = [...items, { id, message, variant }];
  emit();
  if (durationMs !== Infinity) {
    window.setTimeout(() => dismiss(id), durationMs);
  }
  return id;
};

export const toast = {
  success: (message: string, durationMs = 4000) =>
    push(message, "success", durationMs),
  error: (message: string, durationMs = 4000) =>
    push(message, "error", durationMs),
  dismiss,
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => items;

const VARIANTS = {
  success: {
    Icon: FaSquareCheck,
    accent: "text-emerald-500",
    role: "status" as const,
  },
  error: {
    Icon: FaSquareMinus,
    accent: "text-red-500",
    role: "alert" as const,
  },
};

const ToastCard = ({ item }: { item: ToastItem }) => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const meta = VARIANTS[item.variant];
  const { Icon } = meta;

  return (
    <div
      role={meta.role}
      aria-live={meta.role === "alert" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-fit max-w-sm items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 transition-all duration-300 ease-out dark:border-white/12 dark:bg-muted",
        shown ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
    >
      <Icon className={cn("size-[1.375rem] shrink-0", meta.accent)} />
      <p className="min-w-0 text-[15px] font-normal leading-snug text-foreground">
        {item.message}
      </p>
    </div>
  );
};

/** Mounted once (in AppProviders) - renders the active toasts. */
export const ToastHost = () => {
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[9999] flex flex-col items-center gap-2 px-4">
      {active.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  );
};
