import { useEffect, useRef, useState } from "react";
import { AlignLeft, Users, X } from "lucide-react";
import { useScheduleSpace } from "@/hooks/useSpace";
import MeetingDateTimePicker from "./MeetingDateTimePicker";

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_DURATION_MINUTES = 60;

// Default the start to the next round half-hour.
const defaultStart = (): Date => {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 30 - (date.getMinutes() % 30), 0, 0);
  return date;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ScheduleModal = ({ open, onClose }: ScheduleModalProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState<Date>(defaultStart);
  const [durationMinutes, setDurationMinutes] = useState(
    DEFAULT_DURATION_MINUTES
  );
  const [inviteeInput, setInviteeInput] = useState("");
  const [invitees, setInvitees] = useState<string[]>([]);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: scheduleSpace, isPending } = useScheduleSpace();

  useEffect(() => {
    if (open) {
      titleInputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Reset the form whenever the modal is reopened.
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setStartAt(defaultStart());
      setDurationMinutes(DEFAULT_DURATION_MINUTES);
      setInviteeInput("");
      setInvitees([]);
    }
  }, [open]);

  if (!open) return null;

  // A valid email typed but not yet committed still counts as an invitee.
  const pendingInvitee = inviteeInput.trim().toLowerCase();
  const hasInvitee =
    invitees.length > 0 || (!!pendingInvitee && EMAIL_RE.test(pendingInvitee));
  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    hasInvitee &&
    !Number.isNaN(startAt.getTime()) &&
    startAt.getTime() > Date.now();

  const commitInvitee = () => {
    const email = inviteeInput.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      return;
    }
    if (!invitees.includes(email)) {
      setInvitees((current) => [...current, email]);
    }
    setInviteeInput("");
  };

  const removeInvitee = (email: string) => {
    setInvitees((current) => current.filter((e) => e !== email));
  };

  const handleSubmit = async () => {
    if (Number.isNaN(startAt.getTime())) {
      return;
    }
    if (startAt.getTime() <= Date.now()) {
      return;
    }

    // Fold a half-typed email in the input into the list before submitting.
    const pending = inviteeInput.trim().toLowerCase();
    const finalInvitees = [...invitees];
    if (pending && EMAIL_RE.test(pending) && !finalInvitees.includes(pending)) {
      finalInvitees.push(pending);
    }

    try {
      await scheduleSpace({
        // Throwaway at schedule time - the host is rematched by role on start.
        participantSessionId: crypto.randomUUID(),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        scheduledFor: startAt.toISOString(),
        durationMinutes,
        invitees: finalInvitees,
      });

      onClose();
    } catch {
      // Keep the modal open so the user can correct the details and retry.
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close schedule recording dialog"
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm cursor-default animate-in fade-in duration-200"
      />
      <div className="fixed left-1/2 top-1/2 z-[110] w-[min(520px,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-xl border border-border bg-background shadow-2xl shadow-black/30 animate-in fade-in zoom-in-95 duration-200">
          {/* Header: the title field doubles as the heading */}
          <div className="flex items-start gap-3 px-5 pt-5">
            <input
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled Recording"
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-fg-faint"
            />
          </div>

          <div className="flex flex-col gap-2.5 px-5 py-5">
            {/* Date & time */}
            <MeetingDateTimePicker
              value={startAt}
              durationMinutes={durationMinutes}
              onChange={(start, duration) => {
                setStartAt(start);
                setDurationMinutes(duration);
              }}
            />

            {/* Invitees */}
            <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-primary px-3 py-3 scrollbar-hide">
              <Users size={16} className="shrink-0 text-foreground" />
              {invitees.map((email) => (
                <span
                  key={email}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-background px-2.5 text-sm text-foreground"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() => removeInvitee(email)}
                    aria-label={`Remove ${email}`}
                    className="text-fg-subtle hover:text-foreground cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              <input
                value={inviteeInput}
                onChange={(e) => setInviteeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    commitInvitee();
                  }
                  // Backspace on an empty input removes the last chip.
                  if (e.key === "Backspace" && !inviteeInput && invitees.length) {
                    removeInvitee(invitees[invitees.length - 1]);
                  }
                }}
                onBlur={commitInvitee}
                placeholder={invitees.length ? "" : "Invite people by email"}
                className="h-7 min-w-[120px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-fg-faint"
              />
            </div>

            {/* Description */}
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-primary px-3 py-3">
              <AlignLeft
                size={16}
                className="mt-0.5 shrink-0 text-foreground"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description"
                rows={3}
                className="min-w-0 flex-1 resize-y bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-fg-faint"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !canSubmit}
              className="rounded-md bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isPending ? "Scheduling…" : "Schedule"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ScheduleModal;
