/**
 * Client-side retention hints. The server is the source of truth for deletion
 * (see retention-service.ts); these helpers only render "deletes in X" so users
 * understand when a recording ages out. retentionHours === null (self-host)
 * means "never" - callers get null and show nothing.
 *
 * Age is measured from when the recording stopped (fallback: startedAt), matching
 * the sweep's own clock.
 */

export function retentionExpiryMs(
  endedAtIso: string | null | undefined,
  retentionHours: number | null | undefined,
): number | null {
  if (retentionHours == null || !endedAtIso) return null;
  const ended = new Date(endedAtIso).getTime();
  if (Number.isNaN(ended)) return null;
  return ended + retentionHours * 60 * 60 * 1000;
}

/** "3d 5h" / "3d" / "5h" / "<1h" / "soon" (past due, sweep pending), or null when never. */
export function formatRetentionRemaining(expiresAtMs: number | null): string | null {
  if (expiresAtMs == null) return null;
  const ms = expiresAtMs - Date.now();
  if (ms <= 0) return "soon";
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const remHours = Math.floor(hours % 24);
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
