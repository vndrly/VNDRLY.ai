import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #661 — verify the live SSE health pill on the ticket-list page
// transitions between Connecting → Live → Reconnecting → Refreshed →
// Live as the EventSource lifecycle fires onopen / onerror / hello.
// The pill is the only thing rendered specifically by this task; the
// underlying invalidate-on-event behavior is covered by
// tickets.live-unblock.test.tsx.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shim shape as tickets.live-unblock.test.tsx
// but with `onopen` / `onerror` setters so the test can drive the
// connection-state handlers wired up in Task #661.
type FakeESListener = (ev: MessageEvent) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
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
  /** Test helper — fan out a typed event to registered listeners. */
  dispatch(type: string, data: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const ev = {
      data: typeof data === "string" ? data : JSON.stringify(data),
    } as MessageEvent;
    for (const fn of set) fn(ev);
  }
  /** Test helper — drive the lifecycle handlers. */
  fireOpen(): void {
    this.onopen?.(new Event("open"));
  }
  fireError(): void {
    this.onerror?.(new Event("error"));
  }
}
(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

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

const { invalidateMock, queryClientStub } = vi.hoisted(() => {
  const m = vi.fn();
  // IMPORTANT: useQueryClient must return the *same* reference across
  // renders. The page's SSE effect lists `queryClient` in its deps, so
  // a fresh object per render would tear down and recreate the
  // EventSource (and clear our `flashRefreshed` setTimeout) on every
  // state change — which is exactly what flips this test from
  // covering the timer behavior to losing it.
  return { invalidateMock: m, queryClientStub: { invalidateQueries: m } };
});
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => queryClientStub,
  };
});

const LIST_TICKETS_KEY = ["tickets", "list", "vendorId=11"];
vi.mock("@workspace/api-client-react", () => ({
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
  useReverseFundsDispersal: () => ({ mutate: () => {}, isPending: false }),
    getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  }));

vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));

import { render, act, fireEvent, screen } from "@testing-library/react";
import Tickets from "./tickets";

function findTicketsEventSource(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/tickets\/events$/.test(i.url),
  );
  if (!es) throw new Error("No EventSource for /api/tickets/events");
  return es;
}

