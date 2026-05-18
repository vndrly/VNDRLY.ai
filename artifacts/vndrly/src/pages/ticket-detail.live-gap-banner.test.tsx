import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #659 — pin down the explicit "live updates briefly disconnected"
// banner the ticket-detail page raises when /api/tickets/events sends a
// `ticket.hello` with `gap: true`. The connection pill flash is
// covered by ticket-detail.live-connection-pill.test.tsx; the
// underlying invalidate-on-gap behavior is covered by the same file
// (Task #657 path). This spec covers the *visible inline banner*
// added in Task #659 and its auto-clear on the next refetch landing.
//
// Mocks / FakeEventSource pattern are cribbed verbatim from
// ticket-detail.live-connection-pill.test.tsx (the closest-shape
// existing harness) so the page mounts in exactly the same shape.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

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
  dispatch(type: string, data: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const ev = {
      data: typeof data === "string" ? data : JSON.stringify(data),
    } as MessageEvent;
    for (const fn of set) fn(ev);
  }
  fireOpen(): void {
    this.onopen?.(new Event("open"));
  }
  fireError(): void {
    this.onerror?.(new Event("error"));
  }
}
(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

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

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

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

// Hoisted ticket state — `dataUpdatedAt` is what the gap-banner clear
// effect watches. Tests bump it (then re-render) to simulate the
// refetch landing.
const { ticketState } = vi.hoisted(() => ({
  ticketState: {
    data: null as unknown,
    dataUpdatedAt: 1000,
  },
}));

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

// Radix passthroughs — same shims as the live-connection-pill spec.
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

describe("ticket-detail — live-gap banner (Task #659)", () => {
  it("does NOT render the banner on a fresh mount", () => {
    render(<TicketDetail id={TICKET_ID} />);
    expect(screen.queryByTestId("banner-ticket-live-gap")).toBeNull();
  });

  it("does NOT render the banner on a no-gap hello", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 17,
        lastSeenSeq: null,
        gap: false,
      });
    });

    expect(screen.queryByTestId("banner-ticket-live-gap")).toBeNull();
  });

  it("renders the banner when ticket.hello arrives with gap=true", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 99,
        lastSeenSeq: 17,
        gap: true,
      });
    });

    const banner = screen.getByTestId("banner-ticket-live-gap");
    // role=status + aria-live=polite is what makes this announce to a
    // screen-reader user without preempting focus — same a11y contract
    // the Crew Map gap warnings use.
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(
      screen.getByTestId("text-ticket-live-gap-message").textContent,
    ).toMatch(/reconnect/i);
    // The "Refresh now" affordance is a visible control, not an a11y-
    // only fallback — the banner must always offer it.
    expect(screen.getByTestId("button-ticket-live-gap-refresh")).toBeTruthy();
    // The gap path must also have invalidated this ticket so the
    // banner's clear-effect has a fresh refetch to wait on.
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: ["ticket", TICKET_ID],
    });
  });

  it("auto-clears once ticket dataUpdatedAt advances past the snapshot", () => {
    const { rerender } = render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 99,
        lastSeenSeq: 17,
        gap: true,
      });
    });
    expect(screen.getByTestId("banner-ticket-live-gap")).toBeTruthy();

    // Simulate the gap-driven refetch landing: bump dataUpdatedAt and
    // re-render. The clear effect should drop the banner because
    // dataUpdatedAt now exceeds the snapshot taken when the banner
    // went up.
    act(() => {
      ticketState.dataUpdatedAt = 2000;
      rerender(<TicketDetail id={TICKET_ID} />);
    });

    expect(screen.queryByTestId("banner-ticket-live-gap")).toBeNull();
  });

  it("Refresh now button invalidates the ticket and the banner clears once the refetch lands", () => {
    const { rerender } = render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 99,
        lastSeenSeq: 17,
        gap: true,
      });
    });
    // Reset the spy so we only assert the *button-driven* invalidate.
    invalidateMock.mockClear();

    act(() => {
      screen
        .getByTestId("button-ticket-live-gap-refresh")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: ["ticket", TICKET_ID],
    });
    // The banner doesn't clear on the click itself — it clears once
    // the resulting refetch lands and bumps dataUpdatedAt.
    expect(screen.getByTestId("banner-ticket-live-gap")).toBeTruthy();

    act(() => {
      ticketState.dataUpdatedAt = 2000;
      rerender(<TicketDetail id={TICKET_ID} />);
    });
    expect(screen.queryByTestId("banner-ticket-live-gap")).toBeNull();
  });

  it("ignores a malformed hello payload (no banner)", () => {
    render(<TicketDetail id={TICKET_ID} />);
    const es = findTicketsEventSource();

    act(() => {
      es.dispatch("ticket.hello", "not-json");
    });

    expect(screen.queryByTestId("banner-ticket-live-gap")).toBeNull();
  });
});
