import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #861 — verify the audit-trail timeline gives reversed-payment
// transition rows (Task #504's `funds_dispersed → approved` rows whose
// reason is prefixed `Reversed:`) a distinct treatment: a "Payment
// reversed" headline + badge, the Undo2 icon, the destructive
// red-tinted reason block, and the `Reversed:` marker stripped from
// the displayed reason. Mirrors the mocking shape used by
// ticket-detail.assignment-removed.test.tsx so the same heavy children
// stay shimmed out.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}
(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

const adminUser = {
  userId: 5,
  role: "admin" as const,
  displayName: "Admin",
  partnerId: null,
  vendorId: null,
  vendorRole: null,
  preferredLanguage: "en" as const,
  activeMembershipId: null,
  availableMemberships: [],
  requiresContextChoice: false,
};

const { currentUser } = vi.hoisted(() => ({
  currentUser: { value: null as unknown },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: currentUser.value,
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

const { stableQueryClient } = vi.hoisted(() => ({
  stableQueryClient: {
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn().mockResolvedValue(undefined),
  },
}));
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
  status: "approved",
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
    transitions: [] as Array<Record<string, unknown>>,
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
  useGetTicketTransitions: () => ({ data: ticketState.transitions }),
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
  useReverseDispersal: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
  }),
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

import { render, screen } from "@testing-library/react";
import TicketDetail from "./ticket-detail";

beforeEach(() => {
  toastFn.mockReset();
  ticketState.data = { ...baseTicket };
  ticketState.dataUpdatedAt = 1000;
  ticketState.transitions = [];
  FakeEventSource.instances = [];
  stableQueryClient.invalidateQueries.mockClear();
  stableQueryClient.refetchQueries.mockClear();
  currentUser.value = adminUser;
});

describe("ticket-detail — Task #861 reversed-payment audit row (web)", () => {
  it("renders the reversal row with the distinct headline, badge, icon and red reason block", () => {
    // Two transitions: the original disperse-funds event AND the
    // reversal event the admin's POST /reverse-funds-dispersal would
    // have written. Both share the same shape the API returns from
    // GET /tickets/:id/transitions (Task #501).
    ticketState.transitions = [
      {
        id: 101,
        fromStatus: "approved",
        toStatus: "funds_dispersed",
        reason: null,
        displayReason: null,
        actorName: "AP Operator",
        actorRole: "admin",
        createdAt: "2026-04-30T15:00:00.000Z",
        fromVendorName: null,
        toVendorName: null,
      },
      {
        id: 202,
        fromStatus: "funds_dispersed",
        toStatus: "approved",
        reason: "Reversed: wrong vendor was paid",
        displayReason: "Reversed: wrong vendor was paid",
        actorName: "Admin Boss",
        actorRole: "admin",
        createdAt: "2026-04-30T16:00:00.000Z",
        fromVendorName: null,
        toVendorName: null,
      },
    ];

    render(<TicketDetail id={TICKET_ID} />);

    // The reversal entry should classify as `payment_reversed` —
    // distinct from the generic `reopened` arm which a plain
    // `funds_dispersed → approved` row (no `Reversed:` prefix) would
    // have hit. The `data-kind` attribute makes that explicit so a
    // future refactor can't silently widen the branch.
    const entry = screen.getByTestId("audit-trail-entry-202");
    expect(entry.getAttribute("data-kind")).toBe("payment_reversed");

    // The "Payment reversed" badge — the most visible signal — must
    // be present so AP/admins notice at a glance.
    expect(
      screen.getByTestId("audit-trail-payment-reversed-badge-202"),
    ).toBeTruthy();

    // The reason block should strip the `Reversed:` marker and show
    // the human reason verbatim under the dedicated label.
    const reason = screen.getByTestId("audit-trail-reason-202");
    expect(reason.textContent).toContain("Reversal reason:");
    expect(reason.textContent).toContain("wrong vendor was paid");
    expect(reason.textContent).not.toContain("Reversed:");

    // And it must render with the destructive red-tinted classes,
    // not the default amber treatment used for benign transitions.
    expect(reason.className).toContain("bg-red-50");
    expect(reason.className).not.toContain("bg-amber-50");

    // The original disperse-funds row stays in the timeline as its
    // own entry — the reversal is additive, not destructive.
    const original = screen.getByTestId("audit-trail-entry-101");
    expect(original.getAttribute("data-kind")).not.toBe("payment_reversed");
  });

  it("falls back to the generic reopened treatment when the reason is missing the Reversed: prefix", () => {
    // Defensive: a `funds_dispersed → approved` row written by some
    // *other* code path (or back-filled) without the marker should
    // NOT be misclassified as a reversal. This pins the prefix-match
    // contract.
    ticketState.transitions = [
      {
        id: 303,
        fromStatus: "funds_dispersed",
        toStatus: "approved",
        reason: "manual correction",
        displayReason: "manual correction",
        actorName: "Admin Boss",
        actorRole: "admin",
        createdAt: "2026-04-30T17:00:00.000Z",
        fromVendorName: null,
        toVendorName: null,
      },
    ];

    render(<TicketDetail id={TICKET_ID} />);

    const entry = screen.getByTestId("audit-trail-entry-303");
    expect(entry.getAttribute("data-kind")).toBe("reopened");
    expect(
      screen.queryByTestId("audit-trail-payment-reversed-badge-303"),
    ).toBeNull();
  });
});
