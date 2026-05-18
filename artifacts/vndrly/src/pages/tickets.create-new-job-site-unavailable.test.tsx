import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// jsdom doesn't ship ResizeObserver, but several Radix primitives the
// Tickets page mounts reach for it via `react-use-size`. A no-op
// polyfill keeps the page mountable without dragging in a heavier shim.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// --- Auth: a plain vendor user. The "Create New Job" dialog (the one
// gated by `isVendor || isPartner`) is the surface we're exercising —
// the phone-intake banner already has its own coverage in
// tickets.phone-intake-site-unavailable.test.tsx (Task #559).
const vendorUser = {
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
    user: vendorUser,
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

// --- queryClient: hoist a refetch spy so the test can assert that
// the catch handler refreshed the *sites* query — the whole point of
// Task #574's friendly refresh behavior on the Create New Job dialog.
// invalidateQueries is also exercised here because the success/failure
// paths invalidate the tickets list regardless.
const { refetchQueriesMock, invalidateQueriesMock } = vi.hoisted(() => ({
  refetchQueriesMock: vi.fn().mockResolvedValue(undefined),
  invalidateQueriesMock: vi.fn(),
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

// --- Generated API client. The site-unavailable test only cares about
// the create-ticket mutation outcome and the sites-list query key
// helper, but the Tickets page imports several other hooks that all
// need stubbing so the page mounts. `useGetSiteLocation` returns an
// `assignments` array so the Create New Job dialog's siteScopedWorkTypes
// memo produces a non-empty list of checkboxes the operator can tick.
const { createTicketMock, sitesQueryKey } = vi.hoisted(() => ({
  createTicketMock: vi.fn(),
  sitesQueryKey: ["sites-list-key"],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListTickets: () => ({ data: [], isLoading: false }),
  useCreateTicket: () => ({ mutateAsync: createTicketMock }),
  useListSiteLocations: () => ({
    data: [
      { id: 1, name: "Stale Site" },
      { id: 2, name: "Live Site" },
    ],
  }),
  useListWorkTypes: () => ({
    data: [{ id: 1, name: "Inspection" }],
  }),
  useListFieldEmployees: () => ({ data: [] }),
  useListVendors: () => ({ data: undefined }),
  useGetTicketGpsLogs: () => ({ data: undefined }),
  // For the Create New Job dialog's `siteScopedWorkTypes` to include any
  // work types, the selected site's detail payload must list at least
  // one (vendorId, workTypeId) assignment. We return one for every site
  // id the dialog might query — the lookup is keyed by id internally
  // (queryKey enables on selectedSiteIdNum > 0) but the mock just
  // returns a fixed shape regardless of arg.
  useGetSiteLocation: () => ({
    data: { id: 1, assignments: [{ vendorId: 1, workTypeId: 1 }] },
  }),
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  getListTicketsQueryKey: () => ["tickets"],
  getListVendorsQueryKey: () => ["vendors"],
  getListSiteLocationsQueryKey: () => sitesQueryKey,
  getListWorkTypesQueryKey: () => ["work-types"],
  getGetTicketGpsLogsQueryKey: () => ["gps-logs"],
  getGetTicketQueryKey: () => ["ticket"],
  getGetSiteLocationQueryKey: () => ["site-location"],
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
  getTicket: vi.fn(),
  useReverseFundsDispersal: () => ({ mutate: () => {}, isPending: false }),
    getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  }));

// Heavy / DOM-hostile components mocked to harmless stubs.
vi.mock("@/components/ticket-route-map", () => ({
  TicketRouteMap: () => null,
}));

// Radix Dialog: a minimal pass-through that respects `open` and
// forwards trigger clicks. Avoids portal/animation gymnastics in jsdom
// while preserving the open/close contract Tickets relies on.
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

// Radix Select replaced with a controlled native <select> so the test
// can change values with a single fireEvent.change.
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

// The Create New Job dialog uses Radix Checkbox for its work-type
// multi-select. Replace with a controlled native checkbox so the test
// can flip a work type on with a single fireEvent.click.
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
  } & Record<string, unknown>) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onCheckedChange?.((e.target as HTMLInputElement).checked)}
      {...rest}
    />
  ),
}));

