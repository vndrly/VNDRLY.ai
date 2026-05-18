import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #677 — pin down the live SSE health pill rendered on the ticket
// detail page (added in Task #661, manual-refresh affordance added in
// Task #667). The list page already has equivalent coverage in
// `tickets.live-connection-pill.test.tsx`; this spec mirrors it for
// the ticket-detail page so a future refactor of the hand-rolled SSE
// lifecycle on `/api/tickets/events` here can't silently regress the
// connecting → live → reconnecting → refreshed → live transitions.
//
// Mocks are cribbed from `ticket-detail.assignment-removed.test.tsx`
// (the existing ticket-detail vitest harness) and the FakeEventSource
// shape from `tickets.live-connection-pill.test.tsx` (which adds the
// `onopen` / `onerror` setters this test needs to drive the pill).

// jsdom polyfill — Radix primitives the page transitively pulls in
// reach for ResizeObserver via react-use-size.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shape as
// `tickets.live-connection-pill.test.tsx`: addEventListener for typed
// channels (`ticket.hello`) and onopen / onerror setters so the test
// can drive the pill's connection state directly.
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

// === Auth ===
//
// A vendor-office viewer is sufficient — the SSE pill renders
// independently of the actions footer, but the page still needs *some*
// resolved user to mount cleanly.
const vendorOfficeUser = {
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
    user: vendorOfficeUser,
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

// queryClient stub — must return the *same* reference across renders
// so the page's SSE effect (which lists `queryClient` in its deps)
// doesn't tear down and recreate the EventSource on every render
// (which would also blow away the 3-second `flashRefreshed`
// setTimeout the gap-recovery test depends on).
const { stableQueryClient, invalidateMock } = vi.hoisted(() => {
  const m = vi.fn();
  return {
    invalidateMock: m,
    stableQueryClient: {
      invalidateQueries: m,
      refetchQueries: vi.fn().mockResolvedValue(undefined),
    },
  };
});
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => stableQueryClient,
  };
});

// wouter Link → plain <a> so we don't need a Router context.
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// Ticket fixture — module-level so a test could bump it if needed.
// The pill renders inside the page header below the `if (!ticket)`
// guard, so we need a non-null ticket for the assertions to find
// the pill.
const TICKET_ID = 1;
const baseTicket = {
  id: TICKET_ID,
  status: "in_progress",
  description: "Repair fence",
  notes: "",
  siteName: "Acme Site",
  siteLocationId: 50,
  workTypeName: "Maintenance",
  partnerName: "Big Partner",
  vendorName: "Acme Vendor",
  partnerLogoUrl: null,
  vendorLogoUrl: null,
  vendorId: 11,
  partnerId: 22,
  fieldEmployeeId: 99,
  foremanUserId: 99,
  unlockedAt: null,
  unlockedByName: null,
  unlockCount: 0,
  viewerCanDisperseFunds: false,
  afe: null,
  arrivedAt: new Date().toISOString(),
  checkInTime: new Date().toISOString(),
};

const { ticketState } = vi.hoisted(() => ({
  ticketState: {
    data: null as unknown,
    dataUpdatedAt: 1000,
  },
}));

// Generated API client mocks — the import statement at the top of
// ticket-detail is resolved before any test runs, so every hook the
// page imports must be present even if this test never drives it.
vi.mock("@workspace/api-client-react", () => ({
  useGetTicket: () => ({
    data: ticketState.data,
    isLoading: false,
    dataUpdatedAt: ticketState.dataUpdatedAt,
  }),
  useGetTicketGpsLogs: () => ({ data: [] }),
  useGetCrewSessions: () => ({ data: [] }),
  useGetSiteLocation: () => ({ data: null }),
  useGetTicketNoteLogs: () => ({ data: [] }),
  useGetTicketUnlocks: () => ({ data: [] }),
  // Task #501: audit-trail hook fired unconditionally by ticket-detail.
  useGetTicketTransitions: () => ({ data: [] }),
  useGetTicketLineItems: () => ({ data: [] }),
  useGetTaxRateByState: () => ({ data: null }),
  useGetVendorRatings: () => ({ data: [] }),
  useGetNearbyVendors: () => ({ data: undefined }),
  useCreateTicketNoteLog: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTicketLineItem: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTicketLineItem: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useCheckOutTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useKickbackTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useAcceptTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useDenyTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useReinviteTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useDisperseFundsTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useReverseFundsDispersal: () => ({ mutate: vi.fn(), isPending: false }),
  useReverseDispersal: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertVendorRating: () => ({ mutate: vi.fn(), isPending: false }),
  getGetTicketQueryKey: (id: number) => ["ticket", id],
  getGetTicketGpsLogsQueryKey: (id: number) => ["ticket-gps-logs", id],
  getGetCrewSessionsQueryKey: (id: number) => ["crew-sessions", id],
  getGetSiteLocationQueryKey: (id: number) => ["site-location", id],
  getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-notes", id],
  getGetTicketUnlocksQueryKey: (id: number) => ["ticket-unlocks", id],
  getGetTicketTransitionsQueryKey: (id: number) => ["ticket-transitions", id],
  getGetTicketLineItemsQueryKey: (id: number) => ["ticket-line-items", id],
  getGetTaxRateByStateQueryKey: (s: string) => ["tax-rate", s],
  getGetNearbyVendorsQueryKey: (id: number) => ["nearby-vendors", id],
  getGetVendorRatingsQueryKey: (id: number) => ["vendor-ratings", id],
}));

