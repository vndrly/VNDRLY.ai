vi.mock("@/components/dashboard-ticket-panels", () => ({ useDashboardTicketPanels: () => ({ data: undefined }), DashboardTicketPanels: () => null, DashboardTicketLocationCount: () => null }));
vi.mock("@/hooks/use-eligible-vendor-field-employees", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-eligible-vendor-field-employees")>();
  const api = await import("@workspace/api-client-react");
  return { ...actual, useServiceEmployees: () => api.useListFieldEmployees() };
});
vi.mock("@/components/dashboard-ticket-journeys", () => ({ DashboardTicketJourneys: () => null }));
import * as React from "react";
import { expect, it, vi } from "vitest";

// jsdom doesn't ship ResizeObserver, but several of the Radix primitives
// the Tickets page mounts (Checkbox, etc.) reach for it via
// `react-use-size`. A minimal no-op polyfill keeps the page mountable
// without dragging in a heavier shim package.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// --- Auth: a vendor-office operator. The phone-intake trigger only
// renders for `isVendorOffice` (Task #498) — a plain vendor user
// wouldn't see the "Phone intake" button in the toolbar.
const vendorOfficeUser = {
  userId: 1,
  role: "vendor" as const,
  displayName: "Op",
  partnerId: null,
  vendorId: 1,
  vendorRole: "office" as const,
  preferredLanguage: "en" as const,
  activeMembershipId: 1,
  availableMemberships: [
    { id: 1, role: "admin", entityType: "vendor", entityId: 1, entityName: "Acme" },
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

// --- Toast: collected so we can assert that the recovery path does NOT
// fall through to the generic error toast (the banner replaces it).
const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn, toasts: [] }),
  toast: toastFn,
}));

// --- queryClient: the recovery path calls `refetchQueries` with the
// affected list's query key. Spy on it so the test can assert that the
// page actually re-fetches the right list (sites vs. work-types) when
// the server emits the structured code.
const { invalidateQueriesMock, refetchQueriesMock } = vi.hoisted(() => ({
  invalidateQueriesMock: vi.fn(),
  refetchQueriesMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
      refetchQueries: refetchQueriesMock,
    }),
  };
});

// --- Generated API client. Two sites and two work types so the test can
// observe the *selection-pruning* behavior — after the server rejects
// site/work-type IDs that we just submitted, the form must clear those
// fields. The query-key helpers are stubbed with stable sentinels so
// the test can assert which list was refetched.
const { createTicketMock } = vi.hoisted(() => ({ createTicketMock: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListTickets: () => ({ data: [], isLoading: false }),
  useCreateTicket: () => ({ mutateAsync: createTicketMock }),
  useListSiteLocations: () => ({
    data: [
      { id: 1, name: "Site A" },
      { id: 2, name: "Site B" },
    ],
  }),
  useListWorkTypes: () => ({
    data: [
      { id: 1, name: "Inspection" },
      { id: 2, name: "Maintenance" },
    ],
  }),
  useListFieldEmployees: () => ({
    data: [
      {
        id: 10,
        vendorId: 1,
        firstName: "John",
        lastName: "Doe",
        userId: 100,
      },
    ],
  }),
  useListVendors: () => ({ data: undefined }),
  useGetTicketGpsLogs: () => ({ data: undefined }),
  // Task #589: phone-intake work-type dropdown is now scoped to the
  // operator's vendor approvals at the chosen site. The dropdown reads
  // those approvals from `useGetSiteLocation(...).assignments`, so the
  // mock must return an assignment row for vendor 1 + work types 1 and
  // 2 — otherwise the select renders zero options and `fireEvent.change`
  // on the work-type select can't pick `"1"` or `"2"` in this test.
  useGetSiteLocation: () => ({
    data: {
      assignments: [
        { vendorId: 1, workTypeId: 1 },
        { vendorId: 1, workTypeId: 2 },
      ],
    },
  }),
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  getListTicketsQueryKey: () => ["tickets"],
  getListVendorsQueryKey: () => ["vendors"],
  getGetTicketGpsLogsQueryKey: () => ["gps-logs"],
  getGetSiteLocationQueryKey: () => ["site-location"],
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
  // Stable sentinels so refetch assertions don't depend on the real
  // query-key shape — the contract under test is "the page asked
  // React Query to refetch *this* list", not the URL string itself.
  getListSiteLocationsQueryKey: () => ["site-locations"],
  getListWorkTypesQueryKey: () => ["work-types"],
  useReverseFundsDispersal: () => ({ mutate: () => {}, isPending: false }),
    getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  }));

// --- Heavy / DOM-hostile components mocked to harmless stubs. The map
// pulls in leaflet (window globals); we don't render any tickets in
// this test anyway so the preview never matters.
vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));

