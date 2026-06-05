import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #606 — pin down the assignment-removed banner behavior on the
// web ticket detail page (added in Task #593) with vitest coverage so a
// future refactor of TicketDetail can't silently regress it. The banner
// fires when a state-change POST (Submit / Send for Review) returns
// `site_vendor_mismatch` or `work_type_not_allowed` — see the
// onStateChangeError router in ticket-detail.tsx. We mirror the mocking
// pattern used by tickets.phone-intake-foreman-error.test.tsx (also a
// vendor-office vitest harness for the same `@workspace/api-client-react`
// hooks).

// --- jsdom polyfill: several Radix primitives the page transitively
// reaches reach for ResizeObserver via react-use-size; a no-op shim is
// enough since we don't actually measure anything in this test.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// --- Task #622: jsdom has no EventSource, but the page's auto-clear
// subscription opens one on mount. We install a tiny shim that records
// every instance and exposes a `dispatch(event, payload)` so a test can
// drive a fake `ticket.unblocked` push without any real network. The
// page's own try/catch keeps it resilient to a missing EventSource, but
// we want the *positive* path covered too.
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
    const idx = FakeEventSource.instances.indexOf(this);
    if (idx >= 0) FakeEventSource.instances.splice(idx, 1);
  }
  /** Test helper — fan out a message to every registered listener. */
  dispatch(type: string, data: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of set) fn(ev);
  }
}
(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

// === Auth identities ===
//
// Two viewers exercise the two state-change buttons that live behind
// the banner: a vendor office operator (Submit) and a field employee
// (Send for Review). The page checks `user?.role` on render to decide
// which actions footer to render, so we swap auth per describe-block.
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

// --- Toast spy: the banner path must NOT toast — that's the whole
// point of swallowing the error in onStateChangeError. We assert the
// spy stays empty on the banner-success path.
const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn, toasts: [] }),
  toast: toastFn,
}));

// --- queryClient stub: invalidate is called on the success paths we
// don't exercise here, but the hook must return *something* with the
// methods present so the page module mounts. The stub is hoisted +
// frozen so every render gets the SAME object — otherwise effects
// keyed on `queryClient` (Task #622's SSE subscription) re-run on
// every render and re-open their stream, which doesn't match the
// production hook's referential stability.
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

// --- wouter Link: rendered as a plain <a> so the back button doesn't
// reach for the wouter routing context (we don't mount a Router).
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// --- The ticket fixture and its updatedAt clock are module-level so a
// test can bump `ticketDataUpdatedAt` and rerender to simulate a
// successful refetch landing AFTER the banner was raised. The clear-
// effect in ticket-detail compares `ticketDataUpdatedAt` against the
// timestamp captured when the banner went up — bumping it forward is
// what should hide the banner.
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

// === Generated API client mocks ===
//
// Every hook ticket-detail imports has to be present, even the ones
// we don't drive — the import statement at the top of the module is
// resolved before any test runs. Mutation hooks return mutate spies
// the tests configure per case.
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
  // At least one line item so `grandTotal > 0` and Submit renders as
  // the live blue variant. The render-Submit branch in ticket-detail
  // collapses to a disabled grey button when grandTotal is 0 (or the
  // banner is up); we need the *non-banner* greying off so we can
  // observe the *banner* greying come on.
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
  // Query-key helpers are imported as plain functions; identity-style
  // arrays keep them serializable for the (mocked) queryClient.
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
// vendors. We never open the picker here, but the page calls these
// unconditionally on mount, so they need a stable shape.
vi.mock("@/hooks/use-eligible-vendor-field-employees", () => ({
  useEligibleVendorFieldEmployeesByVendorId: () => ({
    eligibleForemen: [],
    fieldEmployees: [],
  }),
  useClearStaleFieldEmployeeSelection: () => undefined,
}));

