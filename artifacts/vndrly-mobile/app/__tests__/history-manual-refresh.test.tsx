import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #679: tests cover the manual refresh button on the field
// employee history screen — the field-side equivalent of the open
// tickets list refresh shipped in Task #669. The header refresh button
// funnels through the same `load()` the pull-to-refresh uses, then
// surfaces a brief "Refreshed" confirmation toast on success.

// Task #186: render a recognizable stub for the active-org indicator
// so the composition test below can assert the screen-level
// `headerRight` override still renders it alongside the refresh
// button. Using a stub (instead of the real component) avoids having
// to spin up the AuthProvider for every test.
vi.mock("@/components/ActiveOrgIndicator", () => {
  const ReactLib = require("react");
  return {
    default: () =>
      ReactLib.createElement("div", { "data-testid": "active-org-indicator" }),
  };
});

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

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: {
    push: routerPushMock,
    back: vi.fn(),
    replace: vi.fn(),
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
}));

const tIdentity = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
}));

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

import HistoryScreen from "../history";

const HISTORY = [
  {
    id: 101,
    status: "closed",
    siteName: "Acme Site",
    partnerName: "Acme Co",
    workTypeName: "Maintenance",
    checkOutTime: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  routerPushMock.mockReset();
  apiFetchMock.mockImplementation((url: string) => {
    if (url === "/api/field/history") return Promise.resolve(HISTORY);
    return Promise.resolve(null);
  });
});

describe("HistoryScreen — Task #679 manual refresh button", () => {
  it("re-fetches /api/field/history when the header refresh button is tapped", async () => {
    render(<HistoryScreen />);

    // Wait for the screen's mount-time `load()` to settle so the
    // header refresh button is in the DOM.
    const button = await screen.findByTestId("button-refresh-history");

    const callsBefore = apiFetchMock.mock.calls.filter(
      ([u]) => u === "/api/field/history",
    ).length;
    expect(callsBefore).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(button);
    });

    // The header tap must trigger another fetch of the history
    // resource — same surface the pull-to-refresh covers.
    await waitFor(() => {
      const after = apiFetchMock.mock.calls.filter(
        ([u]) => u === "/api/field/history",
      ).length;
      expect(after).toBeGreaterThan(callsBefore);
    });
  });

  it("flashes the 'Refreshed' confirmation toast after a successful manual refresh", async () => {
    render(<HistoryScreen />);
    const button = await screen.findByTestId("button-refresh-history");

    expect(screen.queryAllByTestId("toast-history-refreshed").length).toBe(0);

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      const toast = screen.queryAllByTestId("toast-history-refreshed")[0];
      expect(toast).toBeTruthy();
      // The toast text key resolves through the identity `t()` mock —
      // we just need to confirm the right key landed in the DOM.
      expect(toast?.textContent || "").toContain("tickets.refreshedToast");
    });
  });

  // Task #186: HistoryScreen defines its own `<Stack.Screen
  // options={{ headerRight }} />` which OVERRIDES the global
  // root-stack `headerRight` that injects ActiveOrgIndicator. Without
  // composing the indicator into the screen-level override, dual-role
  // users would lose the active-org reminder the moment they push into
  // History — exactly when they're most likely to take a destructive
  // action under the wrong org. This test asserts the override
  // composes both controls.
  it("composes ActiveOrgIndicator with the existing refresh button in headerRight", async () => {
    render(<HistoryScreen />);
    await screen.findByTestId("button-refresh-history");
    // The active-org indicator must be rendered as part of the same
    // header-right cluster as the refresh button.
    expect(screen.getByTestId("active-org-indicator")).toBeTruthy();
    expect(screen.getByTestId("button-refresh-history")).toBeTruthy();
  });

  it("does NOT show the 'Refreshed' toast when the manual refresh fails", async () => {
    render(<HistoryScreen />);
    const button = await screen.findByTestId("button-refresh-history");

    // After the screen loads happily, swap the API to fail the next
    // history fetch so the manual refresh's `load()` returns false.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/history") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      fireEvent.click(button);
    });

    // Give the failed promise time to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("toast-history-refreshed").length).toBe(0);
  });
});
