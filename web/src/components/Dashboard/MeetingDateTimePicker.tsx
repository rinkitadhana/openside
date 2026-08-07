import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

interface MeetingDateTimePickerProps {
  // Start of the meeting.
  value: Date;
  // Meeting length in minutes (drives the end time).
  durationMinutes: number;
  onChange: (start: Date, durationMinutes: number) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
// 30-minute slots across the day -> 48 options.
const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => i * 30);

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (date: Date) => {
  const result = startOfDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const formatMinutes = (mins: number) => {
  const total = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
};

const formatDateLabel = (date: Date) =>
  new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(date);

// A small popover surface that closes on outside click / Escape.
const Popover = ({
  onClose,
  align = "left",
  children,
}: {
  onClose: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`absolute top-[calc(100%+8px)] z-[120] ${
        align === "right" ? "right-0" : "left-0"
      } animate-in fade-in zoom-in-95 duration-150`}
    >
      {children}
    </div>
  );
};

const MeetingDateTimePicker = ({
  value,
  durationMinutes,
  onChange,
}: MeetingDateTimePickerProps) => {
  const [openPanel, setOpenPanel] = useState<"date" | "start" | "end" | null>(
    null
  );
  const [viewMonth, setViewMonth] = useState(() => startOfDay(value));

  const startMins = value.getHours() * 60 + value.getMinutes();
  const endMins = startMins + durationMinutes;

  const monthGrid = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [viewMonth]);

  const selectDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(next, durationMinutes);
    setOpenPanel(null);
  };

  const selectStart = (mins: number) => {
    const next = new Date(value);
    next.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    // Keep the meeting length the same when the start moves.
    onChange(next, durationMinutes);
    setOpenPanel(null);
  };

  const selectEnd = (mins: number) => {
    // End is always after start; if an earlier slot is chosen, roll to next day.
    const duration = mins > startMins ? mins - startMins : mins + 1440 - startMins;
    onChange(value, duration);
    setOpenPanel(null);
  };

  const fieldClass =
    "flex items-center gap-2 rounded-lg border border-border bg-primary px-3 py-3 text-sm text-foreground cursor-pointer";

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {/* Date */}
      <div className="relative min-w-[180px] flex-1">
        <button
          type="button"
          onClick={() => {
            setViewMonth(startOfDay(value));
            setOpenPanel((p) => (p === "date" ? null : "date"));
          }}
          className={`w-full ${fieldClass}`}
        >
          <CalendarDays size={16} className="shrink-0 text-foreground" />
          <span className="font-normal">{formatDateLabel(value)}</span>
        </button>

        {openPanel === "date" && (
          <Popover onClose={() => setOpenPanel(null)}>
            <div className="w-[320px] rounded-xl border border-border bg-background p-4 shadow-2xl shadow-black/30">
              <div className="mb-3 flex items-center justify-between px-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                  className="flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-primary hover:text-foreground cursor-pointer"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-semibold text-foreground">
                  {new Intl.DateTimeFormat("en", {
                    month: "long",
                    year: "numeric",
                  }).format(viewMonth)}
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-primary hover:text-foreground cursor-pointer"
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="grid grid-cols-7">
                {WEEKDAYS.map((d, i) => (
                  <div
                    key={`${d}-${i}`}
                    className="flex h-9 items-center justify-center text-xs font-medium text-foreground"
                  >
                    {d}
                  </div>
                ))}
                {monthGrid.map((day) => {
                  const inMonth = day.getMonth() === viewMonth.getMonth();
                  const selected = isSameDay(day, value);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={`mx-auto flex size-9 items-center justify-center rounded-full text-sm transition-colors cursor-pointer ${
                        selected
                          ? "bg-primary font-semibold text-background"
                          : inMonth
                          ? "text-foreground hover:bg-primary"
                          : "text-fg-subtle hover:bg-primary"
                      }`}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          </Popover>
        )}
      </div>

      {/* Times */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPanel((p) => (p === "start" ? null : "start"))}
            className={fieldClass}
          >
            <span className="font-normal tabular-nums">
              {formatMinutes(startMins)}
            </span>
          </button>
          {openPanel === "start" && (
            <Popover onClose={() => setOpenPanel(null)}>
              <TimeList
                selected={((startMins % 1440) + 1440) % 1440}
                onSelect={selectStart}
              />
            </Popover>
          )}
        </div>

        <span className="text-foreground">–</span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPanel((p) => (p === "end" ? null : "end"))}
            className={fieldClass}
          >
            <span className="font-normal tabular-nums">
              {formatMinutes(endMins)}
            </span>
          </button>
          {openPanel === "end" && (
            <Popover onClose={() => setOpenPanel(null)} align="right">
              <TimeList
                selected={((endMins % 1440) + 1440) % 1440}
                onSelect={selectEnd}
                referenceMins={startMins}
              />
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
};

// Scrollable list of half-hour time options. When a `referenceMins` (start) is
// given, each option also shows the resulting duration.
const TimeList = ({
  selected,
  onSelect,
  referenceMins,
}: {
  selected: number;
  onSelect: (mins: number) => void;
  referenceMins?: number;
}) => (
  <div className="max-h-[260px] w-[180px] overflow-y-auto rounded-xl border border-border bg-background p-1.5 shadow-2xl shadow-black/30 scrollbar-hide">
    {TIME_SLOTS.map((mins) => {
      const isSelected = mins === selected;
      const duration =
        referenceMins !== undefined
          ? mins > referenceMins
            ? mins - referenceMins
            : mins + 1440 - referenceMins
          : null;
      return (
        <button
          key={mins}
          type="button"
          onClick={() => onSelect(mins)}
          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors cursor-pointer ${
            isSelected
              ? "bg-primary font-semibold text-background"
              : "text-foreground hover:bg-primary"
          }`}
        >
          <span className="tabular-nums">{formatMinutes(mins)}</span>
          {duration !== null && (
            <span
              className={`text-xs ${
                isSelected ? "text-background/70" : "text-foreground"
              }`}
            >
              {duration % 60 === 0
                ? `${duration / 60} hr`
                : `${Math.floor(duration / 60) > 0 ? `${Math.floor(duration / 60)}h ` : ""}${duration % 60}m`}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

export default MeetingDateTimePicker;
