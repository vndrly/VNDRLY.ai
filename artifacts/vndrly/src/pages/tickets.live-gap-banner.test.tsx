import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #665 — pin down the new "list briefly fell behind and refreshed"
// banner on the tickets list. The page already silently re-fetches on a
// `ticket.hello` (Task #657) or `location.hello` (Task #660) gap, but
// dispatchers had no visible signal that anything happened. The banner
// mirrors the crew-map's `text-locations-gap-warning` /
// `text-visitor-gap-warning` pattern: appears on a gap, clears once the
// triggered re-fetch resolves, and stays up with a one-click manual
// refresh button if the re-fetch fails.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shim the sibling tests use — records
// every instance and exposes a `dispatch(event, payload)` helper so
// the tests can drive `ticket.hello` / `location.hello` pushes
// without any real network.
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

// Vendor-admin viewer keeps the page renderable without partner-only
// branches; the gap banner is role-agnostic so the choice doesn't
// matter beyond mounting cleanly.
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

const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn, toasts: [] }),
  toast: toastFn,
}));

// The gap-recovery handler invalidates the tickets list query and then
// reads the post-refetch query state to decide whether to clear the
// banner (success) or leave it up (error). We control all three from
// the test so we can drive the resolve / reject / error-state paths.
const { invalidateMock, getQueryStateMock, getQueryDataMock } = vi.hoisted(
  () => ({
    invalidateMock: vi.fn(),
    getQueryStateMock: vi.fn(),
    getQueryDataMock: vi.fn(),
  }),
);

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateMock,
      // The unblock surgical-fetch path isn't exercised in these tests
      // but the page calls into both — provide noop stubs so an
      // accidental code path doesn't blow up.
      fetchQuery: vi.fn(() => new Promise(() => {})),
      setQueryData: vi.fn(),
      getQueryData: getQueryDataMock,
      getQueryState: getQueryStateMock,
    }),
  };
});

const LIST_TICKETS_KEY = ["tickets", "list", "vendorId=11"];

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
  getGetTicketQueryKey: (id: number) => [`/api/tickets/${id}`],
  getTicket: vi.fn(),
  useReverseFundsDispersal: () => ({ mutate: () => {}, isPending: false }),
    getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  }));

vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));

import { render, act, screen } from "@testing-library/react";
import Tickets from "./tickets";

function findTicketsEventSource(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/tickets\/events$/.test(i.url),
  );
  if (!es) throw new Error("no /api/tickets/events EventSource");
  return es;
}

function findLiveLocationsEventSource(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/live-locations\/events(\?|$)/.test(i.url),
  );
  if (!es) throw new Error("no /api/live-locations/events EventSource");
  return es;
}

beforeEach(() => {
  invalidateMock.mockReset();
  getQueryStateMock.mockReset();
  getQueryDataMock.mockReset();
  toastFn.mockReset();
  FakeEventSource.instances = [];
});

