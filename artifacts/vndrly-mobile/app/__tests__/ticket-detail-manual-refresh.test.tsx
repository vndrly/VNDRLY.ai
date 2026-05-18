import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #669: tests cover the manual refresh button on the ticket detail
// screen — the field-side equivalent of the web dispatcher's clickable
// connection pill (Task #667). The header refresh button funnels through
// the same `load()` the auto-refresh and pull-to-refresh use, then
// surfaces a brief "Refreshed" confirmation toast on success.

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
  // Render the headerRight element so the test can drive it like any
  // other in-DOM control. Without this, the refresh button defined via
  // `<Stack.Screen options={{ headerRight: () => ... }} />` would never
  // mount and the test couldn't interact with it.
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

// Task #186: render a recognizable stub for the active-org indicator
// so the composition test below can assert the screen-level
// `headerRight` override still renders it alongside the freshness
// pill and refresh button. Using a stub (instead of the real
// component) avoids having to spin up the AuthProvider here.
vi.mock("@/components/ActiveOrgIndicator", () => {
  const ReactLib = require("react");
  return {
    default: () =>
      ReactLib.createElement("div", { "data-testid": "active-org-indicator" }),
  };
});
vi.mock("@/components/TicketRouteMap", async () => {
  const ReactLib = (await import("react")).default;
  return { TicketRouteMap: () => ReactLib.createElement("div") };
});
vi.mock("@/components/TicketTrackingTimeline", async () => {
  const ReactLib = (await import("react")).default;
  return { TicketTrackingTimeline: () => ReactLib.createElement("div") };
});
// Task #877: the parent now hands `<CrewTimeSection>` an imperative
// handle ref so manual-refresh gestures (pull-to-refresh + header
// button) can drive the same crew + sessions + roster fetch path the
// 60s sync tick uses. The mock registers a `refreshAll` spy on the
// supplied ref so tests can assert the parent invoked it.
const { crewRefreshAllSpy } = vi.hoisted(() => ({
  crewRefreshAllSpy: vi.fn(async () => {}),
}));
vi.mock("@/components/CrewTimeSection", async () => {
  const ReactLib = (await import("react")).default;
  type Handle = { refreshAll: () => Promise<void> };
  type RefObj = { current: Handle | null } | undefined;
  return {
    default: ({ refreshHandleRef }: { refreshHandleRef?: RefObj }) => {
      ReactLib.useEffect(() => {
        if (refreshHandleRef) {
          refreshHandleRef.current = { refreshAll: crewRefreshAllSpy };
        }
        return () => {
          if (refreshHandleRef) refreshHandleRef.current = null;
        };
      }, [refreshHandleRef]);
      return ReactLib.createElement("div");
    },
  };
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

import TicketDetailScreen from "../ticket/[id]";

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

function installHappyApi() {
  apiFetchMock.mockImplementation(
    (url: string, fetchOpts?: { method?: string }) => {
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  crewRefreshAllSpy.mockClear();
  installHappyApi();
});

describe("TicketDetailScreen — Task #669 manual refresh button", () => {
  it("re-fetches the primary ticket queries when the header refresh button is tapped", async () => {
    render(<TicketDetailScreen />);

    // Wait for the screen's mount-time `load()` to settle so the
    // header refresh button is in the DOM.
    const button = await screen.findByTestId("button-refresh-ticket-detail");

    const ticketCallsBefore = apiFetchMock.mock.calls.filter(
      ([u]) => u === `/api/tickets/${TICKET_ID}`,
    ).length;
    expect(ticketCallsBefore).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(button);
    });

    // The header tap must trigger another fetch of the primary ticket
    // resource (and, since `load()` fans out, of line-items / notes /
    // gps-logs / unlocks too — same surface the auto-poll covers).
    await waitFor(() => {
      const after = apiFetchMock.mock.calls.filter(
        ([u]) => u === `/api/tickets/${TICKET_ID}`,
      ).length;
      expect(after).toBeGreaterThan(ticketCallsBefore);
    });
  });

  it("flashes the 'Refreshed' confirmation toast after a successful manual refresh", async () => {
    render(<TicketDetailScreen />);
    const button = await screen.findByTestId("button-refresh-ticket-detail");

    expect(screen.queryAllByTestId("toast-ticket-refreshed").length).toBe(0);

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      const toast = screen.queryAllByTestId("toast-ticket-refreshed")[0];
      expect(toast).toBeTruthy();
      // The toast text key resolves through the identity `t()` mock —
      // we just need to confirm the right key landed in the DOM.
      expect(toast?.textContent || "").toContain("tickets.refreshedToast");
    });
  });

  // Task #186: TicketDetailScreen defines its own `<Stack.Screen
  // options={{ headerRight }} />` cluster (FreshnessPill + refresh
  // button) which OVERRIDES the global root-stack `headerRight` that
  // injects ActiveOrgIndicator. Without composing the indicator into
  // the screen-level override, dual-role users would lose the
  // active-org reminder the moment they push into a ticket — exactly
  // when they're most likely to take a destructive action under the
  // wrong org. This test asserts the override composes all three
  // controls.
  it("composes ActiveOrgIndicator with the freshness pill and refresh button in headerRight", async () => {
    render(<TicketDetailScreen />);
    await screen.findByTestId("button-refresh-ticket-detail");
    expect(screen.getByTestId("active-org-indicator")).toBeTruthy();
    expect(screen.getByTestId("ticket-detail-freshness-pill")).toBeTruthy();
    expect(screen.getByTestId("button-refresh-ticket-detail")).toBeTruthy();
  });

  it("does NOT show the 'Refreshed' toast when the manual refresh fails", async () => {
    render(<TicketDetailScreen />);
    const button = await screen.findByTestId("button-refresh-ticket-detail");

    // After the screen loads happily, swap the API to fail the next
    // primary ticket fetch so the manual refresh's `load()` returns
    // false.
    apiFetchMock.mockImplementation(
      (url: string, fetchOpts?: { method?: string }) => {
        if (fetchOpts?.method && fetchOpts.method !== "GET") {
          return Promise.reject(new Error(`unexpected ${fetchOpts.method} ${url}`));
        }
        if (url === `/api/tickets/${TICKET_ID}`) {
          return Promise.reject(new Error("network down"));
        }
        if (url.startsWith("/api/tickets/")) return Promise.resolve([]);
        if (url === `/api/site-locations/50`) {
          return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
        }
        if (url.startsWith("/api/tax-rates/")) {
          return Promise.resolve({ state: "TX", rate: "0" });
        }
        return Promise.resolve(null);
      },
    );

    await act(async () => {
      fireEvent.click(button);
    });

    // Give the failed promise time to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("toast-ticket-refreshed").length).toBe(0);
  });
});

