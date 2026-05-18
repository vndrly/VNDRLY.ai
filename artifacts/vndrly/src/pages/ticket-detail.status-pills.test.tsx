import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #632 — UI safety net for the consolidated `TicketStatusActionPill`
// (introduced in Task #620). The pill maps statuses → coloured action
// affordances inside the Actions card on the web ticket-detail page;
// without an automated check, earlier tasks (#576, #595, #599) had to
// re-add the missing pills one role at a time after refactors. This
// suite mounts the page for each pill-bearing status as each of the
// three roles that read the pill (field_employee / vendor / admin) and
// asserts the matching data-testid is present, so a future regression
// where one branch quietly drops the shared component fails loudly.
//
// The mocking shape mirrors the existing
// ticket-detail.assignment-removed.test.tsx harness (Task #606): same
// `@workspace/api-client-react` stubs, same heavy-child shims, same
// Dialog / Sheet / Select pass-throughs. We don't drive any mutations
// here — the assertion is purely "is the right pill in the DOM?".

// --- jsdom polyfill: Radix primitives transitively reach for
// ResizeObserver via react-use-size; a no-op shim is enough.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// === Auth identities ===
//
// One per role branch in ticket-detail.tsx. The page picks the actions
// footer off `user?.role`, so the pill must render in all three. We
// stay deliberately minimal — no partner identity here, since the
// partner branch reuses the admin actions footer (the `else` arm) and
// is gated on `viewerCanDisperseFunds` etc., not on the pill itself.
const fieldEmployeeUser = {
  userId: 99,
  role: "field_employee" as const,
  displayName: "Field Tester",
  partnerId: null,
  vendorId: 11,
  vendorRole: null,
  preferredLanguage: "en" as const,
  activeMembershipId: null,
  availableMemberships: [],
  requiresContextChoice: false,
};

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
    { id: 1, role: "admin", entityType: "vendor", entityId: 11, entityName: "Acme" },
  ],
  requiresContextChoice: false,
};

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

// --- Toast spy: nothing in this suite drives a mutation, so the toast
// spy is here purely to keep the hook callable. We don't assert on it.
const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn, toasts: [] }),
  toast: toastFn,
}));

// --- queryClient stub: the page calls invalidate / refetch on mutation
// success paths; we never trigger them, but the hook must return
// callable methods so the page module mounts.
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

// --- wouter Link: rendered as a plain <a> so the back button doesn't
// reach for the wouter routing context (we don't mount a Router here).
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// --- Ticket fixture is module-level so the per-case render can swap
// `status` without re-mocking the entire api-client module.
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
  // Keeping this `false` ensures the admin "Disperse Funds" button stays
  // hidden for the `approved` and `awaiting_payment` cases — the pill
  // is what we're checking, and a missing capability flag is the
  // common production case anyway.
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

