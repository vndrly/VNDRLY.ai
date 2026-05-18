import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #850 — mobile-side coverage for the vendor accept/deny/reinvite
// handshake that the web app already covers end-to-end in
// `lib/e2e/tests/vendor-accept-deny-flow.spec.ts`. Field crews accept
// or deny tickets from the mobile app in production, so a regression
// on the mobile banner / deny modal would ship unnoticed.
//
// The mobile artifact's existing test stack is vitest + jsdom +
// react-native-web (the app is unrunnable in Detox/Maestro inside this
// monorepo — no native toolchains are wired up), so this spec mirrors
// the existing screen tests in this directory:
//
//   * `apiFetch` is stubbed at the boundary, so we drive the same
//     ticket lifecycle the server would expose (awaiting_acceptance →
//     initiated on accept; awaiting_acceptance → denied on deny;
//     awaiting_acceptance pinned to vendor #2 after a partner reinvite).
//   * `getUser()` is stubbed per-test to mimic the vendor admin (or
//     vendor #2 admin) currently signed in on the device.
//
// Three scenarios match the three legs of the web spec:
//
//   Test #1 — Happy path: vendor #1 accepts the partner's invite.
//   Test #2 — Deny path:   vendor #1 fills the deny modal & submits.
//   Test #3 — Reinvite:    after the partner reinvites vendor #2 (drive
//                          via the same /reinvite endpoint the partner
//                          web app calls), vendor #2 sees the banner
//                          addressed to them on mobile.

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
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "850" }),
  // Treat the ticket detail screen as always focused so the banner
  // mounts immediately, mirroring the convention used by every other
  // ticket-detail spec in this directory.
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

// Identity translator (with the `tx:` prefix on `errors.*` keys so
// translateApiError's "key === translation" miss heuristic still fires
// where downstream tests need it). Returning the same `t` reference on
// every render keeps the screen's effect dependencies stable.
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

// Heavy children stubbed out — the banner & deny modal don't depend on
// them, and pulling them in would force more transitive mocks for no
// test value.
vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", () => ({ TicketRouteMap: () => null }));
vi.mock("@/components/TicketTrackingTimeline", () => ({
  TicketTrackingTimeline: () => null,
}));
vi.mock("@/components/CrewTimeSection", () => ({ default: () => null }));
vi.mock("@/components/CommentsPanel", () => ({ default: () => null }));
vi.mock("@/components/TicketStatusStepper", () => ({ default: () => null }));

// Replace the asset-backed buttons with plain DOM <button> shims so the
// PNG `require()`s don't blow up under jsdom. Mirrors the shims used
// by every other ticket-detail spec in this directory.
function makeButtonShim() {
  return async () => {
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
  };
}
vi.mock("@/components/AmberButton", makeButtonShim());
vi.mock("@/components/BlueButton", makeButtonShim());
vi.mock("@/components/GreyButton", makeButtonShim());

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
  // Geofence/location helpers ping these on mount; "denied" keeps the
  // tracker silent so neither path leaks side effects into the test.
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  getForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  watchPositionAsyncMock.mockResolvedValue({ remove: vi.fn() });
  alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
});

const TICKET_ID = 850;
const VENDOR_1_ID = 4001;
const VENDOR_2_ID = 4002;

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
    status: "awaiting_acceptance",
    description: "T850 partner self-service ticket",
    siteName: "Acme HQ",
    // siteLocationId/state intentionally null so the screen's optional
    // /api/site-locations/:id and /api/tax-rates/by-state/:state hops
    // stay quiet — keeps the API stub tightly scoped to the handshake.
    siteLocationId: null,
    state: null,
    workTypeName: "Maintenance",
    partnerName: "Acme Partner",
    vendorId: VENDOR_1_ID,
    lifecycleState: "pending_arrival",
    arrivedAt: null,
    createdAt: "2026-05-01T09:00:00Z",
    ...overrides,
  };
}

/**
 * Wire `apiFetchMock` to a small in-memory ticket whose status mutates
 * in response to /accept, /deny, and /reinvite POSTs — closely
 * mirroring the real server transitions the web e2e spec exercises.
 *
 * Returns helpers the test uses to inspect call counts / current state
 * after each user gesture.
 */