describe("TicketDetailScreen — Task #877 manual crew refresh", () => {
  it("invokes the CrewTimeSection refresh handle when the header refresh button is tapped", async () => {
    render(<TicketDetailScreen />);
    const button = await screen.findByTestId("button-refresh-ticket-detail");

    // The mock registers `refreshAll` on the supplied ref during its
    // mount-time effect, so by the time the header button is on screen
    // the handle is wired. Clearing the spy here scopes the assertion
    // to the upcoming tap (the registration itself doesn't call it).
    crewRefreshAllSpy.mockClear();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(crewRefreshAllSpy).toHaveBeenCalledTimes(1);
    });
  });

  // The header refresh test above already proves the manual-refresh
  // integration end-to-end: the parent's CrewTimeSection ref points
  // at the child's registered `refreshAll`, and a manual-refresh
  // gesture invokes it. The pull-to-refresh handler (`onRefresh` on
  // the ScrollView's RefreshControl) is a tiny wrapper around the
  // same `Promise.all([load(), crewHandleRef.current?.refreshAll()])`
  // call as the header button — only the busy-flag setter differs.
  // Wiring up a separate test through the JSDOM RefreshControl host
  // requires either mocking react-native (which strips ScrollView's
  // children in this harness) or fiber-walking through react-native-
  // web internals; neither buys us additional coverage over the
  // header-button test, so we deliberately stop here.
});
