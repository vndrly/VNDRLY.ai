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

// --- Auth: a vendor-office operator. Required because the phone-intake
// trigger only renders for `isVendorOffice` (Task #498) — a plain
// vendor user wouldn't see the "Phone intake" button in the toolbar.
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

// --- Toast: collected so we can assert that *non-foreman* failures still
// fall through to the generic error toast (the inline error path is the
// happy case for this test). Hoisted so the mock factories below can
// reference it — vi.mock is itself hoisted above all top-level code.
const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn, toasts: [] }),
  toast: toastFn,
}));

// --- queryClient: the page invalidates the ticket list on success; the
// mocked failure path never reaches that, but the hook still has to
// return *something* with `invalidateQueries` callable.
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

// --- Generated API client. Every hook the Tickets page imports has to
// be stubbed because the real ones build a live React Query subscription
// against the running Express server, which doesn't exist in jsdom.
const { createTicketMock } = vi.hoisted(() => ({ createTicketMock: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListTickets: () => ({ data: [], isLoading: false }),
  useCreateTicket: () => ({ mutateAsync: createTicketMock }),
  useListSiteLocations: () => ({
    data: [{ id: 1, name: "Site A" }],
  }),
  useListWorkTypes: () => ({
    data: [{ id: 1, name: "Inspection" }],
  }),
  // Two foremen on the operator's vendor — we need at least two so the
  // "switch foreman clears the error" assertion can pick a *different*
  // value than the one that originally failed.
  useListFieldEmployees: () => ({
    data: [
      {
        id: 10,
        vendorId: 1,
        firstName: "John",
        lastName: "Doe",
        userId: 100,
      },
      {
        id: 11,
        vendorId: 1,
        firstName: "Jane",
        lastName: "Roe",
        userId: 101,
      },
    ],
  }),
  useListVendors: () => ({ data: undefined }),
  useGetTicketGpsLogs: () => ({ data: undefined }),
  // Task #589: phone-intake work-type dropdown is now filtered to the
  // operator's vendor approvals at the chosen site, read from this
  // hook's `assignments`. The foreman-error test picks site 1 +
  // workType 1 with vendor 1, so we mirror that here.
  useGetSiteLocation: () => ({
    data: {
      assignments: [{ vendorId: 1, workTypeId: 1 }],
    },
  }),
  // The shared Dialog overlay also pulls partner/vendor for the auto
  // logo; we mock the dialog wholesale below, but the Tickets module
  // re-exports of these query-key helpers still have to be present so
  // the import statement at the top of tickets.tsx resolves.
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  getListTicketsQueryKey: () => ["tickets"],
  getListVendorsQueryKey: () => ["vendors"],
  getGetTicketGpsLogsQueryKey: () => ["gps-logs"],
  getGetSiteLocationQueryKey: () => ["site-location"],
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
  useReverseFundsDispersal: () => ({ mutate: () => {}, isPending: false }),
    getGetTicketNoteLogsQueryKey: (id: number) => ["ticket-note-logs", id],
  }));

// --- Heavy / DOM-hostile components mocked to harmless stubs. The map
// pulls in leaflet (window globals), and we don't render any tickets
// in this test anyway so the preview never matters.
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
// can pick a foreman with a single fireEvent.change. Radix Select's
// PointerEvent / portal semantics don't survive jsdom cleanly, and the
// behavior under test here lives in the *consumer* — the dialog's
// state machine — not in Radix itself.
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
              : // Foreman options render `{firstName} {lastName}` as a JSX
                // fragment; flatten that to a deterministic string so the
                // <option> has a usable display value in jsdom.
                React.Children.toArray(it.label)
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