// === Generated API client mocks ===
//
// Every hook ticket-detail imports has to be present at module load —
// the import statement is resolved before any test runs. Mutation hooks
// just return inert mutate spies; the pill itself is purely
// status-driven so none of these mutations get called during the
// status-pill assertions.
const {
  submitMutateMock,
  checkOutMutateMock,
  cancelMutateMock,
  approveMutateMock,
  kickbackMutateMock,
  unlockMutateMock,
  acceptMutateMock,
  denyMutateMock,
  reinviteMutateMock,
  reactivateMutateMock,
  disperseMutateMock,
  updateMutateMock,
  createNoteLogMock,
  createLineItemMock,
  deleteLineItemMock,
  upsertVendorRatingMock,
} = vi.hoisted(() => ({
  submitMutateMock: vi.fn(),
  checkOutMutateMock: vi.fn(),
  cancelMutateMock: vi.fn(),
  approveMutateMock: vi.fn(),
  kickbackMutateMock: vi.fn(),
  unlockMutateMock: vi.fn(),
  acceptMutateMock: vi.fn(),
  denyMutateMock: vi.fn(),
  reinviteMutateMock: vi.fn(),
  reactivateMutateMock: vi.fn(),
  disperseMutateMock: vi.fn(),
  updateMutateMock: vi.fn(),
  createNoteLogMock: vi.fn(),
  createLineItemMock: vi.fn(),
  deleteLineItemMock: vi.fn(),
  upsertVendorRatingMock: vi.fn(),
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
  // Task #501: audit-trail hook fired unconditionally by ticket-detail.
  useGetTicketTransitions: () => ({ data: [] }),
  // One labor line item so vendor-branch grandTotal > 0 — keeps Submit
  // rendering as the live blue variant (not the grey-empty variant)
  // when the status is `kicked_back`. Doesn't affect the pill itself,
  // but matches the same realistic-page shape the assignment-removed
  // test set up for the same component.
  useGetTicketLineItems: () => ({
    data: [
      {
        id: 1,
        type: "labor",
        description: "Hours",
        quantity: "1",
        unitPrice: "100",
      },
    ],
  }),
  useGetTaxRateByState: () => ({ data: null }),
  useGetVendorRatings: () => ({ data: [] }),
  useGetNearbyVendors: () => ({ data: undefined }),
  useCreateTicketNoteLog: () => ({ mutate: createNoteLogMock, isPending: false }),
  useCreateTicketLineItem: () => ({ mutate: createLineItemMock, isPending: false }),
  useDeleteTicketLineItem: () => ({ mutate: deleteLineItemMock, isPending: false }),
  useUpdateTicket: () => ({ mutate: updateMutateMock, isPending: false }),
  useSubmitTicket: () => ({ mutate: submitMutateMock, isPending: false }),
  useCheckOutTicket: () => ({ mutate: checkOutMutateMock, isPending: false }),
  useApproveTicket: () => ({ mutate: approveMutateMock, isPending: false }),
  useKickbackTicket: () => ({ mutate: kickbackMutateMock, isPending: false }),
  useUnlockTicket: () => ({ mutate: unlockMutateMock, isPending: false }),
  useAcceptTicket: () => ({ mutate: acceptMutateMock, isPending: false }),
  useDenyTicket: () => ({ mutate: denyMutateMock, isPending: false }),
  useReinviteTicket: () => ({ mutate: reinviteMutateMock, isPending: false }),
  useCancelTicket: () => ({ mutate: cancelMutateMock, isPending: false }),
  useReactivateTicket: () => ({ mutate: reactivateMutateMock, isPending: false }),
  useDisperseFundsTicket: () => ({ mutate: disperseMutateMock, isPending: false }),
  useReverseFundsDispersal: () => ({ mutate: vi.fn(), isPending: false }),
  useReverseDispersal: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertVendorRating: () => ({ mutate: upsertVendorRatingMock, isPending: false }),
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

// --- Eligibility hook (Task #525): drives the foreman picker for
// vendors. Never opened here, but the page calls it unconditionally on
// mount, so it needs a stable shape.
vi.mock("@/hooks/use-eligible-vendor-field-employees", () => ({
  useEligibleVendorFieldEmployeesByVendorId: () => ({
    eligibleForemen: [],
    fieldEmployees: [],
  }),
  useClearStaleFieldEmployeeSelection: () => undefined,
}));

// --- Heavy / DOM-hostile child components — same stubs used by the
// assignment-removed test. None of these affect the pill contract.
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

// --- Radix Dialog: pass-through that respects `open` and forwards
// trigger clicks. Mirrors the assignment-removed harness so the admin
// "submitted" / "approved" branches (which mount approve / kickback /
// unlock dialogs) and the vendor "kicked_back" branch (which mounts
// the cancel dialog) all render without exploding.
vi.mock("@/components/ui/dialog", () => {
  const DialogCtx = React.createContext<{
    open: boolean;
    setOpen: (v: boolean) => void;
  } | null>(null);

  const Dialog = ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
    children: React.ReactNode;
  }) => {
    const [internal, setInternal] = React.useState<boolean>(open ?? false);
    const isControlled = open !== undefined;
    const value = isControlled ? !!open : internal;
    const setOpen = (v: boolean) => {
      if (!isControlled) setInternal(v);
      onOpenChange?.(v);
    };
    return (
      <DialogCtx.Provider value={{ open: value, setOpen }}>
        {children}
      </DialogCtx.Provider>
    );
  };

  const DialogTrigger = ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => {
    const ctx = React.useContext(DialogCtx);
    const onClick = () => ctx?.setOpen(true);
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{
        onClick?: (e: unknown) => void;
      }>;
      return React.cloneElement(child, {
        onClick: (e: unknown) => {
          child.props.onClick?.(e);
          onClick();
        },
      });
    }
    return <button onClick={onClick}>{children}</button>;
  };

  const DialogContent = ({ children }: { children: React.ReactNode }) => {
    const ctx = React.useContext(DialogCtx);
    if (!ctx?.open) return null;
    return <div role="dialog">{children}</div>;
  };

  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );

  return {
    Dialog,
    DialogTrigger,
    DialogContent,
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

// --- Radix Sheet: pass-through. Sheet is imported but only opens for
// the "find another vendor" flow, which we never trigger.
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

// --- Radix Select: replaced with a passthrough. None of the tests here
// interact with one; the page mounts several inside the actions footer
// (line-item type, etc.) and they need to render without crashing.
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

// The contract under test: every status that the shared
// `TicketStatusActionPill` renders MUST appear in the Actions card for
// every role branch (field_employee / vendor / admin) — that's the
// whole point of consolidating the mapping (Task #620). If any branch
// stops rendering the shared component, the matching testid disappears
// and the corresponding case below fails loudly.
//
// The status → testid pairs are copied from
// `artifacts/vndrly/src/components/ticket-status-action-pill.tsx`. If
// you add a new status pill there, add it here too — that's the
// failure mode this suite is here to prevent.
const PILL_CASES: Array<{ status: string; testId: string }> = [
  { status: "approved", testId: "status-approved" },
  { status: "submitted", testId: "status-submitted" },
  { status: "pending_review", testId: "status-pending-review" },
  { status: "cancelled", testId: "status-cancelled" },
  { status: "awaiting_payment", testId: "status-awaiting-payment" },
  { status: "kicked_back", testId: "status-kicked-back" },
  { status: "funds_dispersed", testId: "status-funds-dispersed" },
];

const ROLE_CASES: Array<{ label: string; user: unknown }> = [
  { label: "field_employee", user: fieldEmployeeUser },
  { label: "vendor", user: vendorOfficeUser },
  { label: "admin", user: adminUser },
];

beforeEach(() => {
  toastFn.mockReset();
  submitMutateMock.mockReset();
  checkOutMutateMock.mockReset();
  cancelMutateMock.mockReset();
  approveMutateMock.mockReset();
  kickbackMutateMock.mockReset();
  unlockMutateMock.mockReset();
  acceptMutateMock.mockReset();
  denyMutateMock.mockReset();
  reinviteMutateMock.mockReset();
  reactivateMutateMock.mockReset();
  disperseMutateMock.mockReset();
  updateMutateMock.mockReset();
  createNoteLogMock.mockReset();
  createLineItemMock.mockReset();
  deleteLineItemMock.mockReset();
  upsertVendorRatingMock.mockReset();
  ticketState.dataUpdatedAt = 1000;
});

describe("ticket-detail — Task #632 status-pill role coverage", () => {
  for (const { label, user } of ROLE_CASES) {
    describe(`${label} viewer`, () => {
      for (const { status, testId } of PILL_CASES) {
        it(`renders the ${status} pill (data-testid="${testId}")`, () => {
          currentUser.value = user;
          ticketState.data = { ...baseTicket, status };

          render(<TicketDetail id={TICKET_ID} />);

          // The single, role-agnostic assertion: the matching pill is
          // in the DOM. If a role branch silently drops the shared
          // `TicketStatusActionPill`, this query throws — which is
          // exactly the regression we're guarding against (Tasks #576,
          // #595, #599 each had to add a missing pill one role at a
          // time before #620 consolidated the mapping).
          expect(screen.getByTestId(testId)).toBeTruthy();
        });
      }
    });
  }
});
