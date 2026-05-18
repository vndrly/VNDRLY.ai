import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #588: screen-level coverage for the "Mark Awaiting Payment" flow
// added in Task #575. We verify role/status gating on the visible
// button, the POST body shape (note trimmed vs. omitted), the inline
// 400 error pinned to the modal, the silent refresh on the new
// STATE_CONFLICT code (`ticket_not_in_progress`), and the success
// path (modal closes, ticket reloads, success Alert shows).

// === Module mocks (must be hoisted before importing the screen) ===

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
  // Task #669: ticket detail screen sets `headerRight` via Stack.Screen.
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "777" }),
  // Task #615: the ticket detail screen calls `useFocusEffect` to
  // schedule its banner-driven background polling. Tests don't navigate
  // between screens, so we treat the screen as always focused and run
  // the effect (and its cleanup) using the same React hook contract.
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
// Task #613 added a foreground push listener for `ticket_unblocked`
// notifications. These tests don't need to fire pushes — they only need
// the import to resolve without dragging in the real Expo runtime
// (which fails in jsdom because it tries to require `./setupFastRefresh`).
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

// useTranslation: near-identity `t` so we can assert against translation
// keys. We prefix `errors.*` keys with `tx:` because `translateApiError`
// uses the convention "if t(key) === key then no translation exists" to
// fall back through its lookup chain — a pure identity translator would
// always look unfound and we'd never see the code-based message reach
// the UI. The same `t` reference is returned on every call so the
// screen's useEffect dependency arrays don't churn between renders.
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
// awaiting-payment flow and pulling them in would force us to mock
// more transitive deps for no test value.
vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", () => ({ TicketRouteMap: () => null }));
vi.mock("@/components/TicketTrackingTimeline", () => ({
  TicketTrackingTimeline: () => null,
}));
vi.mock("@/components/CrewTimeSection", () => ({ default: () => null }));
vi.mock("@/components/CommentsPanel", () => ({ default: () => null }));
vi.mock("@/components/TicketStatusStepper", () => ({ default: () => null }));

// Replace AmberButton/BlueButton/GreyButton with plain DOM <button>
// shims so the asset-backed implementations (which `require()` PNGs)
// don't have to load in jsdom. Mirrors the shim used by
// VisitorHostPicker.test.tsx and new-ticket.test.tsx. The factory is
// inlined per-mock because `vi.mock` is hoisted to the top of the
// module — referencing a top-level `const` from the factory body
// would observe the temporal-dead-zone error.
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
  // The geofence monitor and check-in helpers ping these — keep them
  // resolved with "denied" so the watchPositionAsync subscription is
  // never set up and the screen doesn't try to ask for coordinates.
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  getForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  watchPositionAsyncMock.mockResolvedValue({ remove: vi.fn() });
  // Alert.alert is the success/error popup the screen uses. We want to
  // assert it fires on the success path without ever blocking the test
  // on a real native dialog.
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
    status: "in_progress",
    description: null,
    siteName: "Acme HQ",
    siteLocationId: null,
    state: null,
    workTypeName: "Maintenance",
    partnerName: "Acme Partner",
    vendorId: 11,
    lifecycleState: "on_site",
    arrivedAt: "2025-01-01T10:00:00Z",
    createdAt: "2025-01-01T09:00:00Z",
    ...overrides,
  };
}

