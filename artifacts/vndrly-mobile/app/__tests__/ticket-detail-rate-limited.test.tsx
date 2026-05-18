import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #686 — verifies the ticket detail screen behaves correctly when
// the per-session rate limiter (Task #675) trips. Two scenarios:
//   1) The screen mounts while a cooldown is already active (e.g. the
//      background live-location reporter just got 429'd). The screen
//      MUST NOT get stuck on a silent spinner — it must surface the
//      reconnecting affordance so the user understands the pause.
//   2) A 429 lands during a normal load. The screen must show the
//      reconnecting toast and disable the manual refresh button so a
//      tap can't immediately re-trip the limiter.

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
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) => {
      const right = options?.headerRight?.();
      const ReactLib = require("react");
      return ReactLib.createElement(
        "div",
        { "data-testid": "stack-header-right" },
        right ?? null,
      );
    },
  },
  useLocalSearchParams: () => ({ id: "777" }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => cb(), [cb]);
  },
}));

const tIdentity = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
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

vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
}));

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

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  __resetTicketsRateLimitForTests,
  noteTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";

import TicketDetailScreen from "../ticket/[id]";

const TICKET_ID = 777;

function makeRateLimitError(retryAfterSeconds = 12) {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: { code: "tickets.rate_limited", retryAfterSeconds },
  });
}

afterEach(() => {
  cleanup();
  __resetTicketsRateLimitForTests();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  __resetTicketsRateLimitForTests();
});

