import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// === Module mocks (must be hoisted before importing the component) ===

// useAuth — only the user object is read transitively (via the eligible
// employees hook); a minimal admin user keeps the helper from
// short-circuiting to an empty list.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { userId: 1, role: "admin", vendorId: null, partnerId: null },
    isLoading: false,
  }),
}));

// useToast — capture every toast() call so the suite can assert that the
// chip-remove path NEVER opens one (the whole point of Task #586 is that
// non-conflict failures pin a per-chip inline error and conflict codes
// silently refresh, with no toast in either case). `vi.hoisted` is
// required because vi.mock factories run before module-top consts.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }),
  toast: toastSpy,
}));

// PillBg renders an <img>; stub it so jsdom doesn't try to load the asset.
vi.mock("@/components/pill-bg", () => ({
  default: () => null,
}));

vi.mock("@/lib/pill-palette-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pill-palette-assets")>();
  return { ...actual, pillBlue: "blue-pill.png" };
});

// Mutable handlers seeded per test. `data` lets us swap roster snapshots
// between calls so a "silent refresh" assertion can show the chip
// vanishing on the next GET, mirroring CrewTimeSection.test.tsx.
type RosterEntry = {
  id: number;
  ticketId: number;
  employeeId: number;
  employeeName: string | null;
  vendorRole: string | null;
  addedAt: string;
};
type FieldEmployee = {
  id: number;
  vendorId: number;
  firstName: string;
  lastName: string;
  isActive?: boolean | null;
};

const handlers = {
  roster: [] as RosterEntry[],
  rosterCallCount: 0,
  removeRoster: async (_employeeId: number): Promise<unknown> => null,
};

function resetHandlers(initial?: {
  roster?: RosterEntry[];
  removeRoster?: (employeeId: number) => Promise<unknown>;
}) {
  handlers.roster = initial?.roster ?? [];
  handlers.rosterCallCount = 0;
  handlers.removeRoster = initial?.removeRoster ?? (async () => null);
}

vi.mock("@workspace/api-client-react", async () => {
  // Use the real react-query so the silent-refresh assertion can ride a
  // real invalidate -> refetch cycle. The roster mock's queryFn always
  // returns the latest `handlers.roster`, so swapping it inside a test
  // (`handlers.roster = ...filter(...)`) shows up after invalidate.
  const { useQuery: rqUseQuery } = await import("@tanstack/react-query");
  return {
    useGetCrewSessions: () => ({ data: [] }),
    useGetLaborSummary: () => ({ data: undefined }),
    useGetCrewRoster: (id: number, _opts?: unknown) => {
      handlers.rosterCallCount += 1;
      return rqUseQuery({
        queryKey: ["crew-roster", id],
        queryFn: async () => handlers.roster,
        // The component's onRemove handler explicitly invalidates this
        // query on success / state-conflict; staleTime: 0 ensures the
        // invalidate triggers a refetch instead of returning stale.
        staleTime: 0,
      });
    },
    // Mutation hook — spawn a tiny mutateAsync that defers to the test's
    // current `removeRoster` handler. Rejecting it triggers the
    // try/catch + inline-error path under test.
    useRemoveCrewRosterEntry: () => ({
      isPending: false,
      mutateAsync: ({ employeeId }: { id: number; employeeId: number }) =>
        handlers.removeRoster(employeeId),
    }),
    useAddCrewRosterEntry: () => ({
      isPending: false,
      mutateAsync: async () => null,
    }),
    useCrewCheckIn: () => ({ isPending: false, mutateAsync: async () => null }),
    useCrewCheckOut: () => ({
      isPending: false,
      mutateAsync: async () => null,
    }),
    useCorrectCrewSession: () => ({
      isPending: false,
      mutateAsync: async () => null,
    }),
    useGenerateLaborLineItems: () => ({
      isPending: false,
      mutateAsync: async () => null,
    }),
    // Stable query keys — the component just hands them back to react-query.
    getGetCrewSessionsQueryKey: (id: number) => ["crew-sessions", id],
    getGetLaborSummaryQueryKey: (id: number) => ["labor-summary", id],
    getGetTicketLineItemsQueryKey: (id: number) => ["ticket-line-items", id],
    getGetCrewRosterQueryKey: (id: number) => ["crew-roster", id],
  };
});

// useEligibleVendorFieldEmployees — return a small eligible list so the
// "Crew on Site" section + add-pill render. The chip remove path doesn't
// depend on this list at all, but the component reads it unconditionally.
const eligibleEmployees: FieldEmployee[] = [
  { id: 200, vendorId: 7, firstName: "Carol", lastName: "Foreman", isActive: true },
  { id: 201, vendorId: 7, firstName: "Dave", lastName: "Worker", isActive: true },
];
vi.mock("@/hooks/use-eligible-vendor-field-employees", () => ({
  useEligibleVendorFieldEmployees: () => ({
    fieldEmployees: eligibleEmployees,
    eligibleForemen: eligibleEmployees,
  }),
  useEligibleVendorFieldEmployeesByVendorId: () => ({
    fieldEmployees: eligibleEmployees,
    eligibleForemen: eligibleEmployees,
  }),
  useClearStaleFieldEmployeeSelection: () => {},
}));

import { CrewTimeSection } from "./crew-time-section";

// ── Helpers ────────────────────────────────────────────────────────────

const rosterEntries: RosterEntry[] = [
  {
    id: 9001,
    ticketId: 42,
    employeeId: 200,
    employeeName: "Carol Foreman",
    vendorRole: "Foreman",
    addedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 9002,
    ticketId: 42,
    employeeId: 201,
    employeeName: "Dave Worker",
    vendorRole: "Worker",
    addedAt: "2026-01-01T00:00:00Z",
  },
];

