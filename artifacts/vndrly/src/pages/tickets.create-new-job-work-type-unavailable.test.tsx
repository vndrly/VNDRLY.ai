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
// tickets.phone-intake-work-type-unavailable.test.tsx (Task #573).
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
// the catch handler refreshed the *work-types* query — the whole point
// of Task #871's friendly refresh behavior on the Create New Job dialog.
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

// --- Generated API client. The work-type-unavailable test only cares
// about the create-ticket mutation outcome and the work-types query key
// helper, but the Tickets page imports several other hooks that all
// need stubbing so the page mounts. `useGetSiteLocation` returns an
// `assignments` array so the Create New Job dialog's siteScopedWorkTypes
// memo produces a non-empty list of checkboxes the operator can tick.
const { createTicketMock, workTypesQueryKey } = vi.hoisted(() => ({
  createTicketMock: vi.fn(),
  workTypesQueryKey: ["work-types-list-key"],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListTickets: () => ({ data: [], isLoading: false }),
  useCreateTicket: () => ({ mutateAsync: createTicketMock }),
  useListSiteLocations: () => ({
    data: [{ id: 1, name: "Site One" }],
  }),
  useListWorkTypes: () => ({
    data: [
      { id: 1, name: "Inspection" },
      { id: 2, name: "Repair" },
    ],
  }),
  useListFieldEmployees: () => ({ data: [] }),
  useListVendors: () => ({ data: undefined }),
  useGetTicketGpsLogs: () => ({ data: undefined }),
  // For the Create New Job dialog's `siteScopedWorkTypes` to include the
  // work types we listed above, the selected site's detail payload must
  // expose an assignment for each (vendorId=1, workTypeId=N) combo.
  useGetSiteLocation: () => ({
    data: {
      id: 1,
      assignments: [
        { vendorId: 1, workTypeId: 1 },
        { vendorId: 1, workTypeId: 2 },
      ],
    },
  }),
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  useReverseFundsDispersal: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
  }),
  getListTicketsQueryKey: () => ["tickets"],
  getListVendorsQueryKey: () => ["vendors"],
  getListSiteLocationsQueryKey: () => ["sites"],
  getListWorkTypesQueryKey: () => workTypesQueryKey,
  getGetTicketGpsLogsQueryKey: () => ["gps-logs"],
  getGetTicketQueryKey: () => ["ticket"],
  getGetSiteLocationQueryKey: () => ["site-location"],
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
  getTicket: vi.fn(),
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

function openDialogAndPickSite() {
  fireEvent.click(screen.getByTestId("button-start-new-ticket"));
  fireEvent.change(screen.getByTestId("select-site"), {
    target: { value: "1" },
  });
}

// The Create New Job dialog wires `data-testid="checkbox-work-type-N"`
// on the wrapping <label>, not the inner <input> (the Checkbox UI
// component owns its own internals). Reach the input through the
// label so we can assert on `.checked` instead of label-level props
// that don't exist.
function workTypeInput(id: number): HTMLInputElement {
  const label = screen.getByTestId(`checkbox-work-type-${id}`);
  const input = label.querySelector("input");
  if (!input) {
    throw new Error(`work-type checkbox input ${id} not found in label`);
  }
  return input as HTMLInputElement;
}

beforeEach(() => {
  createTicketMock.mockReset();
  toastFn.mockReset();
  invalidateQueriesMock.mockReset();
  refetchQueriesMock.mockReset();
  refetchQueriesMock.mockResolvedValue(undefined);
});

describe("create new job — work_type_not_allowed friendly refresh (Task #871)", () => {
  it("refreshes the work-types list, clears the checkboxes, and shows the friendly banner", async () => {
    // Reject the way the generated client's customFetch does: an Error
    // (or error-shaped object) with a parsed `data` body containing
    // the machine code. With a single work type ticked, the dialog
    // fires one POST and a single rejection mirrors the realistic
    // "work type pulled from the site mid-flow" scenario.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "work_type_not_allowed" },
    });

    render(<Tickets />);
    openDialogAndPickSite();
    fireEvent.click(screen.getByTestId("checkbox-work-type-1"));

    // Sanity: no banner is showing before the failed POST, and the
    // checkbox holds the selection the operator made.
    expect(
      screen.queryByTestId("add-work-type-unavailable-banner"),
    ).toBeNull();
    expect(workTypeInput(1).checked).toBe(true);

    fireEvent.click(screen.getByTestId("button-submit-ticket"));

    // The catch handler should:
    //   - refetch the work-types list query (the friendly refresh)
    //   - drop the now-invalid work-type checkbox state
    //   - render the banner explaining what happened
    const banner = await screen.findByTestId(
      "add-work-type-unavailable-banner",
    );
    expect(banner.textContent ?? "").toMatch(/no longer approved/i);

    // The refresh fired against the *work-types* query key — not just
    // any refetch call would do. We assert the key matches the
    // helper's return value (mocked to a sentinel array above).
    const workTypesRefetchCalls = refetchQueriesMock.mock.calls.filter(
      ([arg]) =>
        arg &&
        typeof arg === "object" &&
        Array.isArray((arg as { queryKey?: unknown[] }).queryKey) &&
        (arg as { queryKey: unknown[] }).queryKey[0] === "work-types-list-key",
    );
    expect(workTypesRefetchCalls.length).toBe(1);

    // Stale work-type selection cleared.
    expect(workTypeInput(1).checked).toBe(false);

    // The site is still picked — only the work types are stale, so
    // the operator only has to re-tick a still-approved work type.
    expect(
      (screen.getByTestId("select-site") as HTMLSelectElement).value,
    ).toBe("1");

    // Submit stays disabled because no work type is selected, so the
    // operator can't immediately re-fire the same broken request.
    expect(
      (screen.getByTestId("button-submit-ticket") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // The generic "Failed to create…" toast must NOT fire — the
    // banner is the whole point of #871.
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("dismisses the banner once the operator picks a work type from the refreshed list", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "work_type_not_allowed" },
    });

    render(<Tickets />);
    openDialogAndPickSite();
    fireEvent.click(screen.getByTestId("checkbox-work-type-1"));
    fireEvent.click(screen.getByTestId("button-submit-ticket"));

    await screen.findByTestId("add-work-type-unavailable-banner");

    // Tick a different work type from the (now refreshed) list. The
    // dialog's onCheckedChange clears the banner so the operator
    // gets a clean slate to resubmit.
    fireEvent.click(screen.getByTestId("checkbox-work-type-2"));

    expect(
      screen.queryByTestId("add-work-type-unavailable-banner"),
    ).toBeNull();
  });

  it("falls back to the generic toast for unrelated failures (regression guard)", async () => {
    // A non-work-type error code (e.g. an internal 5xx) must NOT
    // trigger the friendly refresh — that would mislead the operator
    // into thinking the work-type list was the problem.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "internal_error" },
    });

    render(<Tickets />);
    openDialogAndPickSite();
    fireEvent.click(screen.getByTestId("checkbox-work-type-1"));
    fireEvent.click(screen.getByTestId("button-submit-ticket"));

    // Give the rejected mutation a tick to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(
      screen.queryByTestId("add-work-type-unavailable-banner"),
    ).toBeNull();
    expect(toastFn).toHaveBeenCalledTimes(1);
    // The work-type checkbox keeps its tick — we didn't clear anything.
    expect(workTypeInput(1).checked).toBe(true);
  });
});