// Radix RadioGroup: native radios. The test needs to switch caller type
// from "partner" (default) to "field_employee" so the foreman picker
// renders — Radix's roving-focus / pointer-event handling makes that
// fragile in jsdom and doesn't add coverage value here.
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
// submit-disabled guard requires before the server call can fire.
function openDialogAndFill(): HTMLSelectElement {
  fireEvent.click(screen.getByTestId("button-phone-intake"));

  // Switch caller to "field_employee" so the foreman picker renders.
  fireEvent.click(screen.getByTestId("radio-caller-field-employee"));

  fireEvent.change(screen.getByTestId("input-caller-name"), {
    target: { value: "John Doe" },
  });
  // The mocked Select forwards the trigger's data-testid onto the
  // native <select>, so the same testids the production component uses
  // still resolve here.
  fireEvent.change(screen.getByTestId("select-phone-site"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByTestId("select-phone-work-type"), {
    target: { value: "1" },
  });
  const foreman = screen.getByTestId(
    "select-phone-foreman",
  ) as HTMLSelectElement;
  fireEvent.change(foreman, { target: { value: "10" } });
  return foreman;
}

beforeEach(() => {
  createTicketMock.mockReset();
  toastFn.mockReset();
});

describe("phone intake — foreman validation error UI (Task #509)", () => {
  it("surfaces the inline foreman-vendor-mismatch error and disables submit", async () => {
    // Reject the way the generated client's customFetch does: an Error
    // with a parsed `data` body containing the machine code.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "foreman_vendor_mismatch" },
    });

    render(<Tickets />);
    openDialogAndFill();

    const submit = screen.getByTestId(
      "button-submit-phone-intake",
    ) as HTMLButtonElement;
    // Sanity check: with all fields filled and no error yet, the
    // submit guard is satisfied.
    expect(submit.disabled).toBe(false);
    // No error rendered before the failed POST.
    expect(screen.queryByTestId("error-phone-foreman")).toBeNull();

    fireEvent.click(submit);

    // Wait for the rejected mutation's catch handler to run.
    const error = await screen.findByTestId("error-phone-foreman");
    expect(error.textContent).toMatch(/different vendor/i);

    // Task #509 contract: the submit button stays locked until the
    // operator picks a different foreman. This prevents the obvious
    // double-submit footgun where retrying with the same foreman would
    // just re-trigger the same 400.
    expect(
      (screen.getByTestId("button-submit-phone-intake") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // The generic "Failed to create…" toast must NOT fire — the inline
    // error is the whole point of #509.
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("clears the inline error and re-enables submit when a different foreman is picked", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "foreman_vendor_mismatch" },
    });

    render(<Tickets />);
    const foreman = openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    await screen.findByTestId("error-phone-foreman");
    expect(
      (screen.getByTestId("button-submit-phone-intake") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Pick the *other* foreman from the eligible set. The dialog's
    // onValueChange is wired to clear `phoneForemanError`, which both
    // hides the inline message and unlocks submit.
    fireEvent.change(foreman, { target: { value: "11" } });

    expect(screen.queryByTestId("error-phone-foreman")).toBeNull();
    expect(
      (screen.getByTestId("button-submit-phone-intake") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows a distinct message for foreman_field_employee_mismatch", async () => {
    createTicketMock.mockRejectedValueOnce({
      data: { error: "foreman_field_employee_mismatch" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    const error = await screen.findByTestId("error-phone-foreman");
    // The two error codes must surface different copy — otherwise the
    // operator can't tell *why* the server rejected their pick. The
    // vendor-mismatch copy talks about "different vendor"; the
    // field-employee-mismatch copy talks about "assigned field
    // employee". Asserting on the latter keyword guards against a
    // future i18n refactor accidentally collapsing the two messages.
    expect(error.textContent).toMatch(/assigned field employee/i);
    expect(error.textContent).not.toMatch(/different vendor/i);
  });

  it("falls back to the generic toast for unrelated failures (regression guard)", async () => {
    // A non-foreman error code (e.g. the server returned 500 / a
    // connectivity error) must NOT light up the inline foreman error —
    // that would mislead the operator into thinking the picker is bad.
    createTicketMock.mockRejectedValueOnce({
      data: { error: "internal_error" },
    });

    render(<Tickets />);
    openDialogAndFill();
    fireEvent.click(screen.getByTestId("button-submit-phone-intake"));

    // Give the rejected mutation a tick to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId("error-phone-foreman")).toBeNull();
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId("button-submit-phone-intake") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
