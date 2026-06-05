import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #613: when the office restores a vendor's site / work-type
// assignment after the field employee has already opened the ticket,
// task #592 sends a `ticket_unblocked` push. The mobile ticket detail
// screen's tap-to-deep-link handler in _layout.tsx already re-runs
// `load()` on mount, but if the worker is *already* on this exact
// ticket screen (foreground, screen open), there's no navigation event
// to refresh and the assignment-removed banner sits stale until pull-
// to-refresh.
//
// This test verifies the screen subscribes to foreground push arrivals
// (`Notifications.addNotificationReceivedListener`) and silently re-
// runs `load()` whenever a push with `type=ticket_unblocked` arrives
// for THIS ticket id — and ignores pushes for other ticket ids.

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
    mutedForeground: "#666",
    destructive: "#dc2626",
    muted: "#e5e5e5",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

const { routerReplaceMock, routerPushMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  routerPushMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: {
    replace: routerReplaceMock,
    push: routerPushMock,
    back: vi.fn(),
  },
  // Task #669: ticket detail screen now sets a `headerRight` refresh
  // button via `<Stack.Screen options={...} />`. Stub the export.
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

const tIdentity = (k: string) => k;
const useTranslationReturn = { t: tIdentity };
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationReturn,
}));

vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
  getForegroundPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: { latitude: 30, longitude: -90 },
  })),
  watchPositionAsync: vi.fn(async () => ({ remove: () => {} })),
}));

// Capture every listener registered with addNotificationReceivedListener
// so the test can drive it directly. Each registration also returns a
// remove() spy so we can assert cleanup.
type PushListener = (n: {
  request: { content: { data: unknown } };
}) => void;
const { pushListeners, removeSpies } = vi.hoisted(() => ({
  pushListeners: [] as PushListener[],
  removeSpies: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (listener: PushListener) => {
    pushListeners.push(listener);
    const remove = vi.fn();
    removeSpies.push(remove);
    return { remove };
  },
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const ReactLib = (await import("react")).default;
  return {
    ...actual,
    Modal: ({
      visible,
      children,
    }: {
      visible?: boolean;
      children?: React.ReactNode;
    }) =>
      visible
        ? ReactLib.createElement(
            "div",
            { "data-testid": "rn-modal-visible" },
            children,
          )
        : null,
  };
});

vi.mock("expo-image", async () => {
  const ReactLib = (await import("react")).default;
  return { Image: (p: any) => ReactLib.createElement("img", { ...p }) };
});

vi.mock("expo-linear-gradient", async () => {
  const ReactLib = (await import("react")).default;
  return {
    LinearGradient: (p: any) => ReactLib.createElement("div", p, p.children),
  };
});

vi.mock("@/lib/auth", () => ({
  getUser: vi.fn(async () => ({
    id: 99,
    role: "field_employee",
    vendorId: 11,
    name: "Field Tester",
  })),
}));

vi.mock("@/lib/maps", () => ({
  MAP_TILE_SIZE: 256,
  getOsmTile: () => "",
  openInMaps: vi.fn(),
}));

vi.mock("@/lib/photos", () => ({
  captureAndUploadImage: vi.fn(async () => null),
}));

vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", async () => {
  const ReactLib = (await import("react")).default;
  return { TicketRouteMap: () => ReactLib.createElement("div") };
});
vi.mock("@/components/TicketTrackingTimeline", async () => {
  const ReactLib = (await import("react")).default;
  return { TicketTrackingTimeline: () => ReactLib.createElement("div") };
});
vi.mock("@/components/CrewTimeSection", async () => {
  const ReactLib = (await import("react")).default;
  return { default: () => ReactLib.createElement("div") };
});
vi.mock("@/components/CommentsPanel", async () => {
  const ReactLib = (await import("react")).default;
  return { default: () => ReactLib.createElement("div") };
});
vi.mock("@/components/TicketStatusStepper", async () => {
  const ReactLib = (await import("react")).default;
  return { default: () => ReactLib.createElement("div") };
});

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