describe("TicketDetailScreen — Task #686 rate-limit gate", () => {
  it("surfaces the reconnecting affordance when mounted while a cooldown is already active, then auto-recovers when the window expires", async () => {
    // The background reporter just tripped a 429 before the user
    // navigated to this screen. Pre-arm the shared cooldown to
    // simulate that state. Use a short window so the test recovers
    // quickly without fake-timer plumbing (the hook + module both
    // honor the deadline rather than any setTimeout count).
    noteTicketsRateLimit(makeRateLimitError(1));

    // apiFetch should NOT be called while parked. We swap to the
    // happy path right before the cooldown expires below.
    apiFetchMock.mockImplementation((url: string) => {
      throw new Error(`apiFetch should not run during cooldown: ${url}`);
    });

    render(<TicketDetailScreen />);

    // The reconnecting toast must appear instead of a silent spinner.
    await waitFor(() => {
      expect(screen.queryAllByTestId("toast-ticket-rate-limited").length).toBeGreaterThan(0);
    });
    // Sanity: the early-exit guard inside `load()` must short-circuit
    // before any apiFetch call — otherwise we'd immediately re-trip
    // the limiter on every mount.
    expect(apiFetchMock).not.toHaveBeenCalled();

    // Now arm the happy-path API so when the cooldown expires the
    // recovery effect's load() actually populates the screen.
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
    apiFetchMock.mockImplementation((url: string) => {
      if (url === `/api/tickets/${TICKET_ID}`) return Promise.resolve(TICKET);
      if (url.startsWith(`/api/tickets/${TICKET_ID}/`)) return Promise.resolve([]);
      if (url === `/api/site-locations/50`) {
        return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
      }
      if (url.startsWith("/api/tax-rates/")) {
        return Promise.resolve({ state: "TX", rate: "0" });
      }
      return Promise.resolve(null);
    });

    // Wait for the cooldown to expire and the recovery effect to fire.
    // This is the regression guard: without the recovery effect the
    // screen would stay on the spinner forever after expiry.
    await waitFor(
      () => {
        expect(
          apiFetchMock.mock.calls.some(([u]) => u === `/api/tickets/${TICKET_ID}`),
        ).toBe(true);
      },
      { timeout: 3000 },
    );

    // And the screen actually renders the ticket — the refresh button
    // (only mounted in the loaded branch) is in the DOM and enabled.
    await waitFor(() => {
      const btn = screen.queryByTestId("button-refresh-ticket-detail") as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      expect(btn?.disabled).toBe(false);
    });
  });

  it("shows the reconnecting toast and disables the header refresh button when apiFetch rejects with a 429 during a manual refresh", async () => {
    // Task #692 — end-to-end coverage of the gate's *real* trigger
    // path: an `apiFetch` rejection. Task #686 already verified the
    // shared cooldown by calling `noteTicketsRateLimit` directly, but
    // that bypasses the load() try/catch + setLoadError + hook-effect
    // chain that the production code actually walks. Driving the
    // mocked `apiFetch` lets us catch regressions where load() stops
    // funneling 429s into setLoadError, or where the screen forgets
    // to re-render the toast / disable the refresh button when the
    // hook flips `rateLimited` to true.
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
    function happyApi(url: string) {
      if (url === `/api/tickets/${TICKET_ID}`) return Promise.resolve(TICKET);
      if (url.startsWith(`/api/tickets/${TICKET_ID}/`)) return Promise.resolve([]);
      if (url === `/api/site-locations/50`) {
        return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
      }
      if (url.startsWith("/api/tax-rates/")) {
        return Promise.resolve({ state: "TX", rate: "0" });
      }
      return Promise.resolve(null);
    }
    apiFetchMock.mockImplementation(happyApi);

    render(<TicketDetailScreen />);

    // Wait for the initial load() so the loaded branch (with the
    // header refresh button) is mounted.
    const button = await screen.findByTestId("button-refresh-ticket-detail");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    // Pre-condition: no rate-limit toast on a happy screen.
    expect(screen.queryAllByTestId("toast-ticket-rate-limited").length).toBe(0);

    // Now swap the mock so the next primary ticket fetch rejects with
    // the exact error shape the server (Task #675) returns: HTTP 429
    // + structured body that the rate-limit gate parser recognizes.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === `/api/tickets/${TICKET_ID}`) {
        return Promise.reject(makeRateLimitError(15));
      }
      return happyApi(url);
    });

    // Tap the header refresh button. This funnels through the same
    // `load()` the auto-poll uses, hits the catch block, and feeds
    // the 429 into both `noteTicketsRateLimit` (shared cooldown) and
    // `setLoadError` (hook input).
    await act(async () => {
      fireEvent.click(button);
    });

    // The reconnecting toast must appear — proves the gate hook saw
    // the 429 via the loadError path (not via a direct module poke).
    await waitFor(() => {
      expect(screen.queryAllByTestId("toast-ticket-rate-limited").length).toBeGreaterThan(0);
    });

    // And the header refresh button must be disabled so a follow-up
    // tap can't immediately re-trip the limiter.
    await waitFor(() => {
      const btn = screen.getByTestId("button-refresh-ticket-detail") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it("shows the reconnecting toast and disables the header refresh button when load() returns 429", async () => {
    // Initial mount: ticket loads happily so the screen renders the
    // full UI (we need the refresh button in the DOM).
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
    apiFetchMock.mockImplementation((url: string) => {
      if (url === `/api/tickets/${TICKET_ID}`) return Promise.resolve(TICKET);
      if (url.startsWith(`/api/tickets/${TICKET_ID}/`)) return Promise.resolve([]);
      if (url === `/api/site-locations/50`) {
        return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
      }
      if (url.startsWith("/api/tax-rates/")) {
        return Promise.resolve({ state: "TX", rate: "0" });
      }
      return Promise.resolve(null);
    });

    render(<TicketDetailScreen />);

    const button = await screen.findByTestId("button-refresh-ticket-detail");
    expect((button as HTMLButtonElement).disabled).toBe(false);

    // Now arm the cooldown manually (simulating the gate hook
    // observing a 429 from any caller). The hook's subscriber should
    // pick up the change and re-render with `rateLimited=true`.
    await act(async () => {
      noteTicketsRateLimit(makeRateLimitError(15));
    });

    // The reconnecting toast must be visible.
    await waitFor(() => {
      expect(screen.queryAllByTestId("toast-ticket-rate-limited").length).toBeGreaterThan(0);
    });

    // And the manual refresh button must be disabled — a tap during
    // cooldown would just re-trip the limiter.
    await waitFor(() => {
      const btn = screen.getByTestId("button-refresh-ticket-detail") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
