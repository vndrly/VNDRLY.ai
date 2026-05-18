import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { render, screen, fireEvent } from "@testing-library/react";
import Tickets from "./tickets";

// Open the phone-intake dialog and fill in the minimum fields the
// submit-disabled guard requires before the server call can fire. The
// caller type stays at the default ("partner") so the foreman picker
// doesn't render.
function openDialogAndFill(): {
  site: HTMLSelectElement;
  workType: HTMLSelectElement;
} {
  fireEvent.click(screen.getByTestId("button-phone-intake"));
  fireEvent.change(screen.getByTestId("input-caller-name"), {
    target: { value: "Operator" },
  });
  const site = screen.getByTestId("select-phone-site") as HTMLSelectElement;
  fireEvent.change(site, { target: { value: "1" } });
  const workType = screen.getByTestId(
    "select-phone-work-type",
  ) as HTMLSelectElement;
  fireEvent.change(workType, { target: { value: "1" } });
  return { site, workType };
}

beforeEach(() => {
  createTicketMock.mockReset();
  toastFn.mockReset();
  invalidateQueriesMock.mockReset();
  refetchQueriesMock.mockReset();
  refetchQueriesMock.mockResolvedValue(undefined);
});

describe("phone intake — site_not_found auto-recovery (Task #573)", () => {
  it("re-fetches the site list, prunes the selection, and surfaces the banner", async () => {
    // Reject the way the generated client's customFetch does: an Error
    // with a parsed `data` body containing the machine code.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "site_not_found" },
    });

    render(<Tickets />);
    const { site, workType } = openDialogAndFill();
    expect(site.value).toBe("1");
    expect(workType.value).toBe("1");

    // No banner before the submit fails.
    expect(screen.queryByTestId("phone-site-unavailable-banner")).toBeNull();

    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    // Wait for the rejected mutation's catch handler to run + the
    // recovery branch to flush its state updates.
    const banner = await screen.findByTestId(
      "phone-site-unavailable-banner",
    );
    expect(banner.textContent ?? "").toMatch(/no longer available/i);

    // The page must have asked React Query to refetch the *site list*
    // specifically — using the stubbed query-key sentinel from the
    // mocked api-client-react above.
    expect(refetchQueriesMock).toHaveBeenCalledTimes(1);
    expect(refetchQueriesMock).toHaveBeenCalledWith({
      queryKey: ["site-locations"],
    });

    // The just-submitted site (and dependent work type, which is
    // scoped to a site) must be cleared so the operator is forced to
    // re-pick from the refreshed list.
    expect(
      (screen.getByTestId("select-phone-site") as HTMLSelectElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("select-phone-work-type") as HTMLSelectElement)
        .value,
    ).toBe("");

    // The generic "Failed to create…" toast must NOT fire — the banner
    // is the whole point of the recovery path.
    expect(toastFn).not.toHaveBeenCalled();

    // The legacy inline error under the picker must NOT render — the
    // banner replaces it for this case (otherwise the operator gets
    // both messages competing for attention).
    expect(screen.queryByTestId("error-phone-site")).toBeNull();
  });

  it("dismisses the banner once the operator picks a site from the refreshed list", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "site_not_found" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    await screen.findByTestId("phone-site-unavailable-banner");

    // Pick a different site from the refreshed list. The dialog's
    // onValueChange is wired to clear the banner.
    fireEvent.change(screen.getByTestId("select-phone-site"), {
      target: { value: "2" },
    });

    expect(
      screen.queryByTestId("phone-site-unavailable-banner"),
    ).toBeNull();
  });
});

describe("phone intake — work_type_not_allowed auto-recovery (Task #573)", () => {
  it("re-fetches the work-type list, prunes the selection, and surfaces the banner", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "work_type_not_allowed" },
    });

    render(<Tickets />);
    const { site, workType } = openDialogAndFill();

    // No banner before the submit fails.
    expect(
      screen.queryByTestId("phone-work-type-unavailable-banner"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    const banner = await screen.findByTestId(
      "phone-work-type-unavailable-banner",
    );
    expect(banner.textContent ?? "").toMatch(/no longer approved/i);

    // The page must have asked React Query to refetch the *work-type*
    // list — not the site list. This guards against accidentally
    // wiring up the wrong refetch (which would still appear to "work"
    // because both lists exist on the page).
    expect(refetchQueriesMock).toHaveBeenCalledTimes(1);
    expect(refetchQueriesMock).toHaveBeenCalledWith({
      queryKey: ["work-types"],
    });

    // The site selection must survive — only the work type is invalid
    // for this (site, vendor, work_type) combination, so leaving the
    // site picked saves the operator a click.
    expect(
      (screen.getByTestId("select-phone-site") as HTMLSelectElement).value,
    ).toBe("1");
    expect(site.value).toBe("1");
    // The just-submitted work type must be cleared — the server told
    // us that combo isn't allowed.
    expect(
      (screen.getByTestId("select-phone-work-type") as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(workType.value).toBe("");

    // No fallback toast and no inline red text — the banner is the
    // single source of truth for this code.
    expect(toastFn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("error-phone-work-type")).toBeNull();
  });

  it("dismisses the banner once the operator picks a work type from the refreshed list", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "work_type_not_allowed" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    await screen.findByTestId("phone-work-type-unavailable-banner");

    // Picking any work type — even the same id we tried before —
    // should dismiss the banner. The server will redo its check and
    // surface a fresh error if the combo is still bad.
    fireEvent.change(screen.getByTestId("select-phone-work-type"), {
      target: { value: "2" },
    });

    expect(
      screen.queryByTestId("phone-work-type-unavailable-banner"),
    ).toBeNull();
  });

  it("still falls back to the generic toast for unrelated failures (regression guard)", async () => {
    // A non-recovery error code (e.g. server 500 / internal_error)
    // must NOT light up either auto-recovery banner — they're scoped
    // to the two structured codes the server explicitly emits.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "internal_error" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    // Give the rejected mutation a tick to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId("phone-site-unavailable-banner")).toBeNull();
    expect(
      screen.queryByTestId("phone-work-type-unavailable-banner"),
    ).toBeNull();
    expect(refetchQueriesMock).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledTimes(1);
  });
});
