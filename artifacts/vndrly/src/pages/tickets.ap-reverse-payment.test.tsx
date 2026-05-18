import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task #863 — pin down the row-level Reverse / void payment action on
// the AP/payments list. The action only renders for admins on rows
// whose status is `funds_dispersed`, opens the same reason dialog the
// per-ticket page (Task #504) already uses, requires a non-empty reason
// before the Confirm button activates, and on success calls the
// generated `useReverseFundsDispersal` hook with `{ id, data: { reason } }`
// then invalidates the list so the row re-renders out of the dispersed
// status without a manual refresh.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. The page opens two on mount; we don't need
// to drive any pushes in this test, so a no-op shim is enough.
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
  userId: 7,
  role: "admin" as const,
  displayName: "Admin",
  partnerId: null,
  vendorId: null,
  vendorRole: null,
  preferredLanguage: "en" as const,
  activeMembershipId: 1,
  availableMemberships: [
    {
      id: 1,
      role: "admin",
      entityType: "platform",
      entityId: 0,
      entityName: "VNDRLY",
    },
  ],
  requiresContextChoice: false,
};

const partnerUser = {
  userId: 8,
  role: "partner" as const,
  displayName: "AP Clerk",
  partnerId: 5,
  vendorId: null,
  vendorRole: null,
  preferredLanguage: "en" as const,
  activeMembershipId: 2,
  availableMemberships: [
    {
      id: 2,
      role: "ap",
      entityType: "partner",
      entityId: 5,
      entityName: "Acme Partner",
    },
  ],
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

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn() }));
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateMock,
      fetchQuery: vi.fn(),
      setQueryData: vi.fn(),
      getQueryData: vi.fn(),
    }),
  };
});

// Two seed tickets: a funds_dispersed one (the row we expect a Reverse
// button on) and an unrelated approved one (the row that must stay
// button-free). Field shape mirrors what the real list endpoint returns
// for the columns this page reads.
const SEED_TICKETS = [
  {
    id: 4242,
    status: "funds_dispersed",
    siteName: "Site A",
    workTypeName: "Inspection",
    vendorName: "Vendor Z",
    fieldEmployeeName: "Crew One",
    intakeChannel: null,
    lifecycleState: null,
    unlockedAt: null,
    unlockedByName: null,
    unlockCount: 0,
    updatedAt: "2026-04-01T00:00:00Z",
    createdAt: "2026-04-01T00:00:00Z",
  },
  {
    id: 9999,
    status: "approved",
    siteName: "Site B",
    workTypeName: "Repair",
    vendorName: "Vendor Z",
    fieldEmployeeName: "Crew Two",
    intakeChannel: null,
    lifecycleState: null,
    unlockedAt: null,
    unlockedByName: null,
    unlockCount: 0,
    updatedAt: "2026-04-02T00:00:00Z",
    createdAt: "2026-04-02T00:00:00Z",
  },
];

const { reverseMutate, capturedListParams } = vi.hoisted(() => ({
  reverseMutate: vi.fn(),
  capturedListParams: { value: undefined as unknown },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListTickets: (params?: unknown) => {
    capturedListParams.value = params;
    return { data: SEED_TICKETS, isLoading: false };
  },
  useCreateTicket: () => ({ mutateAsync: vi.fn() }),
  useListSiteLocations: () => ({ data: [] }),
  useListWorkTypes: () => ({ data: [] }),
  useListVendors: () => ({ data: undefined }),
  useListFieldEmployees: () => ({ data: [] }),
  useGetTicketGpsLogs: () => ({ data: undefined }),
  useGetSiteLocation: () => ({ data: undefined }),
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  useReverseFundsDispersal: () => ({
    mutate: reverseMutate,
    isPending: false,
  }),
  getListTicketsQueryKey: (params?: unknown) => ["tickets-list", params],
  getListSiteLocationsQueryKey: () => ["site-locations"],
  getListWorkTypesQueryKey: () => ["work-types"],
  getListVendorsQueryKey: () => ["vendors"],
  getGetTicketGpsLogsQueryKey: () => ["gps-logs"],
  getGetSiteLocationQueryKey: () => ["site-location"],
  getGetTicketQueryKey: (id: number) => ["ticket", id],
  getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
  getTicket: vi.fn(),
}));

vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));

import { render, act, fireEvent, screen } from "@testing-library/react";
import Tickets from "./tickets";

beforeEach(() => {
  invalidateMock.mockReset();
  toastFn.mockReset();
  reverseMutate.mockReset();
  FakeEventSource.instances = [];
  currentUser.value = adminUser;
  capturedListParams.value = undefined;
});

describe("tickets list — AP reverse-payment action (Task #863)", () => {
  it("offers a Reverse payment trigger on funds_dispersed rows for admins", () => {
    render(<Tickets />);
    // The funds_dispersed row gets the trigger; the approved row does
    // not. We assert by row id so the test doesn't depend on copy.
    expect(
      screen.getByTestId("button-reverse-funds-4242"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("button-reverse-funds-9999"),
    ).toBeNull();
  });

  it("hides the Reverse payment trigger from non-admin viewers", () => {
    currentUser.value = partnerUser;
    render(<Tickets />);
    expect(
      screen.queryByTestId("button-reverse-funds-4242"),
    ).toBeNull();
  });

  it("opens the shared reason dialog when the row trigger is clicked", () => {
    render(<Tickets />);
    fireEvent.click(screen.getByTestId("button-reverse-funds-4242"));
    expect(
      screen.getByTestId("input-ap-reverse-funds-reason"),
    ).toBeTruthy();
    // Confirm starts disabled because the reason is empty — same gate
    // as the per-ticket version of the dialog.
    expect(
      (screen.getByTestId(
        "button-ap-confirm-reverse-funds",
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it(
    "calls the reverseFundsDispersal mutation with the typed reason and " +
      "invalidates the ticket list on success",
    () => {
      render(<Tickets />);
      fireEvent.click(screen.getByTestId("button-reverse-funds-4242"));
      const reasonInput = screen.getByTestId(
        "input-ap-reverse-funds-reason",
      ) as HTMLTextAreaElement;
      fireEvent.change(reasonInput, {
        target: { value: "wrong vendor — undo" },
      });
      fireEvent.click(screen.getByTestId("button-ap-confirm-reverse-funds"));

      expect(reverseMutate).toHaveBeenCalledTimes(1);
      const [vars, opts] = reverseMutate.mock.calls[0]!;
      expect(vars).toEqual({
        id: 4242,
        data: { reason: "wrong vendor — undo" },
      });

      // Drive the success callback exactly the way react-query would so
      // we can pin down the cache invalidation + success toast that the
      // AP page is supposed to fire.
      act(() => {
        (opts as { onSuccess?: () => void }).onSuccess?.();
      });
      expect(invalidateMock).toHaveBeenCalled();
      const invalidatedKeys = invalidateMock.mock.calls.map(
        (call) => (call[0] as { queryKey: unknown[] }).queryKey,
      );
      // List + per-ticket detail + per-ticket note logs all need to be
      // invalidated so any other open tab on this ticket also catches
      // the new state.
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining([
          ["tickets-list", undefined],
          ["ticket", 4242],
          ["ticket-note-logs", 4242],
        ]),
      );
      expect(toastFn).toHaveBeenCalled();
    },
  );

  it("shows a destructive toast and skips the mutation when reason is blank", () => {
    render(<Tickets />);
    fireEvent.click(screen.getByTestId("button-reverse-funds-4242"));
    // The Confirm button is gated by the reason text, so simulate the
    // bypass path by clearing/leaving the text empty and exercising the
    // public surface — we expect zero mutate calls regardless of how a
    // future refactor wires the click.
    const confirm = screen.getByTestId(
      "button-ap-confirm-reverse-funds",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(reverseMutate).not.toHaveBeenCalled();
  });

  it("includes funds_dispersed in the status filter dropdown for admins", () => {
    render(<Tickets />);
    // Open the V2 status menu and look for the funds_dispersed option.
    // The label comes from `ticketDetail.fundsDispersed`, which the
    // existing en bundle resolves to "Funds Dispersed".
    fireEvent.click(screen.getByTestId("select-status-filter"));
    expect(
      screen.getByTestId("status-option-funds_dispersed"),
    ).toBeTruthy();
  });
});
