import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// === Module mocks (must be hoisted before importing the component) ===

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    primaryForeground: "#fff",
    accent: "#fef3c7",
    accentForeground: "#92400e",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  initApi: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

// Task #524: CrewTimeSection now calls `useFocusEffect` from expo-router
// to re-pull the vendor crew list when the screen regains focus, so the
// foreman doesn't keep seeing workers the office just deactivated. The
// component test never navigates between screens, so we treat the screen
// as always focused and run the effect via React.useEffect using the
// same hook contract the other ticket-detail tests use (Task #615).
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));

// AmberButton renders as a plain DOM <button> so we don't have to load
// its `require()`-based image assets. Mirrors VisitorHostPicker.test.tsx.
vi.mock("@/components/AmberButton", async () => {
  const ReactLib = (await import("react")).default;
  return {
    default: ({
      children,
      onPress,
      disabled,
      loading,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
      testID?: string;
    }) => {
      const isDisabled = !!(disabled || loading);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": testID,
          "aria-disabled": isDisabled || undefined,
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onPress,
        },
        typeof children === "string" ? children : "btn",
      );
    },
  };
});

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alert } from "react-native";

import CrewTimeSection from "./CrewTimeSection";

// ── Helpers ────────────────────────────────────────────────────────────

type RouteHandlers = {
  sessions: Array<{
    id: number;
    ticketId: number;
    employeeId: number;
    employeeName: string | null;
    checkInAt: string;
    checkOutAt: string | null;
    source: string;
  }>;
  roster: Array<{
    id: number;
    ticketId: number;
    employeeId: number;
    employeeName: string | null;
    vendorRole: string | null;
    addedAt: string;
  }>;
  crew: Array<{
    id: number;
    firstName: string;
    lastName: string;
    vendorId: number;
    vendorRole?: string | null;
    isActive?: boolean | null;
  }>;
  // Per-employee mutation override. Returning a thrown Error rejects
  // the promise; returning anything else resolves with that value.
  checkIn: (empId: number) => Promise<unknown>;
  checkOut: (empId: number) => Promise<unknown>;
  // Task #571: per-employee DELETE /crew-roster/<empId> override. Same
  // contract as checkIn / checkOut — throw to reject, return to resolve.
  rosterDelete: (empId: number) => Promise<unknown>;
};

let handlers: RouteHandlers;
let sessionsCallCount = 0;

function configureApi(initial?: Partial<RouteHandlers>) {
  handlers = {
    sessions: [],
    roster: [],
    crew: [],
    checkIn: async () => null,
    checkOut: async () => null,
    rosterDelete: async () => null,
    ...initial,
  };
  sessionsCallCount = 0;
  apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (method === "GET") {
      if (url.endsWith("/crew-sessions")) {
        sessionsCallCount += 1;
        return Promise.resolve(handlers.sessions);
      }
      if (url.endsWith("/labor-summary")) {
        return Promise.resolve({
          totals: { totalHours: 0, totalCost: 0, overtimeHours: 0 },
          people: [],
        });
      }
      if (url.endsWith("/crew-roster")) return Promise.resolve(handlers.roster);
      if (url.startsWith("/api/field-employees")) {
        return Promise.resolve(handlers.crew);
      }
    }
    if (method === "POST") {
      const checkInMatch = url.match(/\/crew\/(\d+)\/check-in$/);
      if (checkInMatch) return handlers.checkIn(Number(checkInMatch[1]));
      const checkOutMatch = url.match(/\/crew\/(\d+)\/check-out$/);
      if (checkOutMatch) return handlers.checkOut(Number(checkOutMatch[1]));
    }
    if (method === "DELETE") {
      // Task #571: roster-remove flow lives at DELETE /api/tickets/<id>/crew-roster/<empId>.
      const rosterDeleteMatch = url.match(/\/crew-roster\/(\d+)$/);
      if (rosterDeleteMatch) {
        return handlers.rosterDelete(Number(rosterDeleteMatch[1]));
      }
    }
    return Promise.resolve(null);
  });
}

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

const defaultCrew = [
  { id: 100, firstName: "Alice", lastName: "Aaron", vendorId: 7, isActive: true },
  { id: 101, firstName: "Bob", lastName: "Brown", vendorId: 7, isActive: true },
];