function setupApi(opts: {
  ticket: TicketStub;
  awaitingPaymentResponder?: (body: unknown) => unknown | Promise<unknown>;
}) {
  apiFetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      if (
        url === `/api/tickets/${TICKET_ID}` &&
        (!init || !init.method || init.method === "GET")
      ) {
        return Promise.resolve(opts.ticket);
      }
      if (url === `/api/tickets/${TICKET_ID}/line-items`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/note-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/unlocks`)
        return Promise.resolve([]);
      if (
        url === `/api/tickets/${TICKET_ID}/awaiting-payment` &&
        init?.method === "POST"
      ) {
        const parsed = init.body ? JSON.parse(init.body as string) : {};
        return Promise.resolve(opts.awaitingPaymentResponder?.(parsed) ?? null);
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    },
  );
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

// react-native-web's <TouchableOpacity>/<Pressable> uses the React
// Native responder system, which listens for pointer events rather
// than `click`. Dispatching pointerdown + pointerup matches a real tap.
function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

function makeApiError(code: string, status: number): Error {
  const err = new Error(`api error ${code}`) as Error & {
    status?: number;
    code?: string;
    data?: unknown;
  };
  err.status = status;
  err.code = code;
  err.data = { code, message: `api error ${code}` };
  return err;
}

async function renderAndWaitForLoad() {
  const utils = render(<TicketDetailScreen />);
  await waitFor(() => {
    expect(firstByTestId("text-ticket-tracking-number")).toBeTruthy();
  });
  return utils;
}

async function waitForUserLoaded() {
  // The screen calls `getUser().then(setCurrentUser)` in a useEffect.
  // Wait for that promise to flush before asserting on role-gated UI.
  await waitFor(() => {
    expect(getUserMock).toHaveBeenCalled();
  });
  // One extra microtask flush so the resolved user is committed to state.
  await Promise.resolve();
}

function awaitingPaymentPostCalls(): Array<[string, { method?: string; body?: string }]> {
  return apiFetchMock.mock.calls.filter(
    ([url, init]) =>
      url === `/api/tickets/${TICKET_ID}/awaiting-payment` &&
      (init as { method?: string } | undefined)?.method === "POST",
  ) as Array<[string, { method?: string; body?: string }]>;
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

describe("TicketDetailScreen — Mark Awaiting Payment role/status gating (Task #575/#588)", () => {
  it("shows the button for admins on in_progress tickets", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket({ status: "in_progress" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-mark-awaiting-payment").length,
    ).toBeGreaterThan(0);
  });

  it("shows the button for vendors on in_progress tickets", async () => {
    getUserMock.mockResolvedValue({
      id: 2,
      username: "vendor",
      role: "vendor",
      vendorId: 11,
      displayName: "V",
    });
    setupApi({ ticket: makeTicket({ status: "in_progress" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-mark-awaiting-payment").length,
    ).toBeGreaterThan(0);
  });

  it("shows the button for field employees on in_progress tickets", async () => {
    getUserMock.mockResolvedValue({
      id: 3,
      username: "field",
      role: "field_employee",
      displayName: "F",
    });
    setupApi({ ticket: makeTicket({ status: "in_progress" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-mark-awaiting-payment").length,
    ).toBeGreaterThan(0);
  });

  it("hides the button for partners even on in_progress tickets", async () => {
    getUserMock.mockResolvedValue({
      id: 4,
      username: "partner",
      role: "partner",
      partnerId: 9,
      displayName: "P",
    });
    setupApi({ ticket: makeTicket({ status: "in_progress" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();
    // Wait until the partner user has been committed and the gate has
    // re-rendered the button out of the tree.
    await waitFor(() => {
      expect(screen.queryAllByTestId("button-mark-awaiting-payment").length).toBe(0);
    });
  });

  it("hides the button on non-in_progress tickets even for admins (status=submitted)", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket({ status: "submitted" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(screen.queryAllByTestId("button-mark-awaiting-payment").length).toBe(0);
  });

  it("hides the button on non-in_progress tickets even for admins (status=pending_review)", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket({ status: "pending_review" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(screen.queryAllByTestId("button-mark-awaiting-payment").length).toBe(0);
  });
});

describe("TicketDetailScreen — Mark Awaiting Payment submit body (Task #575/#588)", () => {
  it("POSTs without a `note` field when the textarea is left blank", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket({ status: "in_progress" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    tap(firstByTestId("button-mark-awaiting-payment"));
    // Modal opens — wait until its submit button is mounted.
    await waitFor(() => {
      expect(firstByTestId("button-awaiting-payment-submit")).toBeTruthy();
    });

    tap(firstByTestId("button-awaiting-payment-submit"));

    await waitFor(() => {
      expect(awaitingPaymentPostCalls().length).toBe(1);
    });

    const [, init] = awaitingPaymentPostCalls()[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // Empty textarea => empty body, no `note` key. Sending `note: ""`
    // would trip the server's min(1) validator and surface as
    // invalid_awaiting_payment_body.
    expect(body).toEqual({});
    expect("note" in body).toBe(false);
  });

  it("POSTs with the trimmed `note` when the textarea is filled", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket({ status: "in_progress" }) });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    tap(firstByTestId("button-mark-awaiting-payment"));
    await waitFor(() => {
      expect(firstByTestId("input-awaiting-payment-note")).toBeTruthy();
    });

    const noteInput = firstByTestId("input-awaiting-payment-note");
    // react-native-web maps multiline TextInput onto a <textarea>; a
    // plain `change` event with the new value is what onChangeText
    // listens for.
    fireEvent.change(noteInput, {
      target: { value: "  customer paying next visit  " },
    });

    tap(firstByTestId("button-awaiting-payment-submit"));

    await waitFor(() => {
      expect(awaitingPaymentPostCalls().length).toBe(1);
    });

    const [, init] = awaitingPaymentPostCalls()[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ note: "customer paying next visit" });
  });
});

describe("TicketDetailScreen — Mark Awaiting Payment error handling (Task #575/#588)", () => {
  it("shows the localized inline error pinned to the modal on a 400 invalid_awaiting_payment_body", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({
      ticket: makeTicket({ status: "in_progress" }),
      awaitingPaymentResponder: () => {
        throw makeApiError("invalid_awaiting_payment_body", 400);
      },
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    const ticketGetsBefore = getTicketGetCount();

    tap(firstByTestId("button-mark-awaiting-payment"));
    await waitFor(() => {
      expect(firstByTestId("button-awaiting-payment-submit")).toBeTruthy();
    });
    tap(firstByTestId("button-awaiting-payment-submit"));

    // The localized message routes through translateApiError() which
    // looks up `errors.invalid_awaiting_payment_body`. With our
    // identity-translator that's the string we should see pinned to
    // both the body and the modal (both render when fieldError.field
    // is "awaiting_payment"). We assert the modal copy specifically.
    await waitFor(() => {
      expect(firstByTestId("inline-error-awaiting-payment-modal")).toBeTruthy();
    });
    expect(
      firstByTestId("inline-error-awaiting-payment-modal").textContent,
    ).toContain("tx:errors.invalid_awaiting_payment_body");

    // 400 is NOT a state-conflict — no silent ticket reload should fire.
    expect(getTicketGetCount()).toBe(ticketGetsBefore);
    // The success Alert should not have shown.
    expect(alertSpy).not.toHaveBeenCalled();
    // The modal should still be open (we can still see its inputs).
    expect(screen.queryAllByTestId("input-awaiting-payment-note").length).toBeGreaterThan(0);
  });

  it("silently refreshes the ticket and clears the inline error on a 409 ticket_not_in_progress", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    // First GET returns in_progress (so the button is visible). After
    // the 409, the screen calls load() again — return the ticket in a
    // new status to mimic "another device already submitted it" so the
    // button vanishes after the silent refresh.
    let getCalls = 0;
    apiFetchMock.mockImplementation(
      (url: string, init?: { method?: string; body?: string }) => {
        if (
          url === `/api/tickets/${TICKET_ID}` &&
          (!init || !init.method || init.method === "GET")
        ) {
          getCalls += 1;
          return Promise.resolve(
            makeTicket({
              status: getCalls === 1 ? "in_progress" : "submitted",
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
        if (
          url === `/api/tickets/${TICKET_ID}/awaiting-payment` &&
          init?.method === "POST"
        ) {
          return Promise.reject(makeApiError("ticket_not_in_progress", 409));
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(getTicketGetCount()).toBe(1);

    tap(firstByTestId("button-mark-awaiting-payment"));
    await waitFor(() => {
      expect(firstByTestId("button-awaiting-payment-submit")).toBeTruthy();
    });
    tap(firstByTestId("button-awaiting-payment-submit"));

    // After the 409, handleActionError should have:
    //   - re-fetched the ticket (silent refresh)
    //   - cleared fieldError (no inline error pinned to the modal)
    // …and the button on the body should be gone now that the
    // refreshed status is `submitted`.
    await waitFor(() => {
      expect(getTicketGetCount()).toBe(2);
    });
    expect(
      screen.queryAllByTestId("inline-error-awaiting-payment-modal").length,
    ).toBe(0);
    expect(
      screen.queryAllByTestId("inline-error-awaiting_payment").length,
    ).toBe(0);
    await waitFor(() => {
      expect(
        screen.queryAllByTestId("button-mark-awaiting-payment").length,
      ).toBe(0);
    });
    // Silent refresh — no success popup.
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("TicketDetailScreen — Mark Awaiting Payment success path (Task #575/#588)", () => {
  it("closes the modal, refreshes the ticket, and shows the success Alert", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({
      ticket: makeTicket({ status: "in_progress" }),
      awaitingPaymentResponder: () => null,
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    const ticketGetsBefore = getTicketGetCount();

    tap(firstByTestId("button-mark-awaiting-payment"));
    await waitFor(() => {
      expect(firstByTestId("input-awaiting-payment-note")).toBeTruthy();
    });

    const noteInput = firstByTestId("input-awaiting-payment-note");
    fireEvent.change(noteInput, {
      target: { value: "wrapped, paying tomorrow" },
    });

    tap(firstByTestId("button-awaiting-payment-submit"));

    // Wait for the POST to land + the screen to refresh + the Alert
    // call to fire from inside markAwaitingPayment().
    await waitFor(() => {
      expect(awaitingPaymentPostCalls().length).toBe(1);
    });
    await waitFor(() => {
      expect(getTicketGetCount()).toBe(ticketGetsBefore + 1);
    });
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    const [title, body] = alertSpy.mock.calls[0] as [string, string];
    expect(title).toBe("tickets.awaitingPaymentSentTitle");
    expect(body).toBe("tickets.awaitingPaymentSentBody");

    // Inline error never pinned on success.
    expect(
      screen.queryAllByTestId("inline-error-awaiting-payment-modal").length,
    ).toBe(0);
    expect(
      screen.queryAllByTestId("inline-error-awaiting_payment").length,
    ).toBe(0);
    // The note state is reset (we can't observe modal-visibility purely
    // from the DOM under react-native-web, so we re-open the modal and
    // assert the textarea comes up empty — which proves
    // setAwaitingPaymentNote("") fired on the success path).
    tap(firstByTestId("button-mark-awaiting-payment"));
    await waitFor(() => {
      expect(firstByTestId("input-awaiting-payment-note")).toBeTruthy();
    });
    const reopenedInput = firstByTestId(
      "input-awaiting-payment-note",
    ) as HTMLTextAreaElement | HTMLInputElement;
    expect((reopenedInput as HTMLTextAreaElement).value || "").toBe("");
  });
});