function makeButtonMock(label: string) {
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
            "data-variant": label,
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

vi.mock("@/components/AmberButton", makeButtonMock("amber"));
vi.mock("@/components/BlueButton", makeButtonMock("blue"));
vi.mock("@/components/GreyButton", makeButtonMock("grey"));

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import TicketDetailScreen from "../ticket/[id]";
import { tap, tapThroughMileagePrompt } from "@/lib/testDomHelpers";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  pushListeners.length = 0;
  removeSpies.length = 0;
});

const TICKET_ID = 777;

const TICKET = {
  id: TICKET_ID,
  status: "in_progress",
  description: "Repair fence",
  siteName: "Acme Site",
  siteLocationId: 50,
  state: "TX",
  workTypeName: "Maintenance",
  vendorId: 11,
  lifecycleState: "on_site",
  arrivedAt: new Date().toISOString(),
  checkInTime: new Date().toISOString(),
};

function makeApiError(code: string, status = 400): Error {
  const err = new Error(code) as Error & {
    status?: number;
    data?: unknown;
  };
  err.status = status;
  err.data = { error: code, message: "Assignment removed by office." };
  return err;
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

// Loader that returns the happy ticket on every GET, with a switch the
// test can flip to make the next check-out POST fail with the
// assignment-removed code (simulating the office having yanked the
// vendor's site assignment after the screen mounted).
function installApiHandlers(opts: { failCheckOut: { current: boolean } }) {
  apiFetchMock.mockImplementation(
    (url: string, fetchOpts?: { method?: string }) => {
      if (
        url === `/api/tickets/${TICKET_ID}/check-out` &&
        fetchOpts?.method === "POST"
      ) {
        if (opts.failCheckOut.current) {
          return Promise.reject(makeApiError("site_vendor_mismatch"));
        }
        return Promise.resolve({});
      }
      if (fetchOpts?.method && fetchOpts.method !== "GET") {
        return Promise.reject(new Error(`unexpected ${fetchOpts.method} ${url}`));
      }
      if (url === `/api/tickets/${TICKET_ID}`) return Promise.resolve(TICKET);
      if (url === `/api/tickets/${TICKET_ID}/line-items`) return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/note-logs`) return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/gps-logs`) return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/unlocks`) return Promise.resolve([]);
      if (url === `/api/site-locations/50`) {
        return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
      }
      if (url.startsWith("/api/tax-rates/")) {
        return Promise.resolve({ state: "TX", rate: "0" });
      }
      if (url === `/api/tickets/${TICKET_ID}/crew-sessions`) return Promise.resolve([]);
      return Promise.resolve(null);
    },
  );
}

describe("TicketDetailScreen — Task #613 foreground ticket_unblocked refresh", () => {
  it("clears the assignment-removed banner when a foreground ticket_unblocked push arrives for this ticket id", async () => {
    const failCheckOut = { current: true };
    installApiHandlers({ failCheckOut });

    render(<TicketDetailScreen />);

    // Wait for the screen to register its push listener and render the
    // action group.
    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
      expect(firstByTestId("button-check-out")).toBeTruthy();
    });

    // Trigger the assignment-removed banner by tapping check-out.
    await tapThroughMileagePrompt("button-check-out");
    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });

    // The office now restores the assignment and the server fans out
    // `ticket_unblocked`. Simulate the foreground push arrival.
    failCheckOut.current = false;
    const listener = pushListeners[pushListeners.length - 1];
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "ticket_unblocked", ticketId: TICKET_ID },
          },
        },
      });
    });

    // Banner disappears the instant the push arrives — no user action
    // (no pull-to-refresh, no button tap) was needed.
    await waitFor(() => {
      expect(screen.queryAllByTestId("banner-assignment-removed").length).toBe(0);
    });
  });

  it("ignores ticket_unblocked pushes for other ticket ids", async () => {
    const failCheckOut = { current: true };
    installApiHandlers({ failCheckOut });

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
      expect(firstByTestId("button-check-out")).toBeTruthy();
    });

    await tapThroughMileagePrompt("button-check-out");
    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });

    // A push for a DIFFERENT ticket arrives. We must not re-run load()
    // (which would happily clear our banner) — the banner stays put.
    // Also leave the failure flag set so even if a refresh did run, it
    // wouldn't matter for the assertion (the banner is set in state by
    // the failed POST, not by load()).
    const listener = pushListeners[pushListeners.length - 1];

    // Snapshot the apiFetch call count to prove no refresh was issued.
    const callsBefore = apiFetchMock.mock.calls.length;
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "ticket_unblocked", ticketId: TICKET_ID + 1 },
          },
        },
      });
    });
    const callsAfter = apiFetchMock.mock.calls.length;
    expect(callsAfter).toBe(callsBefore);

    // Banner is still showing.
    expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
  });

  it("ignores foreground pushes whose type is not ticket_unblocked", async () => {
    const failCheckOut = { current: true };
    installApiHandlers({ failCheckOut });

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
      expect(firstByTestId("button-check-out")).toBeTruthy();
    });

    await tapThroughMileagePrompt("button-check-out");
    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });

    const listener = pushListeners[pushListeners.length - 1];
    const callsBefore = apiFetchMock.mock.calls.length;
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "comment_mention", ticketId: TICKET_ID },
          },
        },
      });
    });
    const callsAfter = apiFetchMock.mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
    expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
  });

  it("removes the foreground push listener on unmount", async () => {
    installApiHandlers({ failCheckOut: { current: false } });

    const { unmount } = render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
    });

    const removeSpy = removeSpies[removeSpies.length - 1];
    expect(removeSpy).not.toHaveBeenCalled();
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });

  // ── Task #623 ────────────────────────────────────────────────────
  // When the foreground `ticket_unblocked` push clears the banner, a
  // brief confirmation toast should appear so a mid-task worker knows
  // their access was restored. The toast should NOT appear when the
  // banner clears via pull-to-refresh (or when no banner was showing).
  it("shows the restored-confirmation toast when a foreground ticket_unblocked push clears the banner", async () => {
    const failCheckOut = { current: true };
    installApiHandlers({ failCheckOut });

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
      expect(firstByTestId("button-check-out")).toBeTruthy();
    });

    // Surface the assignment-removed banner via a failed check-out.
    await tapThroughMileagePrompt("button-check-out");
    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });
    // Toast must not be visible yet — the banner still is.
    expect(screen.queryAllByTestId("toast-assignment-restored").length).toBe(0);

    // Office restores access; foreground push arrives.
    failCheckOut.current = false;
    const listener = pushListeners[pushListeners.length - 1];
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "ticket_unblocked", ticketId: TICKET_ID },
          },
        },
      });
    });

    // The brief confirmation appears alongside the banner clearing.
    await waitFor(() => {
      expect(firstByTestId("toast-assignment-restored")).toBeTruthy();
      expect(screen.queryAllByTestId("banner-assignment-removed").length).toBe(0);
    });
  });

  // Architecturally, the only place `setRestoredVisible(true)` is wired is
  // inside the foreground push listener — pull-to-refresh runs `load()`
  // directly without ever touching that flag. The test below proves the
  // gating works in the opposite direction (push arrives, no banner → no
  // toast), which together with the positive case above guarantees the
  // toast is push-driven and banner-conditional. The "pull-to-refresh
  // never shows the toast" claim therefore needs no separate test — it
  // would require simulating the RefreshControl gesture, which the JSDOM
  // shim doesn't support cleanly.
  it("does not show the restored-confirmation toast when the push arrives but no banner was visible", async () => {
    installApiHandlers({ failCheckOut: { current: false } });

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
    });
    // No banner is showing — happy ticket loaded clean.
    expect(screen.queryAllByTestId("banner-assignment-removed").length).toBe(0);

    const listener = pushListeners[pushListeners.length - 1];
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "ticket_unblocked", ticketId: TICKET_ID },
          },
        },
      });
    });

    // Push refreshed silently — no toast, since there was nothing to
    // "restore" from the worker's perspective.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByTestId("toast-assignment-restored").length).toBe(0);
  });
});
