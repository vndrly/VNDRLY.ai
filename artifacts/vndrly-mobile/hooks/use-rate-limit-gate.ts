import { useEffect, useRef, useState } from "react";

import {
  getRateLimitDeadline,
  getRateLimitRetrySeconds,
  noteRateLimit,
  subscribeRateLimit,
} from "@/lib/rateLimitGate";

// Task #699 — generic per-resource mobile rate-limit hook.
//
// Mirrors the existing `use-tickets-rate-limit-gate.ts` (Task #686) but
// is scoped per server-side `code`. The notifications bell, comments
// panel, and hotlist screens each hit different limiters on the server,
// so they each instantiate this hook with their own code. Within a
// single resource (e.g. notifications), all call sites share state via
// the module-level cooldown in `lib/rateLimitGate.ts` so the foreground
// list and the background badge poll park together.

export interface RateLimitGate {
  /**
   * True while the page is parked. Use to skip auto-poll loops, disable
   * manual-refresh affordances, and surface the existing reconnecting /
   * pause UX so users see a familiar "we'll retry shortly" indicator.
   */
  rateLimited: boolean;
  /**
   * Seconds remaining in the current cooldown window (rounded up), or
   * null when not rate-limited. Useful for friendly toast/banner copy
   * like "retrying in {{seconds}}s".
   */
  retryAfterSeconds: number | null;
}

function deadlineToSeconds(
  deadline: number | null,
  now: number,
): number | null {
  if (deadline == null) return null;
  const ms = deadline - now;
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Watches a load `error` for `code`-matched rate-limit 429s and exposes
 * the cooldown state for that resource. Mirrors the web hook so call-
 * site behavior is familiar; differences are documented in
 * `lib/rateLimitGate.ts`.
 */
export function useRateLimitGate(
  error: unknown,
  expectedCode: string,
): RateLimitGate {
  // Mirror the shared cooldown for `expectedCode` into local state so
  // the component re-renders when it changes.
  const [deadline, setDeadline] = useState<number | null>(() =>
    getRateLimitDeadline(expectedCode),
  );

  // Track the last error reference we processed so we don't re-arm
  // the cooldown on every render — the screens reuse the same error
  // object across renders until a fresh load produces a new one.
  const lastErrorRef = useRef<unknown>(null);

  // Push a 429 from this page into the shared cooldown for the resource.
  useEffect(() => {
    if (error === lastErrorRef.current) return;
    lastErrorRef.current = error;
    const seconds = getRateLimitRetrySeconds(error, expectedCode);
    if (seconds == null) return;
    noteRateLimit(error, expectedCode);
    setDeadline(getRateLimitDeadline(expectedCode));
  }, [error, expectedCode]);

  // Subscribe so a 429 raised by another caller for the same resource
  // (e.g. background badge poll vs. foreground list) parks this screen
  // too.
  useEffect(() => {
    const unsub = subscribeRateLimit(expectedCode, () => {
      setDeadline(getRateLimitDeadline(expectedCode));
    });
    return unsub;
  }, [expectedCode]);

  // Auto-clear at the end of the window. We schedule a single timer
  // that flips `deadline` back to null when the window expires; the
  // page can then re-run its load() on its own.
  useEffect(() => {
    if (deadline == null) return;
    const ms = deadline - Date.now();
    if (ms <= 0) {
      setDeadline(null);
      return;
    }
    const timer = setTimeout(() => {
      // Re-read from the shared module — another caller may have
      // extended the cooldown while we were waiting.
      setDeadline(getRateLimitDeadline(expectedCode));
    }, ms);
    return () => clearTimeout(timer);
  }, [deadline, expectedCode]);

  const now = Date.now();
  const retryAfterSeconds = deadlineToSeconds(deadline, now);
  return {
    rateLimited: retryAfterSeconds != null,
    retryAfterSeconds,
  };
}

export default useRateLimitGate;