describe("tickets list — gap recovery banner (Task #665)", () => {
  it("does not render the banner on initial mount (no gap)", () => {
    // Default: invalidate isn't called, banner shouldn't be there.
    invalidateMock.mockReturnValue(Promise.resolve());
    render(<Tickets />);
    expect(screen.queryByTestId("text-tickets-gap-warning")).toBe(null);
  });

  it("shows the banner on a ticket.hello gap and clears it after the refetch resolves", async () => {
    // Hold the invalidate promise so we can assert the banner is
    // visible *during* the refetch, and gone *after* it resolves.
    let resolveInvalidate!: () => void;
    invalidateMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvalidate = resolve;
      }),
    );
    // Refetch ends in success state — banner should clear.
    getQueryStateMock.mockReturnValue({ status: "success" });

    render(<Tickets />);
    const es = findTicketsEventSource();

    await act(async () => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 42,
        lastSeenSeq: 17,
        gap: true,
      });
    });

    // Banner is up while the refetch is in flight.
    const banner = screen.getByTestId("text-tickets-gap-warning");
    expect(banner).not.toBe(null);
    // The same query key the gap-recovery handler uses must match the
    // useListTickets hook's key — otherwise we'd refresh nothing.
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: LIST_TICKETS_KEY,
    });

    // Refetch resolves cleanly → banner clears on its own.
    await act(async () => {
      resolveInvalidate();
      // Let the .then settle.
      await Promise.resolve();
    });

    expect(screen.queryByTestId("text-tickets-gap-warning")).toBe(null);
  });

  it("shows the banner on a location.hello gap and clears after refetch resolves", async () => {
    let resolveInvalidate!: () => void;
    invalidateMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvalidate = resolve;
      }),
    );
    getQueryStateMock.mockReturnValue({ status: "success" });

    render(<Tickets />);
    const es = findLiveLocationsEventSource();

    await act(async () => {
      es.dispatch("location.hello", {
        type: "location.hello",
        currentSeq: 99,
        lastSeenSeq: 50,
        gap: true,
      });
    });

    expect(screen.queryByTestId("text-tickets-gap-warning")).not.toBe(null);
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: LIST_TICKETS_KEY,
    });

    await act(async () => {
      resolveInvalidate();
      await Promise.resolve();
    });

    expect(screen.queryByTestId("text-tickets-gap-warning")).toBe(null);
  });

  it("does NOT show the banner on a hello with gap=false", async () => {
    invalidateMock.mockReturnValue(Promise.resolve());
    render(<Tickets />);

    await act(async () => {
      findTicketsEventSource().dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 17,
        lastSeenSeq: null,
        gap: false,
      });
      findLiveLocationsEventSource().dispatch("location.hello", {
        type: "location.hello",
        currentSeq: 50,
        lastSeenSeq: null,
        gap: false,
      });
    });

    expect(screen.queryByTestId("text-tickets-gap-warning")).toBe(null);
    // No spurious refetches either — the existing list cache is
    // already fresh on a brand-new subscription.
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("leaves the banner up when the refetch ends in error so the user can hit refresh now", async () => {
    let resolveInvalidate!: () => void;
    invalidateMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvalidate = resolve;
      }),
    );
    // Post-refetch state reports error → banner must NOT clear so the
    // dispatcher can manually retry via the inline button.
    getQueryStateMock.mockReturnValue({
      status: "error",
      error: new Error("boom"),
    });

    render(<Tickets />);
    const es = findTicketsEventSource();

    await act(async () => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        gap: true,
      });
    });

    expect(screen.queryByTestId("text-tickets-gap-warning")).not.toBe(null);

    await act(async () => {
      resolveInvalidate();
      await Promise.resolve();
    });

    // Banner stays up — error state held it open.
    expect(screen.queryByTestId("text-tickets-gap-warning")).not.toBe(null);
    // And the inline "refresh now" button is visible for one-click
    // recovery, mirroring the crew-map's button-locations-gap-refresh.
    expect(screen.queryByTestId("button-tickets-gap-refresh")).not.toBe(null);
  });

  it("re-invalidates the list when the user clicks the inline refresh button", async () => {
    // First invalidate (from the gap event) hangs forever so the
    // banner is visibly up; clicking refresh issues a SECOND
    // invalidate against the same key. We don't care about resolving
    // either — only the call count and key shape.
    invalidateMock.mockReturnValue(new Promise<void>(() => {}));
    getQueryStateMock.mockReturnValue({ status: "success" });

    render(<Tickets />);
    const es = findTicketsEventSource();

    await act(async () => {
      es.dispatch("ticket.hello", { type: "ticket.hello", gap: true });
    });

    expect(invalidateMock).toHaveBeenCalledTimes(1);

    const refreshBtn = screen.getByTestId("button-tickets-gap-refresh");
    await act(async () => {
      refreshBtn.click();
    });

    // Same query key; manual click drives the same recovery path.
    expect(invalidateMock).toHaveBeenCalledTimes(2);
    expect(invalidateMock).toHaveBeenLastCalledWith({
      queryKey: LIST_TICKETS_KEY,
    });
  });
});
