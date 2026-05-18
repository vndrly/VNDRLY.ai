import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #555: screen-level coverage for the close-for-review error
// handling on the mobile ticket detail screen. Task #532 wired the
// main "Close for review" button to render server errors inline (no
// modal alert) on the close button itself, and Task #547 extended the
// same behavior to the secondary "force-checkout-then-submit" flow
// triggered when crew members are still clocked in. The underlying
// `inlineErrorForTicketAction` helper has unit coverage in
// lib/apiErrors.test.ts, but until now the screen-level wiring had
// none — a regression that put either of these messages back into a
// popup alert would have shipped silently. These tests assert:
//
//   1. A normal (non-state-conflict) failure of the submit POST renders
//      under the close button via `testID="inline-error-close"` and
//      does NOT raise a second `Alert.alert(...)` for the error.
//   2. When the force-checkout step partially fails (one rejection,
//      non-state-conflict), the same inline error appears and the
//      ticket is silently re-fetched.
//   3. A state-conflict response (e.g. `ticket_state_changed`) clears
//      any inline error and silently reloads the ticket — matching the
//      "the screen has moved on, don't pin a stale message under a
//      button that may not be there anymore" UX from Task #532.

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

// Identity-style translator. We tag every `errors.*` lookup with a
// `tx:` prefix so `translateApiError`'s "key returned verbatim ⇒ no
// translation" check treats the lookup as found, and we can assert
// that the code-driven message reached the inline-error node.
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

// Heavy child components are stubbed out — they're irrelevant to the
// close-for-review wiring and pulling them in would force us to mock
// more transitive deps for no test value.
vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", () => ({ TicketRouteMap: () => null }));
vi.mock("@/components/TicketTrackingTimeline", () => ({
  TicketTrackingTimeline: () => null,
}));
vi.mock("@/components/CrewTimeSection", () => ({ default: () => null }));
vi.mock("@/components/CommentsPanel", () => ({ default: () => null }));
vi.mock("@/components/TicketStatusStepper", () => ({ default: () => null }));

// AmberButton/BlueButton/GreyButton are replaced with plain DOM
// <button> shims so the asset-backed implementations (which `require()`
// PNGs) don't need to load in jsdom. Same shape as the awaiting-
// payment / disperse-funds tests.
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
    // Default to `pending_review` so the close-for-review button is
    // visible (canClose === true).
    status: "pending_review",
    description: null,
    siteName: "Acme HQ",
    siteLocationId: null,
    state: null,
    workTypeName: "Maintenance",
    partnerName: "Acme Partner",
    vendorId: 11,
    // `off_site` keeps the geofence watcher from spinning up.
    lifecycleState: "off_site",
    arrivedAt: "2025-01-01T10:00:00Z",
    createdAt: "2025-01-01T09:00:00Z",
    ...overrides,
  };
}

type AlertButton = {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type AlertCallArgs = [string, string | undefined, AlertButton[] | undefined];

function makeApiError(init: {
  status: number;
  code?: string;
  data?: Record<string, unknown> | null;
  message?: string;
}): Error {
  const err = new Error(init.message ?? `api error ${init.code ?? init.status}`) as Error & {
    status?: number;
    code?: string;
    data?: unknown;
  };
  err.status = init.status;
  if (init.code !== undefined) err.code = init.code;
  err.data = init.data ?? (init.code ? { error: init.code, code: init.code } : null);
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

function getSubmitPostCount(): number {
  return apiFetchMock.mock.calls.filter(
    ([url, init]) =>
      url === `/api/tickets/${TICKET_ID}/submit` &&
      (init as { method?: string } | undefined)?.method === "POST",
  ).length;
}

// `Alert.alert(title, body, buttons)` is the close-for-review
// confirmation. We invoke the named button's onPress directly (rather
// than fishing through the rendered DOM) because react-native's Alert
// has no DOM under jsdom.
async function tapAlertButton(callIndex: number, text: string): Promise<void> {
  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledTimes(callIndex + 1);
  });
  const args = alertSpy.mock.calls[callIndex] as AlertCallArgs;
  const buttons = args[2] ?? [];
  const button = buttons.find((b) => b?.text === text);
  if (!button) {
    throw new Error(
      `expected Alert button labeled "${text}", got: ${buttons
        .map((b) => JSON.stringify(b?.text))
        .join(", ")}`,
    );
  }
  button.onPress?.();
}

