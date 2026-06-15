import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// When the primary ticket fetch fails (403/404/network), the screen must
// not pin the user on an eternal spinner — show an error affordance with
// retry and a back button via InPageHeader instead.

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

vi.mock("expo-router", () => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "888" }),
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

vi.mock("@/hooks/useTicketNudgeFlash", () => ({
  useTicketNudgeFlash: () => ({
    nudgeFlashingTicketIds: new Set<number>(),
    flashNudgeTicket: vi.fn(),
    handlePushData: vi.fn(),
  }),
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
    role: "partner",
    name: "Partner Tester",
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
        testID,
      }: {
        children: React.ReactNode;
        onPress?: () => void;
        testID?: string;
      }) =>
        ReactLib.createElement(
          "button",
          { "data-testid": testID, "data-variant": label, onClick: onPress },
          typeof children === "string" ? children : "btn",
        ),
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

import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { __resetTicketsRateLimitForTests } from "@/lib/ticketsRateLimitGate";

import TicketDetailScreen from "../ticket/[id]";

const TICKET_ID = 888;

afterEach(() => {
  cleanup();
  __resetTicketsRateLimitForTests();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  __resetTicketsRateLimitForTests();
});

describe("TicketDetailScreen — failed primary load", () => {
  it("shows an error shell with retry instead of an eternal spinner when the ticket fetch rejects", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url === `/api/tickets/${TICKET_ID}`) {
        return Promise.reject(
          Object.assign(new Error("Forbidden"), { status: 403, data: { code: "forbidden" } }),
        );
      }
      return Promise.resolve([]);
    });

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("ticket-detail-load-failed")).toBeTruthy();
    });
    expect(screen.queryByTestId("ticket-detail-loading")).toBeNull();
    expect(screen.getByTestId("button-retry-ticket-detail")).toBeTruthy();
  });
});