function makeApiError(opts: {
  message?: string;
  status?: number;
  code?: string;
  data?: Record<string, unknown> | null;
}): Error {
  const err = new Error(opts.message ?? "x") as Error & {
    status?: number;
    code?: string;
    data?: unknown;
  };
  if (opts.status != null) err.status = opts.status;
  if (opts.code != null) err.code = opts.code;
  if (opts.data !== undefined) err.data = opts.data;
  return err;
}

function renderSection() {
  // A fresh QueryClient per render so invalidateQueries calls (silent
  // refresh path) don't bleed between tests.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CrewTimeSection
        ticketId={42}
        vendorId={7}
        canEdit={true}
        canEditRoster={true}
      />
    </QueryClientProvider>,
  );
}

// Look up the × remove button inside a specific chip. The chip exposes
// its remove control via aria-label "Remove from roster" (en.json's
// crewTime.removeFromRoster), matching the mobile test's lookup.
async function findRemoveButtonForChip(
  employeeId: number,
): Promise<HTMLElement> {
  const chip = await screen.findByTestId(`chip-crew-${employeeId}`);
  const removes = within(chip).getAllByLabelText("Remove from roster");
  return removes[0];
}

beforeEach(() => {
  toastSpy.mockReset();
  resetHandlers();
});

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("CrewTimeSection — roster-remove inline error (Task #586)", () => {
  it("pins a per-chip inline error when the server rejects the DELETE with a non-conflict code", async () => {
    resetHandlers({
      roster: rosterEntries,
      removeRoster: (empId) => {
        // ticket.not_editable is NOT in ROSTER_REMOVE_STATE_CONFLICT_CODES,
        // so the failure should land inline under the chip the foreman
        // tapped — and stay there (no silent refresh, no toast). Mirror
        // of CrewTimeSection.test.tsx (mobile, Task #571).
        if (empId !== 201) {
          return Promise.reject(
            makeApiError({ message: "unexpected employee id", status: 500 }),
          );
        }
        return Promise.reject(
          makeApiError({
            message: "Ticket is not editable",
            status: 409,
            code: "ticket.not_editable",
            data: { code: "ticket.not_editable" },
          }),
        );
      },
    });

    renderSection();

    const removeBtn = await findRemoveButtonForChip(201);
    fireEvent.click(removeBtn);

    // The inline error renders at the per-chip testID, scoped to the
    // employee whose × button was tapped — not under the other chip.
    const inline = await screen.findByTestId("inline-error-roster-remove-201");
    // With real i18n, code: ticket.not_editable resolves via
    // errors.ticket.not_editable in en.json.
    expect(inline.textContent).toBe("This ticket can no longer be edited.");
    expect(
      screen.queryByTestId("inline-error-roster-remove-200"),
    ).toBeNull();

    // Both chips should still be present — the failed DELETE must not
    // optimistically remove the chip from the roster.
    expect(screen.getByTestId("chip-crew-201")).toBeTruthy();
    expect(screen.getByTestId("chip-crew-200")).toBeTruthy();

    // The whole point of mirroring the mobile Task #561 swap: no toast
    // from this path. The crewTime.failed toast must stay un-fired.
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("silently refreshes the roster (no inline error, chip removed) when the server returns crew.not_on_roster", async () => {
    let deleteCount = 0;
    resetHandlers({
      roster: rosterEntries,
      removeRoster: (empId) => {
        deleteCount += 1;
        // Model "another device already removed Dave": after the DELETE
        // rejects with the state-conflict code, the very next refresh
        // must return a roster without him so the chip disappears
        // (mirrors the mobile case — Task #561).
        handlers.roster = rosterEntries.filter((r) => r.employeeId !== empId);
        return Promise.reject(
          makeApiError({
            message: "Crew member not on roster",
            status: 404,
            code: "crew.not_on_roster",
          }),
        );
      },
    });

    renderSection();

    const removeBtn = await findRemoveButtonForChip(201);
    fireEvent.click(removeBtn);

    // The DELETE should be issued exactly once, and the silent refresh
    // should drop Dave's chip without ever pinning a stale error under it.
    await waitFor(() => {
      expect(deleteCount).toBe(1);
      expect(screen.queryByTestId("chip-crew-201")).toBeNull();
    });
    expect(
      screen.queryByTestId("inline-error-roster-remove-201"),
    ).toBeNull();

    // Carol is unaffected — only the rejected employee's chip vanishes.
    expect(screen.getByTestId("chip-crew-200")).toBeTruthy();

    // No toast ever fires from the roster-remove path, even when the
    // state-conflict branch runs and the chip silently disappears.
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("clears the inline error on the next successful DELETE for the same chip", async () => {
    // Belt-and-braces (mirrors the mobile suite): a prior failure pinned
    // a message under a chip; the foreman taps × again and the server
    // now accepts the DELETE. The chip + its inline error should both
    // disappear after the refresh.
    let attempt = 0;
    resetHandlers({
      roster: rosterEntries,
      removeRoster: (empId) => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(
            makeApiError({
              message: "Ticket is not editable",
              status: 409,
              code: "ticket.not_editable",
              data: { code: "ticket.not_editable" },
            }),
          );
        }
        // Second attempt succeeds; the refresh that follows should see
        // a roster without the just-removed employee.
        handlers.roster = rosterEntries.filter((r) => r.employeeId !== empId);
        return Promise.resolve(undefined);
      },
    });

    renderSection();

    fireEvent.click(await findRemoveButtonForChip(201));
    await screen.findByTestId("inline-error-roster-remove-201");

    fireEvent.click(await findRemoveButtonForChip(201));

    await waitFor(() => {
      expect(screen.queryByTestId("chip-crew-201")).toBeNull();
    });
    expect(
      screen.queryByTestId("inline-error-roster-remove-201"),
    ).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
