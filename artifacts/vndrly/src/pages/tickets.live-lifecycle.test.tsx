import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #663 — pin down the lifecycle-transition surgical refresh on the
// ticket list page. Each `location.ping` carries a `lifecycleState` for
// the ticket the crew is on; when that state changes (pending_arrival
// → en_route → on_site → off_site), the page used to invalidate the
// *entire* useListTickets query, forcing a full refetch on a screen
// that may carry hundreds of rows. The handler now mirrors the
// Task #656 unblock pattern: fetch only the affected ticket via its
// per-id endpoint and patch its row in the cached list. These tests
// pin that behavior down so a future refactor that regresses to a
// full invalidation on every lifecycle ping fails loudly.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shim shape as the unblock test —
// records every instance so the test can drive a fake `location.ping`
// push without any real network.
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

// Vendor admin viewer — mirrors the unblock test. The live-locations
// channel is role-scoped server-side, so the choice of viewer here
// doesn't matter beyond keeping the page renderable.
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
  toast: vi.fn(),
}));

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

const LIST_TICKETS_KEY = ["tickets", "list", "vendorId=11"];
const TICKET_DETAIL_KEY = (id: number) => [`/api/tickets/${id}`];
const getTicketMock = vi.fn();

// The list mock returns an existing ticket on first render so the page's
// seed effect records its lifecycle state in the internal ref. Without a
// recorded prev state, the live-ping handler treats the first ping as a
// brand-new ticket (which intentionally invalidates so the seed effect
// can pick it up) — that's a separate path from the lifecycle-transition
// surgical refresh we're pinning down here.
const SEED_TICKETS = [
  { id: 4242, status: "in_progress", lifecycleState: "en_route" },
];

