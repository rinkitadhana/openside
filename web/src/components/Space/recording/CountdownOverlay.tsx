/**
 * CountdownOverlay
 *
 * Full-screen, centered 3-2-1 lead-in shown to EVERYONE in the room while the
 * synced countdown runs (recordingState === "countdown"). The number re-keys
 * each tick so the pop animation replays. Non-interactive (pointer-events-none)
 * so it never blocks the call UI underneath.
 */

interface CountdownOverlayProps {
  value: number | null;
}

const CountdownOverlay = ({ value }: CountdownOverlayProps) => {
  if (value == null) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/40 backdrop-blur-[2px]">
      <span
        key={value}
        className="flex size-32 animate-pulse items-center justify-center rounded-full bg-red-500/90 text-7xl font-bold tabular-nums text-white shadow-2xl"
      >
        {value}
      </span>
      <p className="text-lg font-medium text-white/90">Recording starts…</p>
    </div>
  );
};

export default CountdownOverlay;
