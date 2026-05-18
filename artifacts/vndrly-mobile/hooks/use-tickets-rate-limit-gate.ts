import { useEffect, useRef, useState } from "react";

import {
  getTicketsRateLimitDeadline,
  getTicketsRateLimitRetrySeconds,
  noteTicketsRateLimit,
  subscribeTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";

// Task #686 — mobile-side companion to
// `artifacts/vndrly/src/hooks/use-tickets-rate-limit-gate.ts`. The
// server (Task #675) returns 429 + Retry-After on `/api/tickets` and
// `/api/tickets/:id` once a session exceeds its budget. Without a
// gate the mobile screen would just surface a generic Alert and the
// next pull-to-refresh / 7s assignment-banner poll would re-trip the
// limit immediately.
//
// What this hook does:
//   • Watches the latest load error. When it's a 429, extends the
//     shared module-level cooldown via `noteTicketsRateLimit()` so
//     the background `liveLocationReporter` parks too. Subscribes to
//     the same module so a 429 raised on the reporter side parks the
//     foreground screen too.
//   • Returns `rateLimited: boolean` — pages should:
//       – skip auto-poll loops while it's true,
//       – disable manual-refresh affordances,
//       – surface the existing reconnecting/pause UX so users see a
//         familiar "we'll retry shortly" indicator.
//   • Returns `retryAfterSeconds` so the page can render a friendly
//     countdown if it wants (the toast text key uses it as a param).
//   • Auto-clears at the end of the window. The page should re-run
//     its load() in response — the hook itself doesn't kick a fetch
//     because the screen owns its load lifecycle.

export interface TicketsRateLimitGate {
  /**
   * True while the page is parked. Use to skip auto-refetches and
   * disable manual-refresh controls; surface the reconnecting affordance.
   */
  rateLimited: boolean;
  /**
   * Seconds remaining in the current cooldown window (rounded up),
   * or null when not rate-limited. Useful for friendly toast copy
   * like "retrying in {{seconds}}s".
   */
  retryAfterSeconds: number | null;
}

function deadlineToSeconds(deadline: number | null, now: number): number | null {
  if (deadline == null) return null;
  const ms = deadline - now;
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Watches a load `error` for tickets rate-limit 429s and exposes the
 * cooldown state. Mirrors the web hook so call-site behavior is
 * familiar; differences are documented in `lib/ticketsRateLimitGate.ts`.
 */
export function useTicketsRateLimitGate(error: unknown): TicketsRateLimitGate {
  // Mirror the shared cooldown into local state so the component
  // re-renders when it changes.
  const [deadline, setDeadline] = useState<number | null>(() =>
    getTicketsRateLimitDeadline(),
  );

  // Track the last error reference we processed so we don't re-arm
  // the cooldown on every render (the screens reuse the same error
  // object across renders until a fresh load produces a new one).
  const lastErrorRef = useRef<unknown>(null);

  // Push a 429 from this page into the shared cooldown.
  useEffect(() => {
    if (error === lastErrorRef.current) return;
    lastErrorRef.current = error;
    const seconds = getTicketsRateLimitRetrySeconds(error);
    if (seconds == null) return;
    noteTicketsRateLimit(error);
    setDeadline(getTicketsRateLimitDeadline());
  }, [error]);

  // Subscribe so a 429 raised by another caller (e.g. the background
  // live-location reporter) parks this screen too.
  useEffect(() => {
    const unsub = subscribeTicketsRateLimit(() => {
      setDeadline(getTicketsRateLimitDeadline());
    });
    return unsub;
  }, []);

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
      setDeadline(getTicketsRateLimitDeadline());
    }, ms);
    return () => clearTimeout(timer);
  }, [deadline]);

  const now = Date.now();
  const retryAfterSeconds = deadlineToSeconds(deadline, now);
  return {
    rateLimited: retryAfterSeconds != null,
    retryAfterSeconds,
  };
}

export default useTicketsRateLimitGate;
