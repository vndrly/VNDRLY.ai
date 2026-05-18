import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #600: screen-level coverage for the Disperse Funds flow added to
// the mobile ticket detail. We verify status + viewer-capability gating
// on the visible button (approved OR awaiting_payment, only when the
// server says viewerCanDisperseFunds=true), the POST body shape, the
// inline check#-required validation that short-circuits without a
// server round-trip, the localized inline error pinned to the modal on
// a 403 forbidden_not_ap and on a 409 ticket_not_approved (after the
// server expanded the guard in Task #595), and the success path (modal
// closes, ticket reloads, success Alert shows).
//
// Mirrors the structure of ticketDetail.awaitingPayment.test.tsx; the
// shared mock surface (router, expo-location, expo-image, …) is the
// same so this file should be straightforward to read alongside it.

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

// Ticket detail imports `expo-notifications` for the foreground unblock
// hook. Other ticket-detail tests mock it the same way; without this
// stub the screen pulls in `DevicePushTokenAutoRegistration.fx.js` →
// `abort-controller/polyfill.mjs`, which fails Node's strict ESM
// resolver during module load and prevents this file's tests from
// running.
vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
}));

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
  // The screen calls `useFocusEffect(useCallback(...))` for the
  // assignment-removed banner refresh; without a stub the hook is
  // `undefined` and React throws "Cannot read properties of undefined".
  useFocusEffect: () => undefined,
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
  // Task #600 fields read by the screen.
  viewerCanDisperseFunds?: boolean | null;
  paymentDispersedAt?: string | null;
  paymentMethod?: "etf" | "check" | "other" | null;
  paymentReference?: string | null;
  paymentNote?: string | null;
  paymentDispersedByName?: string | null;
};

function makeTicket(overrides: Partial<TicketStub> = {}): TicketStub {
  return {
    id: TICKET_ID,
    status: "approved",
    description: null,
    siteName: "Acme HQ",
    siteLocationId: null,
    state: null,
    workTypeName: "Maintenance",
    partnerName: "Acme Partner",
    vendorId: 11,
    lifecycleState: "off_site",
    arrivedAt: "2025-01-01T10:00:00Z",
    createdAt: "2025-01-01T09:00:00Z",
    viewerCanDisperseFunds: true,
    paymentDispersedAt: null,
    paymentMethod: null,
    paymentReference: null,
    paymentNote: null,
    paymentDispersedByName: null,
    ...overrides,
  };
}

function setupApi(opts: {
  ticket: TicketStub;
  disperseResponder?: (body: unknown) => unknown | Promise<unknown>;
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
        url === `/api/tickets/${TICKET_ID}/disperse-funds` &&
        init?.method === "POST"
      ) {
        const parsed = init.body ? JSON.parse(init.body as string) : {};
        return Promise.resolve(opts.disperseResponder?.(parsed) ?? null);
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    },
  );
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

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
  err.data = { code, error: code, message: `api error ${code}` };
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
  await waitFor(() => {
    expect(getUserMock).toHaveBeenCalled();
  });
  await Promise.resolve();
}

function dispersePostCalls(): Array<[string, { method?: string; body?: string }]> {
  return apiFetchMock.mock.calls.filter(
    ([url, init]) =>
      url === `/api/tickets/${TICKET_ID}/disperse-funds` &&
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

describe("TicketDetailScreen — Disperse Funds gating (Task #600)", () => {
  it("shows the trigger on approved tickets when viewerCanDisperseFunds is true", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "ap",
      role: "partner",
      partnerId: 5,
      displayName: "AP",
    });
    setupApi({
      ticket: makeTicket({ status: "approved", viewerCanDisperseFunds: true }),
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-disperse-funds-trigger").length,
    ).toBeGreaterThan(0);
  });

  it("shows the trigger on awaiting_payment tickets too (the new branch)", async () => {
    // Task #595 broadened the server guard so AP can close out tickets
    // parked in awaiting_payment without bouncing them through approved
    // first. This test pins the mobile-side mirror of that change.
    getUserMock.mockResolvedValue({
      id: 1,
      username: "ap",
      role: "partner",
      partnerId: 5,
      displayName: "AP",
    });
    setupApi({
      ticket: makeTicket({
        status: "awaiting_payment",
        viewerCanDisperseFunds: true,
      }),
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-disperse-funds-trigger").length,
    ).toBeGreaterThan(0);
  });

  it("hides the trigger when viewerCanDisperseFunds is false (non-AP partner)", async () => {
    getUserMock.mockResolvedValue({
      id: 2,
      username: "partner",
      role: "partner",
      partnerId: 5,
      displayName: "P",
    });
    setupApi({
      ticket: makeTicket({ status: "approved", viewerCanDisperseFunds: false }),
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-disperse-funds-trigger").length,
    ).toBe(0);
  });

  it("hides the trigger on statuses other than approved/awaiting_payment even when viewerCanDisperseFunds is true", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({
      ticket: makeTicket({
        status: "in_progress",
        viewerCanDisperseFunds: true,
      }),
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(
      screen.queryAllByTestId("button-disperse-funds-trigger").length,
    ).toBe(0);
  });
});

describe("TicketDetailScreen — Disperse Funds submit body (Task #600)", () => {
  it("POSTs paymentMethod only (etf, no reference, no note) by default", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket() });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    tap(firstByTestId("button-disperse-funds-trigger"));
    await waitFor(() => {
      expect(firstByTestId("button-disperse-submit")).toBeTruthy();
    });

    tap(firstByTestId("button-disperse-submit"));

    await waitFor(() => {
      expect(dispersePostCalls().length).toBe(1);
    });

    const [, init] = dispersePostCalls()[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ paymentMethod: "etf" });
    expect("paymentReference" in body).toBe(false);
    expect("note" in body).toBe(false);
  });

  it("POSTs the trimmed reference and note when populated", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket() });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    tap(firstByTestId("button-disperse-funds-trigger"));
    await waitFor(() => {
      expect(firstByTestId("input-disperse-reference")).toBeTruthy();
    });

    tap(firstByTestId("button-disperse-method-check"));
    fireEvent.change(firstByTestId("input-disperse-reference"), {
      target: { value: "  CHK-1234  " },
    });
    fireEvent.change(firstByTestId("input-disperse-note"), {
      target: { value: "  paid via courier  " },
    });

    tap(firstByTestId("button-disperse-submit"));

    await waitFor(() => {
      expect(dispersePostCalls().length).toBe(1);
    });

    const [, init] = dispersePostCalls()[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      paymentMethod: "check",
      paymentReference: "CHK-1234",
      note: "paid via courier",
    });
  });

  it("blocks submit and pins inline error when method=check has no reference", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({ ticket: makeTicket() });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    tap(firstByTestId("button-disperse-funds-trigger"));
    await waitFor(() => {
      expect(firstByTestId("button-disperse-submit")).toBeTruthy();
    });

    tap(firstByTestId("button-disperse-method-check"));
    tap(firstByTestId("button-disperse-submit"));

    // No POST should have fired — the client short-circuits.
    expect(dispersePostCalls().length).toBe(0);

    // Inline error pinned inside the modal.
    await waitFor(() => {
      expect(firstByTestId("inline-error-disperse-funds-modal")).toBeTruthy();
    });
    expect(
      firstByTestId("inline-error-disperse-funds-modal").textContent,
    ).toContain("ticketDetail.disperseFundsReferenceRequired");
  });
});