// Radix Dialog: a minimal pass-through that respects `open` and forwards
// trigger clicks. Avoids portal/animation gymnastics in jsdom while
// preserving the contract Tickets relies on (open/close + asChild).
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

// Radix Select: replaced with a controlled native <select> so the test
// can pick site / work type with a single fireEvent.change. Mirrors the
// stub in tickets.phone-intake-foreman-error.test.tsx.
vi.mock("@/components/ui/select", () => {
  type ItemEntry = { value: string; label: React.ReactNode };

  const TRIGGER = Symbol.for("mock-select-trigger");
  const CONTENT = Symbol.for("mock-select-content");
  const ITEM = Symbol.for("mock-select-item");

  function findTriggerProps(
    children: React.ReactNode,
  ): Record<string, unknown> {
    let out: Record<string, unknown> = {};
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const tag = (child.type as { __role?: symbol })?.__role;
      if (tag === TRIGGER) {
        const { children: _ignored, ...rest } = child.props as Record<
          string,
          unknown
        > & { children?: React.ReactNode };
        out = rest;
      }
    });
    return out;
  }

  function findItems(children: React.ReactNode): ItemEntry[] {
    const items: ItemEntry[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const tag = (child.type as { __role?: symbol })?.__role;
      if (tag !== CONTENT) return;
      React.Children.forEach(
        (child.props as { children?: React.ReactNode }).children,
        (item) => {
          if (!React.isValidElement(item)) return;
          const itemTag = (item.type as { __role?: symbol })?.__role;
          if (itemTag !== ITEM) return;
          const props = item.props as { value: string; children: React.ReactNode };
          items.push({ value: props.value, label: props.children });
        },
      );
    });
    return items;
  }

  const Select = ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => {
    const triggerProps = findTriggerProps(children);
    const items = findItems(children);
    return (
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...triggerProps}
      >
        <option value="" />
        {items.map((it, idx) => {
          const label =
            typeof it.label === "string" || typeof it.label === "number"
              ? String(it.label)
              : React.Children.toArray(it.label)
                  .map((c) =>
                    typeof c === "string" || typeof c === "number"
                      ? String(c)
                      : "",
                  )
                  .join("")
                  .trim() || it.value;
          return (
            <option key={idx} value={it.value}>
              {label}
            </option>
          );
        })}
      </select>
    );
  };

  const SelectTrigger: React.FC<Record<string, unknown>> & {
    __role?: symbol;
  } = () => null;
  SelectTrigger.__role = TRIGGER;

  const SelectContent: React.FC<{ children?: React.ReactNode }> & {
    __role?: symbol;
  } = () => null;
  SelectContent.__role = CONTENT;

  const SelectItem: React.FC<{ value: string; children?: React.ReactNode }> & {
    __role?: symbol;
  } = () => null;
  SelectItem.__role = ITEM;

  const SelectValue: React.FC<{ placeholder?: string }> = () => null;
  const SelectGroup: React.FC<{ children?: React.ReactNode }> = ({
    children,
  }) => <>{children}</>;

  return {
    Select,
    SelectGroup,
    SelectValue,
    SelectTrigger,
    SelectContent,
    SelectItem,
  };
});

// Radix RadioGroup: native radios. Default caller type is "partner" so
// the foreman picker doesn't render — keeps these tests focused on the
// site / work-type recovery paths.
vi.mock("@/components/ui/radio-group", () => {
  const RGCtx = React.createContext<{
    value?: string;
    onValueChange?: (v: string) => void;
  } | null>(null);

  const RadioGroup = ({
    value,
    onValueChange,
    children,
    className,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: React.ReactNode;
    className?: string;
  }) => (
    <RGCtx.Provider value={{ value, onValueChange }}>
      <div role="radiogroup" className={className}>
        {children}
      </div>
    </RGCtx.Provider>
  );

  const RadioGroupItem = ({
    value,
    ...rest
  }: { value: string } & Record<string, unknown>) => {
    const ctx = React.useContext(RGCtx);
    return (
      <input
        type="radio"
        value={value}
        checked={ctx?.value === value}
        onChange={() => ctx?.onValueChange?.(value)}
        {...rest}
      />
    );
  };

  return { RadioGroup, RadioGroupItem };
});

import { render, screen } from "@testing-library/react";
import Tickets from "./tickets";


it("removes phone intake from the vendor office ticket page", () => {
  render(<Tickets />);
  expect(screen.queryByTestId("button-phone-intake")).toBeNull();
  expect(screen.queryByTestId("button-submit-phone-intake")).toBeNull();
  expect(createTicketMock).not.toHaveBeenCalled();
});
