import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #643 — pin down the live-unblock SSE wiring on the ticket list
// page. The page subscribes to /api/tickets/events on mount and, on a
// `ticket.unblocked` push, refreshes the affected row so its blocked
// indicator drops inside ~1s rather than waiting on the existing 7s
// poll. Mirrors the test pattern used for the ticket-detail page in
// ticket-detail.assignment-removed.test.tsx (Task #622).
//
// Task #656 — the handler used to invalidate the *entire* useListTickets
// query, forcing a full refetch on a page that may carry hundreds of
// rows. The handler now fetches only the affected ticket via its
// per-id endpoint and surgically patches its row in the cached list
// (and the ticket-detail cache, for any open tab on the same ticket).
// These tests pin that behavior down so a future refactor that
// regresses to a full invalidation fails loudly.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. We install a tiny shim that records every
// instance and exposes a `dispatch(event, payload)` helper so the test
// can drive a fake `ticket.unblocked` push without any real network.
type FakeESListener = (ev: MessageEvent) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  private listeners = new Map<string, Set<FakeESListener>>();
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: FakeESListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: FakeESListener): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    this.closed = true;
  }
  /** Test helper — fan out a message to every registered listener. */
  dispatch(type: string, data: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const ev = {
      data: typeof data === "string" ? data : JSON.stringify(data),
    } as MessageEvent;
    for (const fn of set) fn(ev);
  }
}
(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

// === Auth: a vendor admin so the page mounts without partner-only
// branches. The unblock channel is role-scoped server-side, so the
// client just trusts what comes down the wire — the choice of viewer
// here doesn't matter beyond keeping the page renderable.
const vendorAdminUser = {
  userId: 1,
  role: "vendor" as const,
  displayName: "Op",
  partnerId: null,
  vendorId: 11,
  vendorRole: "office" as const,
  preferredLanguage: "en" as const,
  activeMembershipId: 1,
  availableMemberships: [
    {
      id: 1,
      role: "admin",
      entityType: "vendor",
      entityId: 11,
      entityName: "Acme",
    },
  ],
  requiresContextChoice: false,
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: vendorAdminUser,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
  }),
}));

// Task #648 — capture the toast spy at module scope so the assertions
// for the new assignment-restored confirmation toast (mirrors the mobile
// open-tickets list toast from Task #630) can inspect what fired. The
// hooks-mock returns the *same* spy on every call so the SSE handler's
// `toastRef.current` always points at it.
const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn, toasts: [] }),
  toast: toastFn,
}));

// Capture every queryClient call the SSE handler makes. The Task #656
// surgical path uses `getQueryData` to peek at the cached list,
// `fetchQuery` to pull the affected ticket via its per-id endpoint,
// and `setQueryData` to patch that one row back into the list (and
// drop a fresh copy into the ticket-detail cache). `invalidateQueries`
// is now reserved for the failure-path fallback and must NOT be
// called on the happy path.
const {
  invalidateMock,
  fetchQueryMock,
  setQueryDataMock,
  getQueryDataMock,
} = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  fetchQueryMock: vi.fn(),
  setQueryDataMock: vi.fn(),
  getQueryDataMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateMock,
      fetchQuery: fetchQueryMock,
      setQueryData: setQueryDataMock,
      getQueryData: getQueryDataMock,
    }),
  };
});

// Sentinel query keys — the real generated helpers return arrays we
// don't care about here. We just need stable identities so the
// assertions can compare on them.
const LIST_TICKETS_KEY = ["tickets", "list", "vendorId=11"];
const TICKET_DETAIL_KEY = (id: number) => [`/api/tickets/${id}`];
const getTicketMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  // Empty list keeps the page render minimal — no rows, no row-level
  // queries (gps, site detail) firing.
  useListTickets: () => ({ data: [], isLoading: false }),
  useCreateTicket: () => ({ mutateAsync: vi.fn() }),
  useListSiteLocations: () => ({ data: [] }),
  useListWorkTypes: () => ({ data: [] }),
  useListVendors: () => ({ data: undefined }),
  useListFieldEmployees: () => ({ data: [] }),
  useGetTicketGpsLogs: () => ({ data: undefined }),
  useGetSiteLocation: () => ({ data: undefined }),
  getListTicketsQueryKey: () => LIST_TICKETS_KEY,
  getListSiteLocationsQueryKey: () => ["site-locations"],
  getListWorkTypesQueryKey: () => ["work-types"],
  getListVendorsQueryKey: () => ["vendors"],
  getGetTicketGpsLogsQueryKey: () => ["gps-logs"],
  getGetSiteLocationQueryKey: () => ["site-location"],
  getGetTicketQueryKey: (id: number) => TICKET_DETAIL_KEY(id),
  getTicket: (id: number, opts?: unknown) => getTicketMock(id, opts),
  useReverseFundsDispersal: () => ({ mutate: () => {}, isPending: false }),
    getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  }));

vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));

import { render, act } from "@testing-library/react";
import Tickets from "./tickets";

function findTicketsEventSource(): FakeEventSource {
  // The page also opens an EventSource for /api/live-locations/events
  // (the lifecycle-flash channel). Pick the unblock stream by URL so
  // the assertion isn't sensitive to the order the two effects run.
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/tickets\/events$/.test(i.url),
  );
  if (!es) {
    throw new Error(
      `No EventSource for /api/tickets/events. Saw: ${FakeEventSource.instances
        .map((i) => i.url)
        .join(", ") || "(none)"}`,
    );
  }
  return es;
}

function findLiveLocationsEventSource(): FakeEventSource {
  // Same lookup pattern as findTicketsEventSource — the page opens
  // both /api/tickets/events and /api/live-locations/events on mount,
  // so match by URL substring rather than instance order.
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/live-locations\/events(\?|$)/.test(i.url),
  );
  if (!es) {
    throw new Error(
      `No EventSource for /api/live-locations/events. Saw: ${FakeEventSource.instances
        .map((i) => i.url)
        .join(", ") || "(none)"}`,
    );
  }
  return es;
}

beforeEach(() => {
  invalidateMock.mockReset();
  fetchQueryMock.mockReset();
  setQueryDataMock.mockReset();
  getQueryDataMock.mockReset();
  getTicketMock.mockReset();
  toastFn.mockReset();
  FakeEventSource.instances = [];
});