function setupApi(initial: TicketStub) {
  let current: TicketStub = { ...initial };
  let getCalls = 0;
  const acceptCalls: Array<unknown> = [];
  const denyCalls: Array<unknown> = [];
  const reinviteCalls: Array<unknown> = [];

  apiFetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";

      if (url === `/api/tickets/${TICKET_ID}` && method === "GET") {
        getCalls += 1;
        return Promise.resolve({ ...current });
      }
      if (url === `/api/tickets/${TICKET_ID}/line-items`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/note-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/unlocks`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/transitions`)
        return Promise.resolve([]);

      if (url === `/api/tickets/${TICKET_ID}/accept` && method === "POST") {
        acceptCalls.push(init?.body ?? null);
        // Server transitions awaiting_acceptance → initiated.
        current = { ...current, status: "initiated" };
        return Promise.resolve({ id: TICKET_ID, status: current.status });
      }
      if (url === `/api/tickets/${TICKET_ID}/deny` && method === "POST") {
        const parsed = init?.body ? JSON.parse(init.body as string) : {};
        denyCalls.push(parsed);
        current = { ...current, status: "denied" };
        return Promise.resolve({ id: TICKET_ID, status: current.status });
      }
      if (url === `/api/tickets/${TICKET_ID}/reinvite` && method === "POST") {
        const parsed = init?.body ? JSON.parse(init.body as string) : {};
        reinviteCalls.push(parsed);
        current = {
          ...current,
          status: "awaiting_acceptance",
          vendorId:
            typeof parsed?.vendorId === "number"
              ? parsed.vendorId
              : current.vendorId,
        };
        return Promise.resolve({ id: TICKET_ID, status: current.status });
      }

      return Promise.reject(new Error(`unexpected url ${method} ${url}`));
    },
  );

  return {
    snapshot: () => ({ ...current }),
    setCurrent: (next: TicketStub) => {
      current = { ...next };
    },
    getTicketGetCount: () => getCalls,
    acceptCalls,
    denyCalls,
    reinviteCalls,
  };
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

const vendor1User = {
  id: 9001,
  username: "v1-admin@example.com",
  role: "vendor",
  vendorId: VENDOR_1_ID,
  displayName: "Vendor 1 Admin",
};

const vendor2User = {
  id: 9002,
  username: "v2-admin@example.com",
  role: "vendor",
  vendorId: VENDOR_2_ID,
  displayName: "Vendor 2 Admin",
};