// --- Heavy / DOM-hostile child components mocked to harmless stubs.
// The route map drags in leaflet, the comments panel polls the API,
// the schedule dialog has its own state machine, etc. None of those
// are relevant to the banner contract under test.
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
// trigger clicks. The phone-intake test uses the same shim — Radix's
// portal/animation gymnastics don't survive jsdom cleanly.
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

// --- Radix Select: replaced with a native <select>. None of the tests
// here interact with one; the page mounts several inside the actions
// footer (line-item type, etc.) and they need to render without
// crashing.
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

import { render, screen, fireEvent, act } from "@testing-library/react";
import TicketDetail from "./ticket-detail";

function findTicketsEventSource(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/tickets\/events$/.test(i.url),
  );
  if (!es) {
    throw new Error(
      `No EventSource for /api/tickets/events. Saw: ${FakeEventSource.instances
        .map((i) => i.url)
        .join(", ")}`,
    );
  }
  return es;
}

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
  ticketState.data = { ...baseTicket };
  ticketState.dataUpdatedAt = 1000;
  FakeEventSource.instances = [];
  stableQueryClient.invalidateQueries.mockClear();
  stableQueryClient.refetchQueries.mockClear();
});

describe("ticket-detail — Task #593 assignment-removed banner (web)", () => {
  describe("vendor office viewer (Submit)", () => {
    beforeEach(() => {
      currentUser.value = vendorOfficeUser;
    });

    it("raises the banner with site copy when Submit fails with site_vendor_mismatch", () => {
      // Reject the way the generated client's customFetch does: a
      // payload whose `data.error` is the machine code. The page's
      // onStateChangeError reads exactly that shape.
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      render(<TicketDetail id={TICKET_ID} />);

      // Pre-condition: Submit is the live (non-grey) button and no
      // banner is rendered yet.
      expect(screen.queryByTestId("banner-assignment-removed")).toBeNull();
      const submit = screen.getByTestId(
        "button-submit-ticket",
      ) as HTMLButtonElement;
      expect(submit.disabled).toBe(false);

      fireEvent.click(submit);

      // Banner appears with the site-mismatch title (the work-type
      // copy talks about "work type", not "site"). Asserting on the
      // text rather than just presence guards against the two error
      // codes accidentally collapsing into a single message.
      const banner = screen.getByTestId("banner-assignment-removed");
      expect(banner).toBeTruthy();
      const title = screen.getByTestId(
        "text-assignment-removed-title",
      );
      expect(title.textContent).toMatch(/site/i);
      expect(title.textContent).not.toMatch(/work type/i);

      // The mutation call ran but the toast path did NOT fire — the
      // banner is the single source of truth for this failure mode
      // (otherwise the dispatcher gets two competing affordances).
      expect(submitMutateMock).toHaveBeenCalledTimes(1);
      expect(toastFn).not.toHaveBeenCalled();

      // Submit collapses to its disabled grey variant (`disabled` +
      // testid still resolves) so the dispatcher can't keep mashing
      // the same doomed action.
      const after = screen.getByTestId(
        "button-submit-ticket",
      ) as HTMLButtonElement;
      expect(after.disabled).toBe(true);
    });

    it("raises the banner with work-type copy when Submit fails with work_type_not_allowed", () => {
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "work_type_not_allowed" } });
        },
      );

      render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));

      const title = screen.getByTestId(
        "text-assignment-removed-title",
      );
      // The two copies must stay distinct so the operator can tell
      // *why* the partner blocked the action; the work-type variant
      // mentions "work type" while the site variant doesn't.
      expect(title.textContent).toMatch(/work type/i);
      expect(toastFn).not.toHaveBeenCalled();
    });

    it("falls back to the generic toast for unrelated failures (regression guard)", () => {
      // A non-assignment error code (e.g. anything else the server can
      // return on Submit) must NOT raise the banner — that would
      // mislead the operator into thinking the partner pulled the
      // assignment when something completely different went wrong.
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "internal_error" } });
        },
      );

      render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));

      expect(screen.queryByTestId("banner-assignment-removed")).toBeNull();
      // The generic destructive toast is the legacy path — the banner
      // shouldn't have stolen this code.
      expect(toastFn).toHaveBeenCalledTimes(1);
      // Submit stays live so the operator can retry whatever
      // transient error that was.
      const submit = screen.getByTestId(
        "button-submit-ticket",
      ) as HTMLButtonElement;
      expect(submit.disabled).toBe(false);
    });

    it("clears the banner after a successful refetch (partner restored access)", () => {
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      const { rerender } = render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));
      expect(
        screen.getByTestId("banner-assignment-removed"),
      ).toBeTruthy();

      // Simulate the next ticket refetch landing — bumping
      // `dataUpdatedAt` past the snapshot the banner captured. The
      // clear-on-refresh effect should drop the banner; if the partner
      // hasn't actually re-granted the assignment yet, the next
      // submit attempt will re-raise it.
      act(() => {
        ticketState.dataUpdatedAt = 5000;
      });
      rerender(<TicketDetail id={TICKET_ID} />);

      expect(
        screen.queryByTestId("banner-assignment-removed"),
      ).toBeNull();
      // Submit returns to its live, clickable variant.
      const after = screen.getByTestId(
        "button-submit-ticket",
      ) as HTMLButtonElement;
      expect(after.disabled).toBe(false);
    });

    it("Cancel on the banner confirms and runs the cancel mutation", () => {
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));

      // Stub window.confirm so we control the prompt outcome. The
      // banner uses a plain confirm() (not the Radix cancel dialog)
      // so it works for any role that can hit the banner — including
      // a field_employee viewing the page on the web.
      const confirmSpy = vi
        .spyOn(window, "confirm")
        .mockReturnValueOnce(true);

      fireEvent.click(
        screen.getByTestId("button-assignment-removed-cancel"),
      );

      // The confirm prompt must fire — silently cancelling on click
      // would be the wrong UX (cancel is destructive).
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      // And the cancel mutation must be invoked with the ticket id.
      expect(cancelMutateMock).toHaveBeenCalledTimes(1);
      const [vars] = cancelMutateMock.mock.calls[0];
      expect(vars).toEqual({ id: TICKET_ID });

      confirmSpy.mockRestore();
    });

    it("does NOT cancel when the user declines the confirm prompt", () => {
      // The flip side of the previous test — make sure clicking cancel
      // and saying "no" is a no-op. Otherwise the dispatcher who
      // missclicked the banner button has no escape hatch.
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));

      const confirmSpy = vi
        .spyOn(window, "confirm")
        .mockReturnValueOnce(false);

      fireEvent.click(
        screen.getByTestId("button-assignment-removed-cancel"),
      );

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(cancelMutateMock).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });
  });

  describe("field employee viewer (Send for Review)", () => {
    beforeEach(() => {
      currentUser.value = fieldEmployeeUser;
    });

    it("raises the banner and disables Send for Review when check-out fails with site_vendor_mismatch", () => {
      // The mobile counterpart of this exact code path is covered by
      // artifacts/vndrly-mobile/app/__tests__/ticket-detail-assignment-removed.test.tsx
      // (Task #572). This is the web parallel: the field-employee
      // Send-for-Review flow funnels through useCheckOutTicket, so a
      // site_vendor_mismatch response from check-out should also
      // raise the same banner instead of falling through to a toast.
      //
      // We bypass the geolocation prompt by replacing
      // navigator.geolocation with a stub that always succeeds — the
      // production code path takes the same branch on a successful
      // location read.
      const originalGeo = (navigator as { geolocation?: unknown })
        .geolocation;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (
            success: (pos: {
              coords: { latitude: number; longitude: number };
            }) => void,
          ) => {
            success({ coords: { latitude: 30, longitude: -90 } });
          },
        },
      });

      checkOutMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      try {
        render(<TicketDetail id={TICKET_ID} />);

        const send = screen.getByTestId(
          "button-send-for-review",
        ) as HTMLButtonElement;
        expect(send.disabled).toBe(false);

        fireEvent.click(send);

        // Banner is up with site copy.
        const title = screen.getByTestId(
          "text-assignment-removed-title",
        );
        expect(title.textContent).toMatch(/site/i);

        // Send for Review locks until the assignment comes back —
        // re-tapping just re-raises the banner, which is exactly the
        // confused-state we're trying to prevent.
        const sendAfter = screen.getByTestId(
          "button-send-for-review",
        ) as HTMLButtonElement;
        expect(sendAfter.disabled).toBe(true);

        // No toast — the banner is the single source of truth.
        expect(toastFn).not.toHaveBeenCalled();
      } finally {
        if (originalGeo === undefined) {
          delete (navigator as { geolocation?: unknown }).geolocation;
        } else {
          Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: originalGeo,
          });
        }
      }
    });
  });

  // Task #622 — web counterpart to the mobile foreground auto-clear added
  // in Task #613. The mobile screen listens for the `ticket_unblocked`
  // Expo push and re-runs `load()`; the web screen has no push channel,
  // so it subscribes to the `/api/tickets/events` SSE stream wired up
  // for this purpose. On a matching `ticket.unblocked` event we kick a
  // ticket-query invalidation, and the existing clear-on-refresh effect
  // dismisses the banner the moment the next refetch lands. These tests
  // pin down the subscription contract — open on mount, route by
  // ticketId, ignore other tickets, close on unmount — without spinning
  // up real servers or a real EventSource.
  describe("SSE auto-clear (Task #622)", () => {
    beforeEach(() => {
      currentUser.value = vendorOfficeUser;
    });

    it("opens an EventSource on mount with the canonical events URL", () => {
      const { unmount } = render(<TicketDetail id={TICKET_ID} />);
      // Exactly one subscription per page mount; reconnects/refetches
      // would balloon connections to the proxy, which has finite
      // long-lived stream slots.
      expect(
        FakeEventSource.instances.filter((i) => /\/api\/tickets\/events$/.test(i.url))
          .length,
      ).toBe(1);
      const es = findTicketsEventSource();
      // The path is intentionally relative to import.meta.env.BASE_URL
      // so the same code works under the dev path-routed proxy and
      // under the deployed root mount.
      expect(es.url).toMatch(/\/api\/tickets\/events$/);
      // withCredentials is non-negotiable — without it the browser
      // strips the session cookie and the server returns 401, leaving
      // the page on the 7s poll fallback (Task #607) for nothing.
      expect(es.withCredentials).toBe(true);
      unmount();
      // The stream is long-lived; React strict-mode aside, leaving it
      // open after the page navigates away leaks a connection per
      // ticket the user has opened in their session.
      expect(es.closed).toBe(true);
    });

    it("clears the assignment-removed banner on a matching ticket.unblocked event", () => {
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      const { rerender } = render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));
      // Banner is up — the SSE handler has to drop it without any
      // user interaction.
      expect(
        screen.getByTestId("banner-assignment-removed"),
      ).toBeTruthy();

      // Task #648: the banner WAS up when the unblock arrived, so the
      // dispatcher gets a brief confirmation that the action they
      // were trying to take is unblocked. We assert the toast fires
      // exactly once on this path — and below we cover the inverse
      // (no banner → no toast) so the gate stays in place.
      const toastCallsBeforeUnblock = toastFn.mock.calls.length;

      const es = findTicketsEventSource();
      act(() => {
        es.dispatch("ticket.unblocked", {
          type: "ticket.unblocked",
          ticketId: TICKET_ID,
          vendorId: 11,
          partnerId: 22,
        });
      });

      // The handler invalidated the ticket query; in the real app that
      // triggers a refetch, which bumps `dataUpdatedAt`. In the mocked
      // hook we simulate that bump explicitly — this is the same hook
      // the existing "successful refetch dismisses the banner" test
      // (above) relies on.
      act(() => {
        ticketState.dataUpdatedAt = 6000;
      });
      rerender(<TicketDetail id={TICKET_ID} />);

      expect(
        screen.queryByTestId("banner-assignment-removed"),
      ).toBeNull();
      // Task #648: confirmation toast fires once on the banner-was-up
      // path — mirrors the mobile detail-screen toast from Task #623
      // so a desktop dispatcher mid-task realizes the banner cleared
      // and can stop staring at a greyed-out Submit button.
      expect(toastFn.mock.calls.length).toBe(toastCallsBeforeUnblock + 1);
      const lastToast = toastFn.mock.calls[toastFn.mock.calls.length - 1]![0];
      // Title comes from the new locale key — assert on its presence
      // rather than the literal English copy so a future copy tweak
      // doesn't have to update this test. The non-blocking 3s
      // duration matches mobile and the existing "Refreshed" pill.
      expect(lastToast.title).toMatch(/restored/i);
      expect(lastToast.duration).toBe(3000);
      // No `variant: "destructive"` — this is a positive confirmation,
      // not an error. Default variant keeps the visual language
      // consistent with the other "things are fine" toasts.
      expect(lastToast.variant).toBeUndefined();
    });

    // Task #648: the toast must NOT fire when an unblock event arrives
    // on a ticket the dispatcher is just casually viewing (banner never
    // raised). This is the spam-prevention gate that mirrors mobile's
    // `assignmentRemovedRef.current !== null` check from Task #623 —
    // without it, every partner-side restore for an unrelated ticket
    // the operator happens to have open would pop a toast.
    it("does NOT toast when ticket.unblocked arrives without the banner being up", () => {
      render(<TicketDetail id={TICKET_ID} />);
      // Pre-condition: no failed Submit, so no banner. The page is
      // just sitting on a healthy ticket.
      expect(screen.queryByTestId("banner-assignment-removed")).toBeNull();
      const toastCallsBeforeUnblock = toastFn.mock.calls.length;

      const es = findTicketsEventSource();
      act(() => {
        es.dispatch("ticket.unblocked", {
          type: "ticket.unblocked",
          ticketId: TICKET_ID,
          vendorId: 11,
          partnerId: 22,
        });
      });

      // No banner → no toast. The handler still invalidates the ticket
      // query (covered by the live-unblock list test), but stays
      // silent in the UI so a quietly-restored ticket doesn't shout.
      expect(toastFn.mock.calls.length).toBe(toastCallsBeforeUnblock);
    });

    it("ignores ticket.unblocked events for other tickets", () => {
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      const { rerender } = render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));
      expect(
        screen.getByTestId("banner-assignment-removed"),
      ).toBeTruthy();

      const es = findTicketsEventSource();
      // Two unrelated unblocks — different ticket id and a malformed
      // payload. Neither should pull our ticket out of cache or drop
      // our banner. (The handler is shared across all open ticket
      // tabs — the server-side scope is "this user's vendor", not
      // "this exact ticket".)
      act(() => {
        es.dispatch("ticket.unblocked", {
          type: "ticket.unblocked",
          ticketId: TICKET_ID + 1,
        });
      });
      act(() => {
        // Malformed payload — the page must not throw and must not
        // dismiss the banner. JSON.parse on a non-JSON `data` is the
        // realistic failure mode if something upstream double-encodes.
        const set = (es as unknown as {
          listeners: Map<string, Set<(ev: MessageEvent) => void>>;
        }).listeners.get("ticket.unblocked");
        for (const fn of set ?? []) {
          fn({ data: "not-json" } as MessageEvent);
        }
      });

      // dataUpdatedAt did NOT advance, so the clear-on-refresh effect
      // doesn't fire either — the banner is still up.
      rerender(<TicketDetail id={TICKET_ID} />);
      expect(
        screen.getByTestId("banner-assignment-removed"),
      ).toBeTruthy();
    });
  });

  // Task #657 — when EventSource auto-reconnects (laptop wakes,
  // proxy hiccup, etc.), the server's one-shot `ticket.hello` carries
  // `gap === true` if the global ticket-event sequence has advanced
  // past the client's Last-Event-ID. Treating that as "we may have
  // missed a ticket.unblocked for THIS ticket" by re-fetching the
  // ticket once is the same recovery path the missed event would
  // have triggered — and it's what closes the gap that motivated the
  // task. Without it, a missed unblock leaves the banner up until
  // the existing 7s poll fires.
  describe("ticket.hello gap detection (Task #657)", () => {
    beforeEach(() => {
      currentUser.value = vendorOfficeUser;
    });

    it("re-fetches the ticket on a gap-flagged hello and clears the banner", () => {
      submitMutateMock.mockImplementation(
        (
          _vars: unknown,
          opts: { onError?: (err: unknown) => void },
        ) => {
          opts.onError?.({ data: { error: "site_vendor_mismatch" } });
        },
      );

      const { rerender } = render(<TicketDetail id={TICKET_ID} />);
      fireEvent.click(screen.getByTestId("button-submit-ticket"));
      expect(
        screen.getByTestId("banner-assignment-removed"),
      ).toBeTruthy();

      const es = findTicketsEventSource();
      expect(es).toBeTruthy();

      // Reset the spy so we can assert the hello path triggered
      // exactly one invalidation — independent of any incidental
      // invalidations from the failed Submit mutation.
      stableQueryClient.invalidateQueries.mockClear();

      act(() => {
        es.dispatch("ticket.hello", {
          type: "ticket.hello",
          currentSeq: 99,
          lastSeenSeq: 50,
          gap: true,
        });
      });

      // Same query key the live-unblock handler uses — we treat the
      // gap as "we may have missed an unblock for this ticket", so
      // recovery is identical to receiving the missed event itself.
      expect(stableQueryClient.invalidateQueries).toHaveBeenCalledTimes(1);
      expect(stableQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["ticket", TICKET_ID],
      });

      // Simulate the resulting refetch landing — the existing
      // clear-on-refresh effect drops the banner once dataUpdatedAt
      // advances past the snapshot the banner captured.
      act(() => {
        ticketState.dataUpdatedAt = 7000;
      });
      rerender(<TicketDetail id={TICKET_ID} />);
      expect(
        screen.queryByTestId("banner-assignment-removed"),
      ).toBeNull();
    });

    it("does NOT re-fetch on the first hello of a fresh subscription", () => {
      render(<TicketDetail id={TICKET_ID} />);
      const es = findTicketsEventSource();
      expect(es).toBeTruthy();

      // Drop any incidental invalidations from mount so we can
      // observe ONLY the hello handler's behavior.
      stableQueryClient.invalidateQueries.mockClear();

      // Brand-new EventSource → no Last-Event-ID → server replies
      // gap:false. Refetching here would be wasted work — the page's
      // own query just mounted and is already fresh.
      act(() => {
        es.dispatch("ticket.hello", {
          type: "ticket.hello",
          currentSeq: 12,
          lastSeenSeq: null,
          gap: false,
        });
      });

      expect(stableQueryClient.invalidateQueries).not.toHaveBeenCalled();
    });

    it("ignores a malformed hello payload", () => {
      render(<TicketDetail id={TICKET_ID} />);
      const es = findTicketsEventSource();
      expect(es).toBeTruthy();

      stableQueryClient.invalidateQueries.mockClear();

      // Same defensive posture as the unblock handler — a non-JSON
      // payload must not throw out of the SSE listener (which would
      // tear down the rest of the page).
      act(() => {
        const set = (es as unknown as {
          listeners: Map<string, Set<(ev: MessageEvent) => void>>;
        }).listeners.get("ticket.hello");
        for (const fn of set ?? []) {
          fn({ data: "not-json" } as MessageEvent);
        }
      });

      expect(stableQueryClient.invalidateQueries).not.toHaveBeenCalled();
    });
  });
});
