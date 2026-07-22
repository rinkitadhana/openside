/**
 * CLOCK SYNC CONTEXT
 *
 * PURPOSE:
 * Makes the SERVER the single source of truth for time.
 *
 * A browser's own clock (`Date.now()`) can be off by seconds, so we never trust
 * it directly for recording timing. Instead, on connect each client runs an
 * NTP-style handshake against the server and learns its own clock offset. Every
 * recording timestamp (start, join, screen-share, stop) is then expressed in
 * server time via `getServerTime()`, so all participants line up on one timeline
 * no matter how wrong their local clocks are.
 *
 * HOW THE HANDSHAKE WORKS (per sample):
 *   t1 = client time before the ping
 *   serverTime = server's clock, returned via the socket ack
 *   t2 = client time when the ack arrives
 *   round-trip = t2 - t1   (assume ~half each way)
 *   offset = serverTime - (t1 + t2) / 2
 * We take several samples and keep the one with the smallest round-trip, since
 * the least-delayed ping gives the most accurate offset (standard NTP practice).
 */

"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useSocket } from "@/context/socket";

/** Number of pings per sync. More samples → better chance of a clean round-trip. */
const SAMPLE_COUNT = 5;
/** Delay between samples so we probe across slightly different network conditions. */
const SAMPLE_GAP_MS = 120;
/** A single ping is abandoned if the server doesn't answer within this window. */
const SAMPLE_TIMEOUT_MS = 3000;
/** Re-sync periodically to correct slow clock drift over a long session. */
const RESYNC_INTERVAL_MS = 60_000;

interface ClockSyncValue {
  /** Current time on the server's clock, in ms since epoch. */
  getServerTime: () => number;
  /** How far this client's clock is from the server (serverTime - localTime), in ms. */
  offsetMs: number;
  /** Round-trip time of the best sample, in ms (lower = more confident). */
  rttMs: number;
  /** True once at least one successful handshake has completed. */
  synced: boolean;
  /** Resolves once the clock is synced, or after `timeoutMs` (resolves the
   *  synced state either way). Await this before measuring a timestamp that
   *  must be accurate, so a very fast recording start never uses a raw local
   *  clock before the first handshake lands. */
  waitUntilSynced: (timeoutMs?: number) => Promise<boolean>;
}

const ClockSyncContext = createContext<ClockSyncValue>({
  getServerTime: () => Date.now(),
  offsetMs: 0,
  rttMs: 0,
  synced: false,
  waitUntilSynced: async () => false,
});

/** Returns the server-time helpers. Falls back to the local clock until synced. */
export const useClockSync = (): ClockSyncValue => useContext(ClockSyncContext);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ClockSyncProvider = ({ children }: { children: ReactNode }) => {
  const socket = useSocket();
  // Live offset lives in a ref so getServerTime() always reads the freshest value
  // without forcing consumers to re-render. State mirrors it for anyone that
  // wants to display sync status.
  const offsetRef = useRef(0);
  const syncedRef = useRef(false);
  const [status, setStatus] = useState({ offsetMs: 0, rttMs: 0, synced: false });

  const getServerTime = useCallback(() => Date.now() + offsetRef.current, []);

  const waitUntilSynced = useCallback(
    (timeoutMs = 2000): Promise<boolean> => {
      if (syncedRef.current) return Promise.resolve(true);
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          if (syncedRef.current) return resolve(true);
          if (Date.now() - start >= timeoutMs) return resolve(false);
          setTimeout(check, 50);
        };
        check();
      });
    },
    [],
  );

  useEffect(() => {
    if (!socket) return;

    let cancelled = false;

    // One ping. Resolves to null if the server doesn't ack in time.
    const measureOnce = () =>
      new Promise<{ offset: number; rtt: number } | null>((resolve) => {
        const t1 = Date.now();
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, SAMPLE_TIMEOUT_MS);

        socket.emit("time:sync", (serverTime: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const t2 = Date.now();
          resolve({ offset: serverTime - (t1 + t2) / 2, rtt: t2 - t1 });
        });
      });

    const sync = async () => {
      const samples: { offset: number; rtt: number }[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        if (cancelled) return;
        const sample = await measureOnce();
        if (sample) samples.push(sample);
        if (i < SAMPLE_COUNT - 1) await sleep(SAMPLE_GAP_MS);
      }
      if (cancelled || samples.length === 0) return;

      // Smallest round-trip = least network jitter = most trustworthy offset.
      const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      offsetRef.current = best.offset;
      syncedRef.current = true;
      setStatus({
        offsetMs: Math.round(best.offset),
        rttMs: Math.round(best.rtt),
        synced: true,
      });
      if (import.meta.env.DEV) {
        console.log(
          `[ClockSync] offset ${Math.round(best.offset)}ms (rtt ${Math.round(
            best.rtt,
          )}ms, ${samples.length}/${SAMPLE_COUNT} samples)`,
        );
      }
    };

    void sync();
    const interval = setInterval(() => void sync(), RESYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [socket]);

  return (
    <ClockSyncContext.Provider
      value={{
        getServerTime,
        offsetMs: status.offsetMs,
        rttMs: status.rttMs,
        synced: status.synced,
        waitUntilSynced,
      }}
    >
      {children}
    </ClockSyncContext.Provider>
  );
};