describe("TicketDetailScreen — Close for Review error handling (Task #555)", () => {
  it("pins a non-state-conflict submit error inline on the close button (no extra Alert)", async () => {
    // Task #532 path: from `pending_review` the user taps Close for
    // review. With no open crew sessions we go straight to the
    // confirmation Alert; the user confirms, the submit POST fails
    // with a normal (non-conflict) status, and the message must
    // render inline at `inline-error-close` instead of a popup.
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    apiFetchMock.mockImplementation(
      (url: string, init?: { method?: string; body?: string }) => {
        if (
          url === `/api/tickets/${TICKET_ID}` &&
          (!init || !init.method || init.method === "GET")
        ) {
          return Promise.resolve(makeTicket({ status: "pending_review" }));
        }
        if (url === `/api/tickets/${TICKET_ID}/line-items`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/note-logs`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/unlocks`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/crew-sessions`) {
          // No one is still clocked in → straight to the simple
          // confirmation flow (no force-checkout step).
          return Promise.resolve([]);
        }
        if (
          url === `/api/tickets/${TICKET_ID}/submit` &&
          init?.method === "POST"
        ) {
          // 500 with no structured code: translateApiError falls back
          // to `errors.server.internal_error`, which our identity
          // translator surfaces as `tx:errors.server.internal_error`.
          // Crucially this is NOT in STATE_CONFLICT_CODES, so the
          // screen must pin the message inline.
          return Promise.reject(makeApiError({ status: 500 }));
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    const ticketGetsBefore = getTicketGetCount();

    tap(firstByTestId("button-close-for-review"));

    // First Alert is the close-for-review confirmation. Confirm it.
    await tapAlertButton(0, "tickets.closeForReview");

    await waitFor(() => {
      expect(getSubmitPostCount()).toBe(1);
    });

    // The inline error renders under the close button. The localized
    // message is `tx:errors.server.internal_error` (status fallback).
    await waitFor(() => {
      expect(firstByTestId("inline-error-close")).toBeTruthy();
    });
    expect(firstByTestId("inline-error-close").textContent).toContain(
      "tx:errors.server.internal_error",
    );

    // Crucially: only the confirmation Alert was raised. The error
    // path must not have popped a second `Alert.alert(...)` — that
    // would be the regression Task #532 explicitly fixed.
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // 5xx isn't a state conflict → no silent ticket reload.
    expect(getTicketGetCount()).toBe(ticketGetsBefore);
    // Close button is still on screen so the user can retry.
    expect(screen.queryAllByTestId("button-close-for-review").length).toBeGreaterThan(0);
  });

  it("shows the inline error and refreshes the ticket when the force-checkout step partially fails (Task #547)", async () => {
    // Task #547 path: there's still an open crew session, so the user
    // gets the destructive "Check out and close" prompt. One of the
    // per-employee check-out POSTs rejects with a non-conflict error;
    // the screen must (a) pin the partial-failure message inline at
    // `inline-error-close` and (b) silently re-fetch the ticket so
    // the crew chips reflect any sessions that did succeed.
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    apiFetchMock.mockImplementation(
      (url: string, init?: { method?: string; body?: string }) => {
        if (
          url === `/api/tickets/${TICKET_ID}` &&
          (!init || !init.method || init.method === "GET")
        ) {
          return Promise.resolve(makeTicket({ status: "pending_review" }));
        }
        if (url === `/api/tickets/${TICKET_ID}/line-items`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/note-logs`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/unlocks`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/crew-sessions`) {
          return Promise.resolve([
            { employeeId: 42, employeeName: "Pat", checkOutAt: null },
          ]);
        }
        if (
          url === `/api/tickets/${TICKET_ID}/crew/42/check-out` &&
          init?.method === "POST"
        ) {
          // Non-conflict failure: a 500 with no code. The screen
          // counts this as a partial failure and pins the inline
          // "couldn't check everyone out" message on the close button.
          return Promise.reject(makeApiError({ status: 500 }));
        }
        if (
          url === `/api/tickets/${TICKET_ID}/submit` &&
          init?.method === "POST"
        ) {
          // Should never be reached when checkout fails — fail loudly
          // if we ever do call /submit, so a regression that drops the
          // partial-failure guard is caught here.
          return Promise.reject(
            new Error("submit POST should not fire when crew checkout failed"),
          );
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    const ticketGetsBefore = getTicketGetCount();

    tap(firstByTestId("button-close-for-review"));

    // First Alert is the "crew still clocked in" prompt. Confirm the
    // destructive "Check out and close" option.
    await tapAlertButton(0, "tickets.checkOutAndClose");

    // Inline error renders the partial-failure copy from
    // `tickets.couldntCheckEveryoneOutOne` (the identity translator
    // returns the key verbatim for non-error keys). Task #554: with a
    // single failed crew member ("Pat") we pick the singular variant
    // so the copy can name them directly.
    await waitFor(() => {
      expect(firstByTestId("inline-error-close")).toBeTruthy();
    });
    expect(firstByTestId("inline-error-close").textContent).toContain(
      "tickets.couldntCheckEveryoneOutOne",
    );

    // Ticket was silently re-fetched so the crew chips refresh.
    await waitFor(() => {
      expect(getTicketGetCount()).toBe(ticketGetsBefore + 1);
    });

    // The submit POST must NOT have been called: the screen short-
    // circuits when any per-employee check-out rejects.
    expect(getSubmitPostCount()).toBe(0);

    // Only the destructive confirmation Alert was raised — no second
    // Alert for the partial-failure error.
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it("clears any inline error and silently reloads on a state-conflict response (ticket_state_changed)", async () => {
    // Task #532 STATE_CONFLICT_CODES path: when the server replies
    // that the ticket has moved on (e.g. another device just submitted
    // it), we must NOT pin a stale message under a button that may not
    // even render after the refresh. Instead clear `fieldError` and
    // load() the ticket again so the next render reflects truth.
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    let getCalls = 0;
    apiFetchMock.mockImplementation(
      (url: string, init?: { method?: string; body?: string }) => {
        if (
          url === `/api/tickets/${TICKET_ID}` &&
          (!init || !init.method || init.method === "GET")
        ) {
          getCalls += 1;
          // First load: still pending_review (close button visible).
          // Second load (after the state-conflict refresh): the ticket
          // has moved to `submitted`, so the close button vanishes
          // entirely on the next render.
          return Promise.resolve(
            makeTicket({
              status: getCalls === 1 ? "pending_review" : "submitted",
            }),
          );
        }
        if (url === `/api/tickets/${TICKET_ID}/line-items`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/note-logs`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/unlocks`)
          return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/crew-sessions`) {
          return Promise.resolve([]);
        }
        if (
          url === `/api/tickets/${TICKET_ID}/submit` &&
          init?.method === "POST"
        ) {
          // 409 + structured code that lives in STATE_CONFLICT_CODES.
          return Promise.reject(
            makeApiError({ status: 409, code: "ticket_state_changed" }),
          );
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(getTicketGetCount()).toBe(1);

    tap(firstByTestId("button-close-for-review"));
    await tapAlertButton(0, "tickets.closeForReview");

    // After the 409, handleActionError should have triggered a silent
    // reload (ticket GET count goes from 1 → 2) and cleared any
    // inline error.
    await waitFor(() => {
      expect(getTicketGetCount()).toBe(2);
    });
    expect(screen.queryAllByTestId("inline-error-close").length).toBe(0);

    // The refreshed ticket is `submitted`, so canClose flips false and
    // the close button is rendered as the disabled GreyButton variant.
    // We can't easily distinguish those two without stronger assertions,
    // but we *can* assert the screen never popped a second Alert for
    // the conflict — which is the regression we're guarding against.
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
