import { useEffect, useRef, useState } from "react";
import type { LiveConnectionStatus } from "@/components/live-connection-pill";

// Task #666 — shared driver for the `LiveConnectionPill` so every page
// that subscribes to an SSE stream can surface the same Live /
// Reconnecting… / Reconnected — refreshed state without re-implementing
// the open/error/hello-with-gap dance Task #661 baked into the ticket
// list and detail pages.
//
// What this owns:
//   • State machine: "connecting" → "live" / "reconnecting", plus a
//     transient "refreshed" flash when a `<channel>.hello` arrives with
//     `gap === true` (i.e. the browser auto-reconnected with a stale
//     Last-Event-ID and the server re-played past us).
//   • One-shot 3s hold on "refreshed" before falling back to "live", so
//     the pill doesn't crow forever.
//   • Cleanup of both the EventSource and the hold timer on unmount or
//     when any of the inputs change.
//
// What this doesn't own:
//   • Application-level event handlers (e.g. `ticket.unblocked` patches).
//     Pages that need those should still attach their own listeners on
//     their own EventSource — this hook owns *just* the pill driver.
//   • Re-fetch decisions on hello-with-gap. Pages decide via the
//     `onHelloWithGap` callback whether to invalidate which queries.
//
// Why a separate EventSource (not piggy-back on existing ones)?
//   The two "established" SSE consumers — tickets list + ticket-detail —
//   already have hand-rolled lifecycles wired to their own state. We
//   leave those alone (mature, tested) and only use this hook for the
//   new pill mounts (crew map drives its pill from its own existing
//   handlers; hotlist + comments mount this hook to subscribe to the
//   ticket-events channel purely for the pill + a gap-driven refetch).

const REFRESHED_HOLD_MS = 3000;

export interface UseLiveConnectionStatusOptions {
  /** Absolute URL of the SSE endpoint (already includes API_BASE). */
  url: string;
  /**
   * Custom event name carrying `{ type, gap }` JSON (e.g. `"ticket.hello"`,
   * `"location.hello"`). When omitted, the hook still surfaces open/error
   * but never flashes "refreshed".
   */
  helloEventName?: string;
  /**
   * Called when a hello arrives with `gap === true`. Use this to invalidate
   * whatever queries this page renders so a missed event window catches up.
   * The pill independently flashes "refreshed" regardless of what this does.
   */
  onHelloWithGap?: () => void;
  /**
   * Whether the EventSource should be opened. Defaults to true; pass false
   * (e.g. while the user/auth context is still loading) to no-op the effect
   * without leaving a half-built connection behind.
   */
  enabled?: boolean;
}

export function useLiveConnectionStatus(
  opts: UseLiveConnectionStatusOptions,
): LiveConnectionStatus {
  const { url, helloEventName, onHelloWithGap, enabled = true } = opts;
  const [status, setStatus] = useState<LiveConnectionStatus>("connecting");
  const refreshedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stash the latest hello callback in a ref so identity churn from inline
  // arrow functions doesn't tear down + rebuild the EventSource on every
  // render. Only `url`/`helloEventName`/`enabled` should restart the stream.
  const helloCbRef = useRef(onHelloWithGap);
  useEffect(() => {
    helloCbRef.current = onHelloWithGap;
  }, [onHelloWithGap]);

  useEffect(() => {
    if (!enabled) return;
    // Reset to "connecting" whenever we (re)mount or the URL changes —
    // otherwise a filter switch on the page would leave the pill on its
    // previous "live" state during the brief reconnect window.
    setStatus("connecting");
    let es: EventSource | null = null;
    const flashRefreshed = () => {
      setStatus("refreshed");
      if (refreshedTimerRef.current) clearTimeout(refreshedTimerRef.current);
      refreshedTimerRef.current = setTimeout(() => {
        refreshedTimerRef.current = null;
        // Only fall back to "live" if a later disconnect hasn't moved us
        // to "reconnecting" in the meantime — never clobber that.
        setStatus((prev) => (prev === "refreshed" ? "live" : prev));
      }, REFRESHED_HOLD_MS);
    };
    let helloListener: ((evt: Event) => void) | null = null;
    try {
      es = new EventSource(url, { withCredentials: true });
      es.onopen = () => {
        // EventSource fires onopen on initial connect AND every successful
        // auto-reconnect. If a hello-driven "refreshed" hold is already
        // queued we leave it in place — that confirmation should win.
        setStatus((prev) => (prev === "refreshed" ? prev : "live"));
      };
      es.onerror = () => {
        // The browser auto-reconnects unless readyState is CLOSED. Either
        // way the dispatcher's takeaway is the same: mid-flight changes
        // may not be reflected until reconnect — surface as "reconnecting".
        setStatus("reconnecting");
      };
      if (helloEventName) {
        helloListener = (evt: Event) => {
          try {
            const data = JSON.parse((evt as MessageEvent).data) as {
              gap?: boolean;
            };
            if (data.gap === true) {
              helloCbRef.current?.();
              flashRefreshed();
            }
          } catch {
            // Malformed hello payload — ignore. Better to leave the pill
            // alone than to misreport a "refreshed" we can't be sure of.
          }
        };
        es.addEventListener(helloEventName, helloListener);
      }
    } catch {
      // EventSource isn't available (e.g. some test environments). Don't
      // sit on "Connecting…" forever — surface the offline state so the
      // dispatcher knows what they're seeing isn't being pushed live.
      es = null;
      setStatus("reconnecting");
    }
    return () => {
      if (es) {
        if (helloEventName && helloListener) {
          es.removeEventListener(helloEventName, helloListener);
        }
        es.close();
      }
      if (refreshedTimerRef.current) {
        clearTimeout(refreshedTimerRef.current);
        refreshedTimerRef.current = null;
      }
    };
  }, [url, helloEventName, enabled]);

  return status;
}

export default useLiveConnectionStatus;
