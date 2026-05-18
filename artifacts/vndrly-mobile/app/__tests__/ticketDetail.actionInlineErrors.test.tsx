import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Follow-up to Task #555: screen-level coverage for the En Route /
// Check In / Check Out buttons on the ticket detail screen, mirroring
// the close-for-review tests in `ticketDetail.closeForReview.test.tsx`.
// Each of these handlers funnels through the same `handleActionError`
// router introduced in Task #532, but until now the wiring on the
// non-close buttons had no screen-level guard. A regression that put
// any of these messages back into a popup `Alert.alert(...)` would
// silently ship — these tests assert, for each button, that:
//   1. A normal (non-state-conflict) server failure renders inline
//      under that button via `testID="inline-error-<field>"` and does
//      NOT raise an `Alert.alert(...)`.
//   2. A state-conflict response (e.g. `ticket_not_checkinable`,
//      `ticket_state_changed`, `ticket_en_route_invalid_state`) clears
//      any inline error and silently reloads the ticket, so a stale
//      message never sits under a control that may be about to vanish.

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
    muted: "#e5e5e5",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

vi.mock("expo-image", async () => {
  const ReactLib = (await import("react")).default;
  return { Image: () => ReactLib.createElement("img") };
});

vi.mock("expo-linear-gradient", async () => {
  const ReactLib = (await import("react")).default;
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement("div", null, children),
  };
});

const { routerReplaceMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: { replace: routerReplaceMock, push: vi.fn(), back: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "777" }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));

const {
  requestForegroundPermissionsAsyncMock,
  getCurrentPositionAsyncMock,
  getForegroundPermissionsAsyncMock,
  watchPositionAsyncMock,
} = vi.hoisted(() => ({
  requestForegroundPermissionsAsyncMock: vi.fn(),
  getCurrentPositionAsyncMock: vi.fn(),
  getForegroundPermissionsAsyncMock: vi.fn(),
  watchPositionAsyncMock: vi.fn(),
}));
vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: () => {} }),
}));

vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: (...a: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...a),
  getCurrentPositionAsync: (...a: unknown[]) =>
    getCurrentPositionAsyncMock(...a),
  getForegroundPermissionsAsync: (...a: unknown[]) =>
    getForegroundPermissionsAsyncMock(...a),
  watchPositionAsync: (...a: unknown[]) => watchPositionAsyncMock(...a),
}));

const tIdentity = (k: string) => (k.startsWith("errors.") ? `tx:${k}` : k);
const useTranslationReturn = { t: tIdentity };
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationReturn,
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "https://example.test",
  initApi: vi.fn(),
}));

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getUser: (...a: unknown[]) => getUserMock(...a),
  setUser: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@/lib/maps", () => ({
  MAP_TILE_SIZE: 256,
  getOsmTile: () => ({ url: "x", offsetX: 0, offsetY: 0 }),
  openInMaps: vi.fn(),
}));

vi.mock("@/lib/photos", () => ({
  captureAndUploadImage: vi.fn(async () => null),
}));

vi.mock("@workspace/db/format", () => ({
  formatTicketTrackingNumber: (id: number) => `T-${id}`,
}));

vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", () => ({ TicketRouteMap: () => null }));
vi.mock("@/components/TicketTrackingTimeline", () => ({
  TicketTrackingTimeline: () => null,
}));
vi.mock("@/components/CrewTimeSection", () => ({ default: () => null }));
vi.mock("@/components/CommentsPanel", () => ({ default: () => null }));
vi.mock("@/components/TicketStatusStepper", () => ({ default: () => null }));

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
      children?: React.ReactNode;
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
vi.mock("@/components/BlueButton", async () => {
  const ReactLib = (await import("react")).default;
  return {
    default: ({
      children,
      onPress,
      disabled,
      loading,
      testID,
    }: {
      children?: React.ReactNode;
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
vi.mock("@/components/GreyButton", async () => {
  const ReactLib = (await import("react")).default;
  return {
    default: ({
      children,
      onPress,
      disabled,
      loading,
      testID,
    }: {
      children?: React.ReactNode;
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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alert } from "react-native";

import TicketDetailScreen from "../ticket/[id]";

afterEach(() => {
  cleanup();
});

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Permissions denied → captureCoords() returns nulls and the geofence
  // watcher never subscribes, so neither path leaks side effects into
  // the tests below.
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  getForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  watchPositionAsyncMock.mockResolvedValue({ remove: vi.fn() });
  alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
});

const TICKET_ID = 777;

type TicketStub = {
  id: number;
  status: string;
  description: string | null;
  siteName: string | null;
  siteLocationId: number | null;
  state: string | null;
  workTypeName: string | null;
  partnerName: string | null;
  vendorId: number | null;
  lifecycleState: "pending_arrival" | "en_route" | "on_site" | "off_site" | null;
  arrivedAt: string | null;
  createdAt: string;
};

function makeTicket(overrides: Partial<TicketStub> = {}): TicketStub {
  return {
    id: TICKET_ID,
    status: "accepted",
    description: null,
    siteName: "Acme HQ",
    siteLocationId: null,
    state: null,
    workTypeName: "Maintenance",
    partnerName: "Acme Partner",
    vendorId: 11,
    lifecycleState: "pending_arrival",
    arrivedAt: null,
    createdAt: "2025-01-01T09:00:00Z",
    ...overrides,
  };
}

type ApiMockOverride = (
  url: string,
  init?: { method?: string; body?: string },
) => unknown | Promise<unknown> | undefined;

function setupApi(opts: {
  ticketByCall: (call: number) => TicketStub;
  override?: ApiMockOverride;
}) {
  let getCalls = 0;
  apiFetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      const overridden = opts.override?.(url, init);
      if (overridden !== undefined) return overridden;
      if (
        url === `/api/tickets/${TICKET_ID}` &&
        (!init || !init.method || init.method === "GET")
      ) {
        getCalls += 1;
        return Promise.resolve(opts.ticketByCall(getCalls));
      }
      if (url === `/api/tickets/${TICKET_ID}/line-items`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/note-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/unlocks`)
        return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected url ${url}`));
    },
  );
}

function makeApiError(init: {
  status: number;
  code?: string;
  message?: string;
}): Error {
  const err = new Error(
    init.message ?? `api error ${init.code ?? init.status}`,
  ) as Error & { status?: number; code?: string; data?: unknown };
  err.status = init.status;
  if (init.code !== undefined) err.code = init.code;
  err.data = init.code ? { error: init.code, code: init.code } : null;
  return err;
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

async function renderAndWaitForLoad() {
  const utils = render(<TicketDetailScreen />);
  await waitFor(() => {
    expect(firstByTestId("text-ticket-tracking-number")).toBeTruthy();
  });
  return utils;
}

async function waitForUserLoaded() {
  await waitFor(() => {
    expect(getUserMock).toHaveBeenCalled();
  });
  await Promise.resolve();
}

function getTicketGetCount(): number {
  return apiFetchMock.mock.calls.filter(
    ([url, init]) =>
      url === `/api/tickets/${TICKET_ID}` &&
      (!init ||
        !(init as { method?: string }).method ||
        (init as { method?: string }).method === "GET"),
  ).length;
}

const adminUser = {
  id: 1,
  username: "admin",
  role: "admin",
  displayName: "A",
};

// Each entry exercises one button. `ticket` controls which button is
// canonically visible (lifecycleState/status combos pulled from the
// gating logic in app/ticket/[id].tsx). `endpoint` is the POST that
// the button fires; we override that single endpoint per scenario to
// surface either a non-conflict failure or a state-conflict response.
const BUTTONS = [
  {
    label: "En Route",
    field: "en_route" as const,
    buttonTestId: "button-en-route",
    inlineErrorTestId: "inline-error-en_route",
    endpoint: `/api/tickets/${TICKET_ID}/en-route`,
    ticket: () =>
      makeTicket({ status: "accepted", lifecycleState: "pending_arrival" }),
    // ticket_en_route_invalid_state lives in STATE_CONFLICT_CODES.
    stateConflictCode: "ticket_en_route_invalid_state",
  },
  {
    label: "Check In",
    field: "check_in" as const,
    buttonTestId: "button-check-in",
    inlineErrorTestId: "inline-error-check_in",
    endpoint: `/api/tickets/${TICKET_ID}/check-in`,
    ticket: () =>
      makeTicket({ status: "accepted", lifecycleState: "on_site" }),
    // ticket_not_checkinable is the canonical "this ticket isn't in a
    // state where you can check in" code emitted by the server.
    stateConflictCode: "ticket_not_checkinable",
  },
  {
    label: "Check Out",
    field: "check_out" as const,
    buttonTestId: "button-check-out",
    inlineErrorTestId: "inline-error-check_out",
    endpoint: `/api/tickets/${TICKET_ID}/check-out`,
    ticket: () =>
      makeTicket({ status: "in_progress", lifecycleState: "on_site" }),
    // ticket_state_changed is the catch-all conflict code; check-out
    // doesn't have a more specific one in STATE_CONFLICT_CODES.
    stateConflictCode: "ticket_state_changed",
  },
];

describe.each(BUTTONS)(
  "TicketDetailScreen — $label inline error wiring (Task #555 follow-up)",
  ({ buttonTestId, inlineErrorTestId, endpoint, ticket, stateConflictCode }) => {
    it("pins a non-state-conflict failure inline under the button (no extra Alert)", async () => {
      getUserMock.mockResolvedValue(adminUser);
      setupApi({
        ticketByCall: () => ticket(),
        override: (url, init) => {
          if (url === endpoint && init?.method === "POST") {
            // 500 + no structured code → translateApiError falls back
            // to `errors.server.internal_error`, which the identity
            // translator surfaces as `tx:errors.server.internal_error`.
            // Critically NOT in STATE_CONFLICT_CODES.
            return Promise.reject(makeApiError({ status: 500 }));
          }
          return undefined;
        },
      });

      await renderAndWaitForLoad();
      await waitForUserLoaded();

      const ticketGetsBefore = getTicketGetCount();

      tap(firstByTestId(buttonTestId));

      // Inline error renders under the failed button.
      await waitFor(() => {
        expect(firstByTestId(inlineErrorTestId)).toBeTruthy();
      });
      expect(firstByTestId(inlineErrorTestId).textContent).toContain(
        "tx:errors.server.internal_error",
      );

      // The whole point of Task #532: error must NOT raise an extra
      // popup — the inline message under the button is the affordance.
      expect(alertSpy).not.toHaveBeenCalled();

      // 5xx isn't a state conflict → no silent ticket reload.
      expect(getTicketGetCount()).toBe(ticketGetsBefore);

      // The button is still on screen so the user can retry.
      expect(screen.queryAllByTestId(buttonTestId).length).toBeGreaterThan(0);
    });

    it("clears the inline error and silently reloads on a state-conflict response", async () => {
      getUserMock.mockResolvedValue(adminUser);
      setupApi({
        // Stable ticket for both loads — the second load just simulates
        // "the server still says we can't take this action", and we're
        // only asserting the screen re-fetched + cleared the inline
        // error, not the post-refresh state.
        ticketByCall: () => ticket(),
        override: (url, init) => {
          if (url === endpoint && init?.method === "POST") {
            return Promise.reject(
              makeApiError({ status: 409, code: stateConflictCode }),
            );
          }
          return undefined;
        },
      });

      await renderAndWaitForLoad();
      await waitForUserLoaded();

      const ticketGetsBefore = getTicketGetCount();

      tap(firstByTestId(buttonTestId));

      // handleActionError must trigger a silent reload (one extra GET
      // of the ticket) when the code is in STATE_CONFLICT_CODES.
      await waitFor(() => {
        expect(getTicketGetCount()).toBe(ticketGetsBefore + 1);
      });

      // No inline error pinned under the button — a stale "check-in
      // is invalid" message shouldn't sit there after the screen has
      // already moved to refresh.
      expect(screen.queryAllByTestId(inlineErrorTestId).length).toBe(0);

      // No popup either: the conflict UX is a silent refresh, not an
      // alert, on every per-control button.
      expect(alertSpy).not.toHaveBeenCalled();
    });
  },
);