vi.mock("@workspace/api-client-react", () => ({
  useListTickets: () => ({ data: SEED_TICKETS, isLoading: false }),
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

function findLiveLocationsEventSource(): FakeEventSource {
  // The page opens both /api/tickets/events (unblock channel) and
  // /api/live-locations/events (lifecycle channel) on mount, so match
  // by URL substring rather than instance order.
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
  FakeEventSource.instances = [];
});

describe("tickets list — live lifecycle SSE (Task #663)", () => {
  it("surgically patches just the affected row on a lifecycle transition", async () => {
    // Stale list cache contains the transitioning row alongside an
    // unrelated one; the patch must replace only the matching row
    // and leave the rest untouched.
    const stale = [
      { id: 4242, status: "in_progress", lifecycleState: "en_route" },
      { id: 9999, status: "approved", lifecycleState: "on_site" },
    ];
    getQueryDataMock.mockReturnValue(stale);

    const fresh = {
      id: 4242,
      status: "in_progress",
      lifecycleState: "on_site",
    };
    let resolveFetch!: (value: typeof fresh) => void;
    fetchQueryMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    // First ping seeds the lifecycle ref with `en_route` (matches the
    // list seed above), so the second ping below is the one that
    // actually fires the transition path.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "en_route" },
      });
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();

    // Now the actual transition: en_route → on_site.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "on_site" },
      });
    });

    // We peek at the active list cache before deciding whether to
    // fetch — confirms the handler is using the same key shape the
    // useListTickets hook would.
    expect(getQueryDataMock).toHaveBeenCalledWith(LIST_TICKETS_KEY);

    // The whole point of #663: only the affected ticket is fetched,
    // and its query key matches the per-id detail key so any open
    // ticket-detail tab benefits from the same refresh.
    expect(fetchQueryMock).toHaveBeenCalledTimes(1);
    const fetchArgs = fetchQueryMock.mock.calls[0]![0] as {
      queryKey: unknown;
      queryFn: (ctx: { signal?: AbortSignal }) => unknown;
    };
    expect(fetchArgs.queryKey).toEqual(TICKET_DETAIL_KEY(4242));
    fetchArgs.queryFn({ signal: undefined });
    expect(getTicketMock).toHaveBeenCalledWith(4242, { signal: undefined });

    // Resolve the fetch and verify the patch only touches the
    // affected row.
    await act(async () => {
      resolveFetch(fresh);
    });

    expect(setQueryDataMock).toHaveBeenCalledTimes(1);
    const [patchedKey, updater] = setQueryDataMock.mock.calls[0]!;
    expect(patchedKey).toEqual(LIST_TICKETS_KEY);
    const next = (updater as (old: typeof stale) => typeof stale)(stale);
    expect(next).toEqual([
      { id: 4242, status: "in_progress", lifecycleState: "on_site" },
      { id: 9999, status: "approved", lifecycleState: "on_site" },
    ]);
    // The unrelated row identity is preserved — the updater returns
    // a new array with only the patched row replaced.
    expect(next[1]).toBe(stale[1]);

    // Crucially, the list query is NOT invalidated on the happy path.
    // That regression — a full refetch on every lifecycle ping — is
    // exactly what #663 set out to remove.
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("no-ops when the transitioning ticket isn't in the current cached view", async () => {
    // Cached list doesn't contain the ticket id from the ping (e.g.
    // the operator switched filters since the row was last visible).
    // The handler must skip the per-id fetch entirely so an unrelated
    // crew transitioning lifecycle doesn't trigger a needless GET.
    getQueryDataMock.mockReturnValue([{ id: 1 }, { id: 2 }]);

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    // Seed then transition.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "en_route" },
      });
    });
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "on_site" },
      });
    });

    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("falls back to invalidating the list when the per-id fetch fails", async () => {
    // Network blip / 5xx on the surgical refresh — we must still
    // ensure the row's lifecycle badge updates, so the handler falls
    // back to the legacy full-list invalidation rather than leaving
    // the page stuck on stale data.
    getQueryDataMock.mockReturnValue([{ id: 4242 }]);
    let rejectFetch!: (err: unknown) => void;
    fetchQueryMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectFetch = reject;
      }),
    );

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    // Seed then transition.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "en_route" },
      });
    });
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "on_site" },
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

  it("does not refetch or patch when the lifecycle state is unchanged", async () => {
    // Same lifecycle on consecutive pings — the row's badge wouldn't
    // change, so we must skip the surgical fetch entirely. This is
    // the most common ping shape (the crew is still en_route) and
    // the optimization that makes #663 worthwhile on a busy screen.
    getQueryDataMock.mockReturnValue([{ id: 4242 }]);

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "en_route" },
      });
    });
    // Repeat ping with the same lifecycle — should be a no-op.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 4242, lifecycleState: "en_route" },
      });
    });

    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("invalidates the list (legacy behavior) when a brand-new ticket appears on the wire", async () => {
    // The "first time we see this ticket" branch must keep its
    // existing behavior: a full list invalidate so the seed effect
    // picks up the new row and registers it for flashing. This is
    // intentionally NOT surgical because we don't yet know the row's
    // shape and the seed effect needs the list refetch to arrive.
    getQueryDataMock.mockReturnValue([{ id: 4242 }]);

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    // A ticket id we have NOT seeded — note the seeded list above
    // only includes id 4242, so 7777 is brand-new on the wire.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { ticketId: 7777, lifecycleState: "en_route" },
      });
    });

    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: LIST_TICKETS_KEY,
    });
  });

  it("ignores malformed ping payloads", async () => {
    getQueryDataMock.mockReturnValue([{ id: 4242 }]);

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    // Non-JSON payload.
    await act(async () => {
      es.dispatch("location.ping", "not-json");
    });
    // Missing `location` field.
    await act(async () => {
      es.dispatch("location.ping", { other: "thing" });
    });
    // Missing ticketId.
    await act(async () => {
      es.dispatch("location.ping", {
        location: { lifecycleState: "en_route" },
      });
    });

    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