describe("TicketDetailScreen — vendor accept/deny/reinvite handshake (Task #850)", () => {
  it("happy path: vendor #1 sees the invite banner and Accept transitions the ticket to initiated", async () => {
    getUserMock.mockResolvedValue(vendor1User);
    const api = setupApi(makeTicket());

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    // The vendor invite banner renders with both Accept and Deny.
    const banner = firstByTestId("vendor-invite-banner");
    expect(banner).toBeTruthy();
    expect(firstByTestId("button-accept-invite")).toBeTruthy();
    expect(firstByTestId("button-deny-invite")).toBeTruthy();

    const ticketGetsBefore = api.getTicketGetCount();

    tap(firstByTestId("button-accept-invite"));

    // POST /accept fired exactly once with no body.
    await waitFor(() => {
      expect(api.acceptCalls.length).toBe(1);
    });

    // load() is invoked again after the mutation resolves so the screen
    // re-renders against the new server state.
    await waitFor(() => {
      expect(api.getTicketGetCount()).toBe(ticketGetsBefore + 1);
    });

    // Banner disappears once status leaves awaiting_acceptance.
    await waitFor(() => {
      expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);
    });
    expect(api.snapshot().status).toBe("initiated");

    // Accept is a silent success — no popup blocking the operator.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("deny path: filling the modal & submitting POSTs the reason and transitions the ticket to denied", async () => {
    getUserMock.mockResolvedValue(vendor1User);
    const api = setupApi(makeTicket());

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    // Open the deny modal from the banner.
    expect(firstByTestId("vendor-invite-banner")).toBeTruthy();
    tap(firstByTestId("button-deny-invite"));

    // Modal renders with the reason textarea + the submit button.
    await waitFor(() => {
      expect(firstByTestId("input-deny-reason")).toBeTruthy();
    });
    const reasonInput = firstByTestId("input-deny-reason");
    expect(firstByTestId("button-submit-deny")).toBeTruthy();

    // Submit must NOT POST when the reason is blank — `denyInvite()`
    // short-circuits on an empty trim. (We don't assert against the
    // submit button's `disabled` HTML attribute because react-native-
    // web's TouchableOpacity renders an opacity-gated <div>, not a
    // real <button>; the absence of a /deny POST is the behavioural
    // proof of the empty-reason guard.)
    tap(firstByTestId("button-submit-deny"));
    await Promise.resolve();
    expect(api.denyCalls.length).toBe(0);

    // react-native-web maps multiline TextInput onto a <textarea>; a
    // plain `change` event with the new value is what onChangeText
    // listens for.
    fireEvent.change(reasonInput, {
      target: { value: "  T850 mobile: not available, please reinvite  " },
    });

    const ticketGetsBefore = api.getTicketGetCount();

    tap(firstByTestId("button-submit-deny"));

    // POST /deny fired with the trimmed reason in the body.
    await waitFor(() => {
      expect(api.denyCalls.length).toBe(1);
    });
    expect(api.denyCalls[0]).toEqual({
      reason: "T850 mobile: not available, please reinvite",
    });

    // Reload happened, status flipped to denied.
    await waitFor(() => {
      expect(api.getTicketGetCount()).toBe(ticketGetsBefore + 1);
    });
    expect(api.snapshot().status).toBe("denied");

    // Banner is gone — denied tickets are dead until the partner
    // reinvites a different vendor. (We don't assert on modal
    // unmount: react-native-web's <Modal> hides its children via
    // `display: none` rather than unmounting them, so the textarea
    // is still in the DOM after the mutation. The disappearance of
    // the banner — which is the user-visible end state — is the
    // observable proof the deny succeeded.)
    expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);

    // Deny is a silent success — no popup.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("reinvite path: after the partner reinvites vendor #2, vendor #2 sees the banner addressed to them", async () => {
    // ── Step 1: vendor #1 denies the original invite. ─────────────
    getUserMock.mockResolvedValueOnce(vendor1User);
    const api = setupApi(makeTicket());

    const v1Render = await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(firstByTestId("vendor-invite-banner")).toBeTruthy();
    tap(firstByTestId("button-deny-invite"));
    await waitFor(() => {
      expect(firstByTestId("input-deny-reason")).toBeTruthy();
    });
    fireEvent.change(firstByTestId("input-deny-reason"), {
      target: { value: "T850 mobile: declining, please reinvite" },
    });
    tap(firstByTestId("button-submit-deny"));
    await waitFor(() => {
      expect(api.snapshot().status).toBe("denied");
    });
    v1Render.unmount();
    cleanup();

    // ── Step 2: partner reinvites vendor #2. ──────────────────────
    // Mirror the e2e flow without spinning up the partner web UI: the
    // /reinvite endpoint is the same one the partner-side
    // FindAnotherVendorSheet triggers. We call it through the same
    // apiFetchMock so the in-memory ticket transitions to
    // awaiting_acceptance pinned to vendor #2.
    const reinviteResp = (await apiFetchMock(
      `/api/tickets/${TICKET_ID}/reinvite`,
      {
        method: "POST",
        body: JSON.stringify({ vendorId: VENDOR_2_ID }),
      },
    )) as { id: number; status: string };
    expect(reinviteResp.status).toBe("awaiting_acceptance");
    expect(api.snapshot().vendorId).toBe(VENDOR_2_ID);
    expect(api.reinviteCalls).toEqual([{ vendorId: VENDOR_2_ID }]);

    // ── Step 3: vendor #2 opens the same ticket on mobile. ────────
    getUserMock.mockResolvedValue(vendor2User);

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    // The banner now renders for vendor #2 with both actions, proving
    // the screen re-evaluates the role+vendorId gate against the
    // currently-signed-in user (a vendor whose vendorId no longer
    // matches the ticket would NOT see this banner — the gate at
    // app/ticket/[id].tsx checks `currentUser.vendorId === ticket.vendorId`).
    const v2Banner = firstByTestId("vendor-invite-banner");
    expect(v2Banner).toBeTruthy();
    expect(firstByTestId("button-accept-invite")).toBeTruthy();
    expect(firstByTestId("button-deny-invite")).toBeTruthy();

    // And vendor #2 can now accept end-to-end, closing the loop.
    tap(firstByTestId("button-accept-invite"));
    await waitFor(() => {
      expect(api.acceptCalls.length).toBe(1);
    });
    await waitFor(() => {
      expect(api.snapshot().status).toBe("initiated");
    });
    await waitFor(() => {
      expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);
    });
  });

  it("non-matching vendor: a vendor whose vendorId differs from the ticket's does not see the banner", async () => {
    // Defensive guard for the role+vendorId gate the banner depends on.
    // If a future refactor weakened the check to `role === 'vendor'`
    // alone, vendor #2 would see (and could accept) a ticket pinned to
    // vendor #1 — this assertion catches that regression.
    getUserMock.mockResolvedValue(vendor2User);
    setupApi(makeTicket({ vendorId: VENDOR_1_ID }));

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);
    expect(screen.queryAllByTestId("button-accept-invite").length).toBe(0);
    expect(screen.queryAllByTestId("button-deny-invite").length).toBe(0);
  });
});