vi.mock("@/hooks/use-eligible-vendor-field-employees", () => ({
  useEligibleVendorFieldEmployeesByVendorId: () => ({
    eligibleForemen: [],
    fieldEmployees: [],
  }),
  useClearStaleFieldEmployeeSelection: () => undefined,
}));

// Heavy / DOM-hostile child components — none of them are involved in
// the pill contract.
vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));
vi.mock("@/components/ticket-status-stepper", () => ({
  default: () => null,
}));
vi.mock("@/components/star-rating", () => ({
  default: () => null,
}));
vi.mock("@/components/comments-panel", () => ({
  default: () => null,
}));
vi.mock("@/components/crew-time-section", () => ({
  CrewTimeSection: () => null,
}));
vi.mock("@/components/schedule-ticket-dialog", () => ({
  default: () => null,
}));

// Radix Dialog / Sheet / Select pass-throughs (same shims as the
// existing ticket-detail spec — Radix's portal/animation gymnastics
// don't survive jsdom cleanly).
vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Dialog: passthrough,
    DialogTrigger: passthrough,
    DialogContent: () => null,
    DialogHeader: passthrough,
    DialogFooter: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogClose: passthrough,
    DialogPortal: passthrough,
    DialogOverlay: passthrough,
    DialogLogoHeader: () => null,
  };
});
vi.mock("@/components/ui/sheet", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Sheet: passthrough,
    SheetContent: () => null,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
    SheetDescription: passthrough,
    SheetTrigger: passthrough,
  };
});
vi.mock("@/components/ui/select", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Select: passthrough,
    SelectGroup: passthrough,
    SelectValue: () => null,
    SelectTrigger: () => null,
    SelectContent: () => null,
    SelectItem: () => null,
  };
});

import { render, act, screen } from "@testing-library/react";
import TicketDetail from "./ticket-detail";

function findTicketsEventSource(): FakeEventSource {
  // The page builds the URL as `${BASE_URL}/api/tickets/events`. In
  // the vitest run BASE_URL is "/", so the constructed URL ends with
  // `/api/tickets/events`. Match suffix to stay tolerant of any future
  // BASE_URL change.
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/tickets\/events$/.test(i.url),
  );
  if (!es) throw new Error("No EventSource for /api/tickets/events");
  return es;
}

beforeEach(() => {
  invalidateMock.mockReset();
  stableQueryClient.refetchQueries.mockClear();
  ticketState.data = { ...baseTicket };
  ticketState.dataUpdatedAt = 1000;
  FakeEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ticket-detail — live connection pill (Task #677)", () => {
  it("starts in the Connecting state on mount", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const pill = screen.getByTestId("ticket-detail-live-connection-pill");
    // Status is encoded as a data attribute so visual tweaks don't
    // break the assertion. The pill MUST start as "connecting"
    // because the EventSource hasn't fired onopen yet.
    expect(pill.getAttribute("data-status")).toBe("connecting");
    // role=status with aria-live=polite is what makes the pill
    // screen-reader friendly without preempting focus. Pin it down
    // so a future refactor doesn't accidentally drop it.
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-live")).toBe("polite");
  });

  it("flips to Live once the EventSource opens", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });

    const pill = screen.getByTestId("ticket-detail-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("live");
  });

  it("flips to Reconnecting on EventSource error", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    // Open first so we can show the drop is detected after a healthy
    // connection — the more realistic ordering than erroring on first
    // connect.
    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.fireError();
    });

    const pill = screen.getByTestId("ticket-detail-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("reconnecting");
  });

  it("flashes Refreshed for ~3s after a gap-flagged hello, then returns to Live", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    // Drop, reconnect, then receive a hello with gap=true — the
    // realistic sequence the user sees after waking a laptop. The
    // ticket-detail SSE effect intentionally guards against onopen
    // clobbering the refreshed flash so the user actually sees the
    // confirmation; this asserts that guard still holds.
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

    const pill = screen.getByTestId("ticket-detail-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("refreshed");
    // Live region semantics are still in place on the refreshed
    // span — a screen reader user must hear the confirmation.
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-live")).toBe("polite");

    // After the 3s hold the pill returns to "live" so it doesn't sit
    // on the success copy forever.
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(
      screen
        .getByTestId("ticket-detail-live-connection-pill")
        .getAttribute("data-status"),
    ).toBe("live");
  });
});