describe("TicketDetailScreen — Disperse Funds error handling (Task #600)", () => {
  it("shows a localized inline error in the modal on a 403 forbidden_not_ap", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({
      ticket: makeTicket(),
      disperseResponder: () => {
        throw makeApiError("forbidden_not_ap", 403);
      },
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    const ticketGetsBefore = getTicketGetCount();

    tap(firstByTestId("button-disperse-funds-trigger"));
    await waitFor(() => {
      expect(firstByTestId("button-disperse-submit")).toBeTruthy();
    });
    tap(firstByTestId("button-disperse-submit"));

    await waitFor(() => {
      expect(firstByTestId("inline-error-disperse-funds-modal")).toBeTruthy();
    });
    expect(
      firstByTestId("inline-error-disperse-funds-modal").textContent,
    ).toContain("tx:errors.forbidden_not_ap");
    // 403 is not a state conflict — no silent reload should fire.
    expect(getTicketGetCount()).toBe(ticketGetsBefore);
    // Modal should still be open (inputs still mounted).
    expect(screen.queryAllByTestId("input-disperse-reference").length).toBeGreaterThan(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows the localized inline error for a 409 ticket_not_approved (covers the broadened branch)", async () => {
    // Task #595: the server now allows approved OR awaiting_payment, so
    // this code only fires when the ticket has actually moved on (e.g.
    // already dispersed by another device). The mobile-side translation
    // for `ticket_not_approved` was updated to mention both branches —
    // we confirm the localized message reaches the modal.
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({
      ticket: makeTicket({ status: "awaiting_payment" }),
      disperseResponder: () => {
        throw makeApiError("ticket_not_approved", 409);
      },
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    tap(firstByTestId("button-disperse-funds-trigger"));
    await waitFor(() => {
      expect(firstByTestId("button-disperse-submit")).toBeTruthy();
    });
    tap(firstByTestId("button-disperse-submit"));

    await waitFor(() => {
      expect(firstByTestId("inline-error-disperse-funds-modal")).toBeTruthy();
    });
    expect(
      firstByTestId("inline-error-disperse-funds-modal").textContent,
    ).toContain("tx:errors.ticket_not_approved");
  });
});

describe("TicketDetailScreen — Disperse Funds success path (Task #600)", () => {
  it("closes the modal, refreshes the ticket, and shows the success Alert", async () => {
    getUserMock.mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "A",
    });
    setupApi({
      ticket: makeTicket({ status: "approved" }),
      disperseResponder: () => null,
    });

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    const ticketGetsBefore = getTicketGetCount();

    tap(firstByTestId("button-disperse-funds-trigger"));
    await waitFor(() => {
      expect(firstByTestId("button-disperse-submit")).toBeTruthy();
    });
    tap(firstByTestId("button-disperse-submit"));

    await waitFor(() => {
      expect(dispersePostCalls().length).toBe(1);
    });
    await waitFor(() => {
      expect(getTicketGetCount()).toBe(ticketGetsBefore + 1);
    });
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    const [title] = alertSpy.mock.calls[0] as [string, string];
    expect(title).toBe("ticketDetail.disperseFundsSuccess");

    // Inline error never pinned on success.
    expect(
      screen.queryAllByTestId("inline-error-disperse-funds-modal").length,
    ).toBe(0);
  });
});