// Radix RadioGroup: native radios. Not actually used by the Create New
// Job dialog (only the phone-intake one), but the page mounts both so
// the radio primitive must render without crashing.
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

import { render, screen, fireEvent } from "@testing-library/react";
import Tickets from "./tickets";

function openDialogAndFill() {
  fireEvent.click(screen.getByTestId("button-start-new-ticket"));
  fireEvent.change(screen.getByTestId("select-site"), {
    target: { value: "1" },
  });
  // Tick the lone work-type checkbox so the form has a non-empty
  // workTypeIds array and the submit button is enabled.
  fireEvent.click(screen.getByTestId("checkbox-work-type-1"));
}

beforeEach(() => {
  createTicketMock.mockReset();
  toastFn.mockReset();
  invalidateQueriesMock.mockReset();
  refetchQueriesMock.mockReset();
  refetchQueriesMock.mockResolvedValue(undefined);
});

describe("create new job — site_not_found friendly refresh (Task #574)", () => {
  it("refreshes the site list, clears the selection, and shows the friendly banner", async () => {
    // Reject the way the generated client's customFetch does: an Error
    // (or error-shaped object) with a parsed `data` body containing
    // the machine code. The dialog fires one POST per selected work
    // type via Promise.allSettled — with a single work type ticked, a
    // single rejection mirrors the realistic "site deleted mid-flow"
    // scenario.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "site_not_found" },
    });

    render(<Tickets />);
    openDialogAndFill();

    // Sanity: no banner is showing before the failed POST, and the
    // site picker holds the selection the operator made.
    expect(screen.queryByTestId("add-site-unavailable-banner")).toBeNull();
    expect(
      (screen.getByTestId("select-site") as HTMLSelectElement).value,
    ).toBe("1");

    fireEvent.click(screen.getByTestId("button-submit-ticket"));

    // The catch handler should:
    //   - refetch the sites list query (the friendly refresh)
    //   - drop the now-invalid site selection AND its dependent
    //     work-type selection
    //   - render the banner explaining what happened
    const banner = await screen.findByTestId("add-site-unavailable-banner");
    expect(banner.textContent ?? "").toMatch(/no longer available/i);

    // The refresh fired against the *sites* query key — not just any
    // refetch call would do. We assert the key matches the helper's
    // return value (mocked to a sentinel array above).
    const sitesRefetchCalls = refetchQueriesMock.mock.calls.filter(
      ([arg]) =>
        arg &&
        typeof arg === "object" &&
        Array.isArray((arg as { queryKey?: unknown[] }).queryKey) &&
        (arg as { queryKey: unknown[] }).queryKey[0] === "sites-list-key",
    );
    expect(sitesRefetchCalls.length).toBe(1);

    // Stale selection cleared.
    expect(
      (screen.getByTestId("select-site") as HTMLSelectElement).value,
    ).toBe("");

    // Submit stays disabled because no site is selected, so the
    // operator can't immediately re-fire the same broken request.
    expect(
      (screen.getByTestId("button-submit-ticket") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // The generic "Failed to create…" toast must NOT fire — the
    // banner is the whole point of #574.
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("dismisses the banner once the operator picks a site from the refreshed list", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "site_not_found" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-ticket"));

    await screen.findByTestId("add-site-unavailable-banner");

    // Pick a different site from the (now refreshed) list. The
    // dialog's onValueChange clears the banner so the operator gets
    // a clean slate to resubmit.
    fireEvent.change(screen.getByTestId("select-site"), {
      target: { value: "2" },
    });

    expect(screen.queryByTestId("add-site-unavailable-banner")).toBeNull();
  });

  it("falls back to the generic toast for unrelated failures (regression guard)", async () => {
    // A non-site error code (e.g. an internal 5xx) must NOT trigger
    // the friendly refresh — that would mislead the operator into
    // thinking the site list was the problem.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "internal_error" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-ticket"));

    // Give the rejected mutation a tick to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId("add-site-unavailable-banner")).toBeNull();
    expect(toastFn).toHaveBeenCalledTimes(1);
    // The site picker keeps its selection — we didn't clear anything.
    expect(
      (screen.getByTestId("select-site") as HTMLSelectElement).value,
    ).toBe("1");
  });
});