// Task #571: roster fixtures used by the chip-remove tests. Distinct from
// `defaultCrew` so the two test suites don't accidentally share state via
// employee IDs — but both live under the same default vendor (7) /
// ticket (42) used by `renderSection()`.
const rosterCrew = [
  { id: 200, firstName: "Carol", lastName: "Foreman", vendorId: 7, vendorRole: "Foreman", isActive: true },
  { id: 201, firstName: "Dave", lastName: "Worker", vendorId: 7, vendorRole: "Worker", isActive: true },
];

const rosterEntries = [
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

function renderSection(
  overrides: Partial<React.ComponentProps<typeof CrewTimeSection>> = {},
) {
  const props: React.ComponentProps<typeof CrewTimeSection> = {
    ticketId: 42,
    vendorId: 7,
    isForeman: true,
    canEdit: true,
    canEditRoster: true,
    colors: {
      background: "#fff",
      foreground: "#000",
      card: "#f5f5f5",
      border: "#ccc",
      primary: "#f59e0b",
      primaryForeground: "#fff",
      accent: "#fef3c7",
      accentForeground: "#92400e",
      mutedForeground: "#666",
      destructive: "#dc2626",
      // Cast — useColors() returns several extras the component doesn't
      // touch, so we only declare what the section reads.
    } as unknown as import("@/hooks/useColors").AppColors,
    ...overrides,
  };
  return render(<CrewTimeSection {...props} />);
}

// react-native-web's <Pressable>/<TouchableOpacity> uses the React Native
// responder system; pointerdown + pointerup mirrors a real tap. Plain
// <button> shims (e.g. the mocked AmberButton) react to a normal click.
function tap(el: HTMLElement): void {
  if (el.tagName === "BUTTON") {
    fireEvent.click(el);
    return;
  }
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

// Tap the per-row In/Out control for a specific crew member. The
// foreman view renders one row per crew member with a stable
// `button-crew-toggle-<id>` testID on the TouchableOpacity, so tests
// can reach it without walking the DOM from the visible label.
function tapInOutForCrewId(employeeId: number): void {
  tap(firstByTestId(`button-crew-toggle-${employeeId}`));
}

// Wait for the foreman crew rows to render — they only appear once
// /api/field-employees has resolved. Anchoring on the per-row testID
// keeps every test synced to the same "ready to interact" point.
async function waitForCrewLoaded(employeeId = 100) {
  await screen.findByTestId(`button-crew-toggle-${employeeId}`);
}

// react-native-web sometimes propagates `data-testid` to a wrapper as well
// as the underlying element. Pick the first match (the outer node) so
// `within()` scopes to the whole subtree.
function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

// Locate the × remove TouchableOpacity inside a CrewChip for a given
// employee. The chip exposes its remove button via accessibilityLabel —
// react-native-web maps that to aria-label, and with real i18n that label
// resolves to the English copy "Remove from roster".
async function findRemoveButtonForChip(
  employeeId: number,
): Promise<HTMLElement> {
  await screen.findByTestId(`chip-crew-${employeeId}`);
  const chip = firstByTestId(`chip-crew-${employeeId}`);
  const all = within(chip).getAllByLabelText("Remove from roster");
  return all[0];
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    compatibilityJSON: "v4",
    interpolation: { escapeValue: false },
    resources: { en: { translation: en } },
    react: { useSuspense: false },
  });
});