describe("tickets list — live unblock SSE (Tasks #643 / #656)", () => {
  it("opens an EventSource for /api/tickets/events on mount with credentials", () => {
    const { unmount } = render(<Tickets />);
    const es = findTicketsEventSource();
    // Without `withCredentials` the browser strips the session cookie
    // and the server returns 401, leaving the page on the existing
    // poll for nothing.
    expect(es.withCredentials).toBe(true);
    unmount();
    // Long-lived stream — must close on unmount or each navigate-away
    // leaks a connection per page mount.
    expect(es.closed).toBe(true);
  });

  it("surgically patches just the affected row in cache on a ticket.unblocked event", async () => {
    // Stale list cache contains the unblocked row alongside an
    // unrelated one; the patch must replace only the matching row
    // and leave the rest untouched.
    const stale = [
      { id: 4242, status: "in_progress" },
      { id: 9999, status: "approved" },
    ];
    getQueryDataMock.mockReturnValue(stale);

    const fresh = { id: 4242, status: "in_progress", refreshed: true };
    let resolveFetch!: (value: typeof fresh) => void;
    fetchQueryMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<Tickets />);
    const es = findTicketsEventSource();

    await act(async () => {
      es.dispatch("ticket.unblocked", {
        type: "ticket.unblocked",
        ticketId: 4242,
        vendorId: 11,
        partnerId: 22,
      });
    });

    // We peek at the active list cache before deciding whether to
    // fetch — confirms the handler is using the same key shape the
    // useListTickets hook would.
    expect(getQueryDataMock).toHaveBeenCalledWith(LIST_TICKETS_KEY);

    // The whole point of #656: only the affected ticket is fetched,
    // and its query key matches the per-id detail key so any open
    // ticket-detail tab benefits from the same refresh.
    expect(fetchQueryMock).toHaveBeenCalledTimes(1);
    const fetchArgs = fetchQueryMock.mock.calls[0]![0] as {
      queryKey: unknown;
      queryFn: (ctx: { signal?: AbortSignal }) => unknown;
    };
    expect(fetchArgs.queryKey).toEqual(TICKET_DETAIL_KEY(4242));
    // Drive the queryFn so we can confirm it actually targets the
    // generated per-id GET — not, say, a copy-pasted list call.
    fetchArgs.queryFn({ signal: undefined });
    expect(getTicketMock).toHaveBeenCalledWith(4242, { signal: undefined });

    // Resolve the fetch and verify the patch only touches the
    // affected row (no full-list refetch, no unrelated rows mutated).
    await act(async () => {
      resolveFetch(fresh);
    });

    expect(setQueryDataMock).toHaveBeenCalledTimes(1);
    const [patchedKey, updater] = setQueryDataMock.mock.calls[0]!;
    expect(patchedKey).toEqual(LIST_TICKETS_KEY);
    const next = (updater as (old: typeof stale) => typeof stale)(stale);
    expect(next).toEqual([
      { id: 4242, status: "in_progress", refreshed: true },
      { id: 9999, status: "approved" },
    ]);
    // The unrelated row identity is preserved — the updater returns a
    // new array with only the patched row replaced.
    expect(next[1]).toBe(stale[1]);

    // Crucially, the list query is NOT invalidated on the happy path.
    // That regression — a full refetch on every push — is exactly
    // what #656 set out to remove.
    expect(invalidateMock).not.toHaveBeenCalled();

    // Task #648: a row that's actually in the dispatcher's view has
    // its restore announced via a non-blocking toast that names the
    // affected ticket using the canonical tracking-number format
    // (mirrors the mobile open-tickets list toast from Task #630).
    // Without this, the only visible signal of a partner-side
    // restore would be the blocked indicator quietly disappearing.
    expect(toastFn).toHaveBeenCalledTimes(1);
    const toastArg = toastFn.mock.calls[0]![0] as {
      title: string;
      duration?: number;
      variant?: string;
    };
    // The list toast must include the ticket identifier so a
    // dispatcher juggling several open tickets can tell which one
    // was restored. We assert on the digits of the id (3-digit
    // tracking suffix) rather than the full canonical format so
    // a future format tweak in `formatTicketTrackingNumber` doesn't
    // break this test in a misleading way.
    expect(toastArg.title).toMatch(/4242|242/);
    expect(toastArg.duration).toBe(3000);
    // Default variant — this is a confirmation, not an error.
    expect(toastArg.variant).toBeUndefined();
  });

  it("no-ops when the unblocked ticket isn't in the current cached view", async () => {
    // Cached list doesn't contain the ticket id from the push (e.g.
    // the operator switched filters since the row was last visible).
    // The handler must skip the per-id fetch entirely so an unrelated
    // partner restoring assignments doesn't trigger a needless GET.
    getQueryDataMock.mockReturnValue([{ id: 1 }, { id: 2 }]);

    render(<Tickets />);
    const es = findTicketsEventSource();

    await act(async () => {
      es.dispatch("ticket.unblocked", {
        type: "ticket.unblocked",
        ticketId: 4242,
        vendorId: 11,
        partnerId: 22,
      });
    });

    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
    // Task #648: out-of-view restores stay silent. A toast for every
    // partner-side unblock — even on tickets the dispatcher has
    // filtered out — would be noise. The mobile list (Task #630)
    // applies the same in-view gate for the same reason.
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("falls back to invalidating the list when the per-id fetch fails", async () => {
    // Network blip / 5xx on the surgical refresh — we must still
    // ensure the row's blocked indicator clears, so the handler
    // falls back to the legacy full-list invalidation rather than
    // leaving the page stuck on stale data.
    getQueryDataMock.mockReturnValue([{ id: 4242 }]);
    let rejectFetch!: (err: unknown) => void;
    fetchQueryMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectFetch = reject;
      }),
    );

    render(<Tickets />);
    const es = findTicketsEventSource();

    await act(async () => {
      es.dispatch("ticket.unblocked", {
        type: "ticket.unblocked",
        ticketId: 4242,
        vendorId: 11,
        partnerId: 22,
      });
    });

    await act(async () => {
      rejectFetch(new Error("boom"));
      // Let the rejection chain settle.
      await Promise.resolve();
    });

    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: LIST_TICKETS_KEY,
    });
  });

  it("ignores malformed payloads and other event types", async () => {
    // Even with a populated cached list, a bad payload must not
    // trigger any cache work — getQueryData is only consulted once
    // we've confirmed the payload shape, so we don't even peek.
    getQueryDataMock.mockReturnValue([{ id: 4242 }]);

    render(<Tickets />);
    const es = findTicketsEventSource();

    // A non-JSON `data` is the realistic failure mode if something
    // upstream double-encodes. The handler must swallow it.
    await act(async () => {
      es.dispatch("ticket.unblocked", "not-json");
    });
    // A correctly-shaped payload but with an unknown event type also
    // must be a no-op — guards against a future server-side event
    // (e.g. ticket.assigned) accidentally re-fetching the world.
    await act(async () => {
      es.dispatch("ticket.unblocked", {
        type: "ticket.something_else",
        ticketId: 1,
      });
    });
    // A correctly-typed payload missing the ticketId is also a
    // no-op — without an id we have no row to patch and shouldn't
    // fall back to invalidating the entire list.
    await act(async () => {
      es.dispatch("ticket.unblocked", {
        type: "ticket.unblocked",
      });
    });

    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  // Task #657 — when EventSource auto-reconnects after the dispatcher's
  // laptop wakes up, the server sends a one-shot `ticket.hello` whose
  // `gap` flag tells us whether any events fired while we were
  // disconnected. Honoring it here closes the window between the
  // missed ticket.unblocked push and the existing 7s poll.
  describe("ticket.hello gap detection (Task #657)", () => {
    it("re-fetches the list once when the server reports a sequence gap", () => {
      render(<Tickets />);
      const es = findTicketsEventSource();

      act(() => {
        es.dispatch("ticket.hello", {
          type: "ticket.hello",
          currentSeq: 42,
          lastSeenSeq: 17,
          gap: true,
        });
      });

      // Exactly the same query key the live-unblock handler uses —
      // the gap is "we may have missed an unblock", so the recovery
      // is identical to receiving the missed event itself.
      expect(invalidateMock).toHaveBeenCalledTimes(1);
      expect(invalidateMock).toHaveBeenCalledWith({
        queryKey: LIST_TICKETS_KEY,
      });
    });

    it("does NOT re-fetch on the first hello of a fresh subscription", () => {
      render(<Tickets />);
      const es = findTicketsEventSource();

      // The very first hello on a brand-new EventSource carries
      // `gap: false` (no prior Last-Event-ID was sent). Refetching
      // here would be wasted work — the list query that just
      // mounted is already fresh.
      act(() => {
        es.dispatch("ticket.hello", {
          type: "ticket.hello",
          currentSeq: 17,
          lastSeenSeq: null,
          gap: false,
        });
      });

      expect(invalidateMock).not.toHaveBeenCalled();
    });

    it("ignores a malformed hello payload", () => {
      render(<Tickets />);
      const es = findTicketsEventSource();

      // Same defensive posture as the unblock handler — a non-JSON
      // payload must not throw out of the SSE listener (which would
      // tear down the rest of the page).
      act(() => {
        es.dispatch("ticket.hello", "not-json");
      });

      expect(invalidateMock).not.toHaveBeenCalled();
    });
  });

  // Task #660 — extend the same gap-on-reconnect contract from the
  // ticket-events channel onto the live-locations channel. Each
  // `location.ping` may carry a lifecycle transition (en_route →
  // on_site etc.) the list depends on for badges and sort order, so
  // a missed ping during a sleep/reconnect leaves the list stale
  // until the next 7s poll. A `location.hello` with `gap: true`
  // closes that window with a single list invalidation.
  describe("location.hello gap detection (Task #660)", () => {
    it("re-fetches the list once when the live-locations stream reports a sequence gap", () => {
      render(<Tickets />);
      const es = findLiveLocationsEventSource();

      act(() => {
        es.dispatch("location.hello", {
          type: "location.hello",
          currentSeq: 99,
          lastSeenSeq: 50,
          gap: true,
        });
      });

      // Same query key the live-ping handler uses on a lifecycle
      // change — the gap is "we may have missed a lifecycle ping",
      // so the recovery is identical to receiving the missed ping
      // itself.
      expect(invalidateMock).toHaveBeenCalledTimes(1);
      expect(invalidateMock).toHaveBeenCalledWith({
        queryKey: LIST_TICKETS_KEY,
      });
    });

    it("does NOT re-fetch on the first hello of a fresh subscription", () => {
      render(<Tickets />);
      const es = findLiveLocationsEventSource();

      // The very first hello on a brand-new EventSource carries
      // `gap: false` (no prior Last-Event-ID was sent). The
      // just-mounted list query is already fresh — refetching here
      // would be wasted work on every page load.
      act(() => {
        es.dispatch("location.hello", {
          type: "location.hello",
          currentSeq: 50,
          lastSeenSeq: null,
          gap: false,
        });
      });

      expect(invalidateMock).not.toHaveBeenCalled();
    });

    it("ignores a malformed hello payload", () => {
      render(<Tickets />);
      const es = findLiveLocationsEventSource();

      // Defensive parity with the ping handler — a non-JSON payload
      // (or a payload with the wrong `type`) must not throw out of
      // the SSE listener and tear down the live channel.
      act(() => {
        es.dispatch("location.hello", "not-json");
      });
      act(() => {
        es.dispatch("location.hello", {
          type: "location.something_else",
          gap: true,
        });
      });

      expect(invalidateMock).not.toHaveBeenCalled();
    });
  });
});