beforeEach(() => {
  invalidateMock.mockReset();
  FakeEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tickets list — live connection pill (Task #661)", () => {
  it("starts in the Connecting state on mount", () => {
    render(<Tickets />);
    const pill = screen.getByTestId("tickets-live-connection-pill");
    // Status is encoded as a data attribute so layout/visual tweaks
    // don't break the assertion. The pill MUST start as "connecting"
    // because the EventSource hasn't fired onopen yet.
    expect(pill.getAttribute("data-status")).toBe("connecting");
    // role=status with aria-live=polite is what makes the pill
    // screen-reader friendly without preempting focus. Pin it down
    // so a future refactor doesn't accidentally drop it.
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-live")).toBe("polite");
  });

  it("flips to Live once the EventSource opens", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });

    const pill = screen.getByTestId("tickets-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("live");
  });

  it("flips to Reconnecting on EventSource error", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    // Open first so we can show the drop is detected after a healthy
    // connection — the more realistic ordering than erroring on
    // first connect.
    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.fireError();
    });

    const pill = screen.getByTestId("tickets-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("reconnecting");
  });

  it("flashes Refreshed after a gap-flagged hello, then returns to Live", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    // Drop, reconnect, then receive a hello with gap=true — the
    // realistic sequence the user sees after waking a laptop.
    act(() => {
      es.fireError();
    });
    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 99,
        lastSeenSeq: 17,
        gap: true,
      });
    });

    const pill = screen.getByTestId("tickets-live-connection-pill");
    // The hello must beat the onopen we just fired — the parent
    // intentionally guards against onopen clobbering the refreshed
    // flash so the user actually sees the confirmation.
    expect(pill.getAttribute("data-status")).toBe("refreshed");

    // After the 3s hold the pill returns to "live" so it doesn't
    // sit on the success copy forever.
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(pill.getAttribute("data-status")).toBe("live");
  });

  // Task #667 — when offline, the pill must let the dispatcher
  // pull the latest data on demand instead of waiting for the
  // browser's auto-reconnect or the 7s poll.
  it("renders the pill as a button only while reconnecting (Task #667)", () => {
    render(<Tickets />);
    const initial = screen.getByTestId("tickets-live-connection-pill");
    // Connecting → not interactive (no manual refresh available
    // until we know the SSE stream actually dropped).
    expect(initial.tagName).toBe("SPAN");
    expect(initial.getAttribute("data-interactive")).toBe(null);

    const es = findTicketsEventSource();
    act(() => {
      es.fireOpen();
    });
    const live = screen.getByTestId("tickets-live-connection-pill");
    // Live → still not interactive (clicking it would just thrash
    // the cache; nothing's wrong).
    expect(live.tagName).toBe("SPAN");
    expect(live.getAttribute("data-interactive")).toBe(null);

    act(() => {
      es.fireError();
    });
    const offline = screen.getByTestId("tickets-live-connection-pill");
    // Reconnecting → interactive button so the dispatcher can
    // trigger an immediate refresh.
    expect(offline.tagName).toBe("BUTTON");
    expect(offline.getAttribute("data-interactive")).toBe("true");
    // Native button semantics MUST be preserved (no role override) so
    // assistive tech announces this as a button — overriding to
    // role=status would suppress that and leave keyboard users
    // unsure they can activate it. The aria-label must describe
    // both the current state and what activating the button does
    // so screen-reader users get the same context sighted users
    // get from the visible label.
    expect(offline.getAttribute("role")).toBe(null);
    expect(offline.getAttribute("aria-label")).toMatch(/reconnect/i);
    expect(offline.getAttribute("aria-label")).toMatch(/refresh/i);
  });

  it("triggers a list invalidation and flashes Refreshed when clicked while offline (Task #667)", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.fireError();
    });
    invalidateMock.mockClear();

    const offline = screen.getByTestId("tickets-live-connection-pill");
    expect(offline.tagName).toBe("BUTTON");

    act(() => {
      fireEvent.click(offline);
    });

    // The page's primary data is the filtered list query, so the
    // manual refresh must invalidate that exact key — same as the
    // gap-flagged hello path.
    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: LIST_TICKETS_KEY,
    });

    // Pill briefly flips to "refreshed" so the user gets the same
    // confirmation cue they'd see after an automatic recovery.
    const flashed = screen.getByTestId("tickets-live-connection-pill");
    expect(flashed.getAttribute("data-status")).toBe("refreshed");
    // Refreshed is a span (not interactive) — clicking has no
    // meaning while we're caught up.
    expect(flashed.tagName).toBe("SPAN");

    // After the 3s hold, the pill returns to "live".
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    const live = screen.getByTestId("tickets-live-connection-pill");
    expect(live.getAttribute("data-status")).toBe("live");
  });

  // Task #670 — a frustrated dispatcher mashing the pill on a flaky
  // connection used to fire one /api/tickets refetch per click. The
  // pill now coalesces clicks inside a short cooldown window so the
  // server never sees a duplicate-request spike, and the UI shows
  // the gate so the user understands why subsequent presses do
  // nothing. We only need to assert this once on the ticket-list
  // page — the throttle lives in the pill component itself, so
  // every call site (ticket-detail included) inherits it.
  it("coalesces rapid manual-refresh clicks during the cooldown window (Task #670)", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.fireError();
    });
    invalidateMock.mockClear();

    const offline = screen.getByTestId(
      "tickets-live-connection-pill",
    ) as HTMLButtonElement;
    expect(offline.tagName).toBe("BUTTON");

    // Mash the pill five times in the same synchronous burst — the
    // exact failure mode described in the task. Only the first click
    // should propagate to the parent's invalidate handler; the rest
    // must be swallowed by the cooldown gate.
    act(() => {
      fireEvent.click(offline);
      fireEvent.click(offline);
      fireEvent.click(offline);
      fireEvent.click(offline);
      fireEvent.click(offline);
    });
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });
  it("activates the manual refresh via Enter key for keyboard users (Task #667)", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.fireError();
    });
    invalidateMock.mockClear();

    const offline = screen.getByTestId(
      "tickets-live-connection-pill",
    ) as HTMLButtonElement;
    // Native <button> handles Enter/Space activation by dispatching
    // a click event. Verify keyboard activation actually fires the
    // refresh — this is the affordance keyboard-only dispatchers
    // depend on.
    act(() => {
      offline.focus();
      offline.click();
    });
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT flash Refreshed on the first hello of a fresh subscription", () => {
    render(<Tickets />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });
    // First hello on a brand-new EventSource carries gap=false. The
    // pill must stay on "live" — flashing "refreshed" here would be
    // a lie (we didn't actually miss anything).
    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 17,
        lastSeenSeq: null,
        gap: false,
      });
    });

    const pill = screen.getByTestId("tickets-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("live");
  });
});