beforeEach(() => {
  apiFetchMock.mockReset();
  alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  alertSpy.mockRestore();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("CrewTimeSection — inline error wiring (Task #546)", () => {
  it("pins a single check-in failure under the failed row instead of popping a modal alert", async () => {
    configureApi({
      crew: defaultCrew,
      checkIn: (empId) => {
        return Promise.reject(
          makeApiError({
            message: "Already checked in",
            status: 409,
            data: { code: "crew.already_checked_in" },
          }),
        );
      },
    });

    renderSection();
    await waitForCrewLoaded();

    tapInOutForCrewId(100);

    const inlineError = await screen.findByTestId("inline-error-crew-100");
    expect(inlineError.textContent).toBe(
      "That employee is already checked in to this ticket.",
    );

    // The modal Alert.alert path is only used by the roster-remove flow.
    // The crew check-in/out path must NOT fall back to it (Task #546).
    expect(alertSpy).not.toHaveBeenCalled();

    // The picker error slot must stay empty — membership errors go there;
    // a vanilla "already checked in" code stays on the row.
    expect(screen.queryByTestId("inline-error-crew-picker")).toBeNull();

    // Sanity: no bulk summary errors leaked from the per-row failure.
    expect(screen.queryByTestId("inline-error-check-in-all")).toBeNull();
    expect(screen.queryByTestId("inline-error-check-out-all")).toBeNull();
  });

  it("clears a stale row error and refreshes when the server returns ticket_state_changed", async () => {
    let attempt = 0;
    configureApi({
      crew: defaultCrew,
      checkIn: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(
            makeApiError({
              message: "Already checked in",
              status: 409,
              data: { code: "crew.already_checked_in" },
            }),
          );
        }
        // Second attempt returns a state-conflict code. The component
        // should silently re-fetch and clear the prior row error rather
        // than pin a stale message under a button that may disappear.
        return Promise.reject(
          makeApiError({
            message: "Ticket state changed",
            status: 409,
            data: { code: "ticket_state_changed" },
          }),
        );
      },
    });

    renderSection();
    await waitForCrewLoaded();

    // Mount + initial refresh = 1 GET to /crew-sessions. Capture that as
    // the baseline so we can assert the state-conflict path forced
    // another refresh.
    await waitFor(() => expect(sessionsCallCount).toBe(1));
    const baseline = sessionsCallCount;

    // First click — pins a row error.
    tapInOutForCrewId(100);
    const firstErr = await screen.findByTestId("inline-error-crew-100");
    expect(firstErr.textContent).toBe(
      "That employee is already checked in to this ticket.",
    );

    // Second click — server now returns ticket_state_changed. Row error
    // must clear and a refresh GET to /crew-sessions must fire.
    tapInOutForCrewId(100);
    await waitFor(() => {
      expect(screen.queryByTestId("inline-error-crew-100")).toBeNull();
    });
    expect(sessionsCallCount).toBeGreaterThan(baseline);
    // Still no modal alert from the state-conflict path.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("surfaces membership errors immediately above the foreman view (Task #578)", async () => {
    configureApi({
      crew: defaultCrew,
      checkIn: () =>
        Promise.reject(
          makeApiError({
            message: "Foreman field employee mismatch",
            status: 400,
            // Membership codes (foreman_*_mismatch, field_employee_vendor_mismatch,
            // crew_invalid_for_vendor, foreman_not_in_crew) re-route to
            // the picker error slot — but the picker is closed by
            // default, so Task #578 also pins the message in a visible
            // banner above the foreman view.
            data: { code: "foreman_field_employee_mismatch" },
          }),
        ),
    });

    renderSection();
    await waitForCrewLoaded();

    tapInOutForCrewId(100);

    // Task #578: the foreman must see the membership error right away,
    // without having to open the picker. It lives in a dedicated
    // visible banner above the foreman view.
    const banner = await screen.findByTestId(
      "inline-error-foreman-membership",
    );
    expect(banner.textContent).toBe(
      "The foreman must match the assigned field employee.",
    );

    // The per-row error slot stays empty — the membership re-routing
    // clears any prior row error and stashes the message in the
    // membership banner / picker slot instead.
    expect(screen.queryByTestId("inline-error-crew-100")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();

    // While the picker is closed, the message lives in the banner only;
    // react-native-web returns null for closed Modals, so the picker
    // slot can't be queried yet.
    expect(screen.queryByTestId("inline-error-crew-picker")).toBeNull();

    // The existing inline-error-crew-picker slot keeps working when
    // the foreman opens the picker manually — the same pickerError
    // value now renders inside the modal too. The banner hides while
    // the picker is open so the message isn't duplicated.
    const addBtn = screen.getByTestId("button-add-crew-roster");
    tap(addBtn);

    const pickerError = await screen.findByTestId("inline-error-crew-picker");
    expect(pickerError.textContent).toBe(
      "The foreman must match the assigned field employee.",
    );
    expect(
      screen.queryByTestId("inline-error-foreman-membership"),
    ).toBeNull();
  });

  it("opens the crew picker when the membership banner is tapped, with the message preserved across the open transition (Task #873)", async () => {
    // Task #873: the membership banner above the foreman view used to be
    // plain text — the foreman had to scroll up to "Crew on Site" and tap
    // "Add crew member" to fix the selection. The banner is now a
    // Pressable that opens the same picker and keeps the membership
    // message pinned inside it, closing that loop in one tap.
    configureApi({
      crew: defaultCrew,
      checkIn: () =>
        Promise.reject(
          makeApiError({
            message: "Foreman not in crew",
            status: 400,
            data: { code: "foreman_not_in_crew" },
          }),
        ),
    });

    renderSection();
    await waitForCrewLoaded();

    tapInOutForCrewId(100);

    // The banner appears with the localized membership message and the
    // explicit "Open crew picker" affordance is rendered alongside it
    // (the testID we tap lives on the wrapping Pressable).
    const banner = await screen.findByTestId("inline-error-foreman-membership");
    expect(banner.textContent).toBe(
      "The foreman must be one of the assigned crew members.",
    );

    // Tap the banner — the picker should open and the same message
    // should be pinned inside it. The banner itself unmounts because
    // the Modal is no longer closed (so the duplicate is avoided).
    const trigger = screen.getByTestId(
      "button-foreman-membership-open-picker",
    );
    // The trigger carries the same accessibilityLabel as the in-modal
    // affordance ("Open crew picker"), matching the a11y treatment on
    // the chip × and per-row In/Out controls.
    expect(trigger.getAttribute("aria-label")).toBe("Open crew picker");
    tap(trigger);

    const pickerError = await screen.findByTestId("inline-error-crew-picker");
    expect(pickerError.textContent).toBe(
      "The foreman must be one of the assigned crew members.",
    );
    expect(
      screen.queryByTestId("inline-error-foreman-membership"),
    ).toBeNull();

    // No modal Alert is fired from this path — the membership re-route
    // is the entire UX, both in the banner and in the picker.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("clears the membership banner when a subsequent In/Out succeeds", async () => {
    // Task #578: a stale membership banner should disappear once the
    // server stops returning a membership code. The simplest model is
    // that retrying the same row clears the banner before the request
    // is fired and never re-pins it on a non-membership outcome.
    let attempt = 0;
    configureApi({
      crew: defaultCrew,
      checkIn: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(
            makeApiError({
              message: "Foreman not in crew",
              status: 400,
              data: { code: "foreman_not_in_crew" },
            }),
          );
        }
        return Promise.resolve(null);
      },
    });

    renderSection();
    await waitForCrewLoaded();

    tapInOutForCrewId(100);

    // Banner appears after the first (failing) tap.
    await screen.findByTestId("inline-error-foreman-membership");

    // Second tap succeeds — banner must clear.
    tapInOutForCrewId(100);

    await waitFor(() => {
      expect(
        screen.queryByTestId("inline-error-foreman-membership"),
      ).toBeNull();
    });
  });

  it("renders a per-button summary count under 'check in all' when bulk check-ins fail", async () => {
    configureApi({
      crew: defaultCrew,
      // Both crew members are NOT yet checked in (sessions is empty), so
      // checkInAll iterates over both and posts to each /check-in. Both
      // reject with a non-state-conflict code so they count toward the
      // summary. State-conflict failures are excluded from the count by
      // design (the refresh covers them).
      checkIn: () =>
        Promise.reject(
          makeApiError({
            message: "Already checked in",
            status: 409,
            data: { code: "crew.already_checked_in" },
          }),
        ),
    });

    renderSection();
    await waitForCrewLoaded();

    // The "Check in all" AmberButton exposes a stable `button-check-in-all`
    // testID, so tests can reach it without depending on the visible label
    // (which would break on copy tweaks or wording changes).
    const checkInAllBtn = screen.getByTestId("button-check-in-all");
    tap(checkInAllBtn);

    const summary = await screen.findByTestId("inline-error-check-in-all");
    // Both crew (Alice + Bob) failed with a non-state-conflict code, so
    // the summary count must be 2.
    expect(summary.textContent).toBe(
      "2 crew member(s) could not be checked in. Please try again.",
    );
    // Per-row errors must NOT also be set for the bulk failure — the
    // bulk path collects the count into the summary slot.
    expect(screen.queryByTestId("inline-error-crew-100")).toBeNull();
    expect(screen.queryByTestId("inline-error-crew-101")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("renders a per-button summary count under 'check out all' when bulk check-outs fail", async () => {
    // Two open sessions so openIds = {100, 101} and the "check out all"
    // control is rendered (it only appears when openIds.size > 0).
    const openSession = (employeeId: number) => ({
      id: employeeId,
      ticketId: 42,
      employeeId,
      employeeName: null,
      checkInAt: new Date(Date.now() - 60_000).toISOString(),
      checkOutAt: null,
      source: "manual",
    });
    configureApi({
      crew: defaultCrew,
      sessions: [openSession(100), openSession(101)],
      checkOut: () =>
        Promise.reject(
          makeApiError({
            message: "No open check-in",
            status: 409,
            data: { code: "crew.no_open_check_in" },
          }),
        ),
    });

    renderSection();
    await waitForCrewLoaded();

    // The "still checked in" warn area's "Check out all" TouchableOpacity
    // exposes a stable `button-check-out-all` testID, so tests can reach
    // it without walking the DOM up from the visible label.
    const checkOutAllBtn = await screen.findByTestId("button-check-out-all");
    tap(checkOutAllBtn);

    const summary = await screen.findByTestId("inline-error-check-out-all");
    expect(summary.textContent).toBe(
      "2 crew member(s) could not be checked out. Please try again.",
    );
    expect(screen.queryByTestId("inline-error-crew-100")).toBeNull();
    expect(screen.queryByTestId("inline-error-crew-101")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("on a partial-failure 'check in all', shows the per-button summary AND flips state for the successful members", async () => {
    // Task #546: the bulk path's per-button summary must reflect only the
    // crew that actually failed (state-conflict failures are excluded).
    // The crew member that *did* succeed must still flip state, since
    // checkInAll calls refresh() after collecting the results.
    //
    // Setup: both crew members start un-checked-in (sessions empty), so
    // openIds is empty and checkInAll iterates over both. Alice (100)
    // succeeds — handlers.sessions is mutated so the follow-up refresh
    // returns her as an open session. Bob (101) fails with a
    // non-state-conflict code so he counts toward the summary.
    configureApi({
      crew: defaultCrew,
      checkIn: (empId) => {
        if (empId === 100) {
          handlers.sessions = [
            ...handlers.sessions,
            {
              id: 1,
              ticketId: 42,
              employeeId: 100,
              employeeName: "Alice Aaron",
              checkInAt: new Date().toISOString(),
              checkOutAt: null,
              source: "manual",
            },
          ];
          return Promise.resolve(null);
        }
        return Promise.reject(
          makeApiError({
            message: "Already checked in",
            status: 409,
            data: { code: "crew.already_checked_in" },
          }),
        );
      },
    });

    renderSection();
    await waitForCrewLoaded();

    tap(screen.getByTestId("button-check-in-all"));

    const summary = await screen.findByTestId("inline-error-check-in-all");
    // Only Bob failed with a real (non-state-conflict) code, so the
    // summary count must be 1 — not 2.
    expect(summary.textContent).toBe(
      "1 crew member(s) could not be checked in. Please try again.",
    );

    // Alice's row must reflect her flipped state: her toggle button now
    // reads "Out" (because she's currently checked in). Bob's row stays
    // on "In" since his check-in failed.
    await waitFor(() => {
      expect(firstByTestId("button-crew-toggle-100").textContent).toBe("Out");
    });
    expect(firstByTestId("button-crew-toggle-101").textContent).toBe("In");

    // Per-row error slots stay empty — the bulk path collects everything
    // into the summary slot, never the per-row slots.
    expect(screen.queryByTestId("inline-error-crew-100")).toBeNull();
    expect(screen.queryByTestId("inline-error-crew-101")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("on a partial-failure 'check out all', shows the per-button summary AND flips state for the successful members", async () => {
    // Mirror of the check-in case but for the bulk check-out path. Both
    // crew members start with open sessions; Alice's check-out succeeds
    // (her open session is closed in handlers.sessions so the refresh
    // sees the new state) and Bob's fails with a non-state-conflict code.
    const aliceSession = {
      id: 100,
      ticketId: 42,
      employeeId: 100,
      employeeName: "Alice Aaron",
      checkInAt: new Date(Date.now() - 60_000).toISOString(),
      checkOutAt: null as string | null,
      source: "manual",
    };
    const bobSession = {
      id: 101,
      ticketId: 42,
      employeeId: 101,
      employeeName: "Bob Brown",
      checkInAt: new Date(Date.now() - 60_000).toISOString(),
      checkOutAt: null as string | null,
      source: "manual",
    };
    configureApi({
      crew: defaultCrew,
      sessions: [aliceSession, bobSession],
      checkOut: (empId) => {
        if (empId === 100) {
          handlers.sessions = handlers.sessions.map((s) =>
            s.employeeId === 100
              ? { ...s, checkOutAt: new Date().toISOString() }
              : s,
          );
          return Promise.resolve(null);
        }
        return Promise.reject(
          makeApiError({
            message: "No open check-in",
            status: 409,
            data: { code: "crew.no_open_check_in" },
          }),
        );
      },
    });

    renderSection();
    await waitForCrewLoaded();

    const checkOutAllBtn = await screen.findByTestId("button-check-out-all");
    tap(checkOutAllBtn);

    const summary = await screen.findByTestId("inline-error-check-out-all");
    // Only Bob failed with a real (non-state-conflict) code; the summary
    // count must be 1, even though the bulk loop hit 2 employees.
    expect(summary.textContent).toBe(
      "1 crew member(s) could not be checked out. Please try again.",
    );

    // Alice's row must reflect her flipped state — her toggle button
    // now reads "In" because she's no longer checked in. Bob's row
    // stays on "Out" because his open session was not closed.
    await waitFor(() => {
      expect(firstByTestId("button-crew-toggle-100").textContent).toBe("In");
    });
    expect(firstByTestId("button-crew-toggle-101").textContent).toBe("Out");

    expect(screen.queryByTestId("inline-error-crew-100")).toBeNull();
    expect(screen.queryByTestId("inline-error-crew-101")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("CrewTimeSection — roster-remove inline error (Task #571)", () => {
  it("pins a per-chip inline error when the server rejects the DELETE with a non-conflict code", async () => {
    configureApi({
      crew: rosterCrew,
      roster: rosterEntries,
      rosterDelete: (empId) => {
        // ticket.not_editable is NOT in STATE_CONFLICT_CODES, so the error
        // should land inline under the chip the foreman tapped — and stay
        // there (no silent refresh).
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
    tap(removeBtn);

    // The inline error renders at the per-chip testID, scoped to the
    // employee whose × button was tapped — not under the other chip.
    const inline = await screen.findByTestId("inline-error-roster-remove-201");
    // With real i18n, `code: ticket.not_editable` resolves via
    // errors.ticket.not_editable in en.json.
    expect(inline.textContent).toBe("This ticket can no longer be edited.");
    expect(
      screen.queryByTestId("inline-error-roster-remove-200"),
    ).toBeNull();

    // Both chips should still be present — the failed DELETE must not
    // optimistically remove the chip from the roster.
    expect(screen.getByTestId("chip-crew-201")).toBeTruthy();
    expect(screen.getByTestId("chip-crew-200")).toBeTruthy();

    // The whole point of the Task #561 swap: no Alert.alert from this path.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("silently refreshes the roster (no inline error, chip removed) when the server returns crew.not_on_roster", async () => {
    let deleteCount = 0;
    configureApi({
      crew: rosterCrew,
      roster: rosterEntries,
      rosterDelete: (empId) => {
        deleteCount += 1;
        // Model "another device already removed Dave": after the DELETE
        // rejects with the state-conflict code, the very next refresh
        // must return a roster without him so the chip disappears.
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
    tap(removeBtn);

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

    // No Alert.alert ever fires from the roster-remove path, even when
    // the state-conflict branch runs.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("clears the inline error on the next successful DELETE for the same chip", async () => {
    // Belt-and-braces: a prior failure pinned a message under a chip; the
    // foreman taps × again and the server now accepts the DELETE. The
    // chip + its inline error should both disappear after the refresh.
    let attempt = 0;
    configureApi({
      crew: rosterCrew,
      roster: rosterEntries,
      rosterDelete: (empId) => {
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
        // Second attempt succeeds; the refresh that follows should see a
        // roster without the just-removed employee.
        handlers.roster = rosterEntries.filter((r) => r.employeeId !== empId);
        return Promise.resolve(undefined);
      },
    });

    renderSection();

    const firstRemoveBtn = await findRemoveButtonForChip(201);
    tap(firstRemoveBtn);

    await screen.findByTestId("inline-error-roster-remove-201");

    const secondRemoveBtn = await findRemoveButtonForChip(201);
    tap(secondRemoveBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("chip-crew-201")).toBeNull();
    });
    expect(
      screen.queryByTestId("inline-error-roster-remove-201"),
    ).toBeNull();
  });
});

describe("CrewTimeSection — refresh on deactivation (Task #524)", () => {
  it("re-fetches the vendor crew list on the 60s sync tick so a worker the office deactivated mid-shift drops out without remount", async () => {
    // Initial load returns Alice + Bob; on the next /api/field-employees
    // poll the office has deactivated Bob, so only Alice comes back.
    // Without the Task #524 sync-tick crew refresh, Bob would stay in
    // the foreman's in/out roster until the screen was unmounted.
    let crewCallCount = 0;
    configureApi({ crew: defaultCrew });
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") {
        if (url.endsWith("/crew-sessions")) {
          sessionsCallCount += 1;
          return Promise.resolve(handlers.sessions);
        }
        if (url.endsWith("/labor-summary")) {
          return Promise.resolve({
            totals: { totalHours: 0, totalCost: 0, overtimeHours: 0 },
            people: [],
          });
        }
        if (url.endsWith("/crew-roster")) return Promise.resolve(handlers.roster);
        if (url.startsWith("/api/field-employees")) {
          crewCallCount += 1;
          // First fetch: Alice + Bob. Subsequent fetches: office
          // deactivated Bob, so only Alice remains active.
          if (crewCallCount === 1) return Promise.resolve(handlers.crew);
          return Promise.resolve(
            handlers.crew.filter((e) => e.id !== 101),
          );
        }
      }
      return Promise.resolve(null);
    });

    // Drive the 60s setInterval directly — fake timers let us advance
    // virtual time without a 60-second real-world wait. Tracking
    // pending Promises (the apiFetch resolutions queued by the tick)
    // requires running microtasks between advances, hence the await
    // Promise.resolve() pumps below.
    vi.useFakeTimers();
    try {
      renderSection();
      // Initial mount kicks off the first /api/field-employees fetch;
      // wait for Bob to render before advancing time so we know the
      // baseline state is correct.
      await vi.waitFor(() => {
        expect(screen.queryByText("Bob Brown")).not.toBeNull();
      });

      // Advance to the first 60s sync tick. The interval fires both
      // `refresh()` (sessions / summary / roster) and `refreshCrew()`
      // (vendor crew list) — only the latter changes here.
      await vi.advanceTimersByTimeAsync(60_000);

      await vi.waitFor(() => {
        expect(screen.queryByText("Bob Brown")).toBeNull();
      });
      // Alice (still active) must remain on the foreman's roster.
      expect(screen.queryByText("Alice Aaron")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins the localized crew.employee_inactive message under the row when a single check-in fails because the office just deactivated the worker", async () => {
    // The foreman taps In on Bob just after the office deactivates him.
    // The server replies 409 crew.employee_inactive. We must pin the
    // localized copy under Bob's row (NOT show a modal Alert, NOT use
    // the generic "Could not check in" fallback). The row itself is
    // intentionally NOT pruned here — the next 60s sync tick / focus
    // refresh handles that, after the foreman has read the message.
    configureApi({
      crew: defaultCrew,
      checkIn: (empId) => {
        if (empId === 101) {
          return Promise.reject(
            makeApiError({
              message: "That crew member is no longer active",
              status: 409,
              data: { code: "crew.employee_inactive" },
            }),
          );
        }
        return Promise.resolve(null);
      },
    });

    renderSection();
    await waitForCrewLoaded();
    expect(screen.queryByText("Bob Brown")).not.toBeNull();

    tapInOutForCrewId(101);

    // The inline error must be pinned under Bob's row with the
    // localized copy from errors.crew.employee_inactive.
    const inline = await screen.findByTestId("inline-error-crew-101");
    expect(inline.textContent).toBe(
      "That crew member was just deactivated by the office. Refresh and pick someone else.",
    );

    // No modal Alert — the row-level inline error is the entire UX.
    expect(alertSpy).not.toHaveBeenCalled();

    // Bob's row stays mounted so the foreman can actually read the
    // message; the 60s sync / focus refresh prunes him later.
    expect(screen.queryByText("Bob Brown")).not.toBeNull();
  });
});
