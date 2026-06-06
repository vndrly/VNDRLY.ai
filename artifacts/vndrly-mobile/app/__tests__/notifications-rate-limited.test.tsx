import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #699 — verify the notifications screen surfaces the friendly
// slow-down banner when /api/notifications returns 429 with code
// "notifications.rate_limited", and that pull-to-refresh during the
// active cooldown is a no-op so a finger-mash gesture can't reset
// the user's window. The banner copy IS the user-visible signal here
// (mobile has no LiveConnectionPill on this screen), so a regression
// in either the gate wiring or the banner render would silently leave
// the field employee staring at a stale list with no explanation.

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
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  Stack: { Screen: () => null },
}));

import enLocale from "../../lib/locales/en.json";
function lookup(key: string): string {
  const parts = key.split(".");
  let cur: unknown = enLocale as unknown;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
}
const tIdentity = (k: string, vars?: Record<string, unknown>) => {
  let out = lookup(k);
  if (vars && typeof vars === "object") {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replace(new RegExp(`{{\\s*${name}\\s*}}`, "g"), String(value));
    }
  }
  return out;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

// react-native's RefreshControl doesn't expose its onRefresh as a
// clickable affordance in the testing-library DOM, so we shim it to a
// `<button data-testid="refresh-control" />` that calls the same
// handler. That lets us simulate a pull-to-refresh from the test.
vi.mock("react-native", async () => {
  const actual = await vi.importActual<typeof import("react-native")>(
    "react-native",
  );
  const ReactLib = (await import("react")).default;
  return {
    ...actual,
    RefreshControl: ({
      refreshing,
      onRefresh,
    }: {
      refreshing: boolean;
      onRefresh: () => void;
    }) =>
      ReactLib.createElement("button", {
        "data-testid": "refresh-control",
        "data-refreshing": refreshing ? "true" : "false",
        onClick: onRefresh,
      }),
  };
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import NotificationsScreen from "../notifications";
import { __resetRateLimitForTests } from "../../lib/rateLimitGate";

beforeEach(() => {
  __resetRateLimitForTests();
  apiFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  __resetRateLimitForTests();
});

function rateLimit429(retryAfterSeconds = 8): Error {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: {
      error: "rate_limited",
      code: "notifications.rate_limited",
      retryAfterSeconds,
    },
  });
}

describe("NotificationsScreen — Task #699 rate-limit slow-down", () => {
  it("renders the slow-down banner when the load 429s with the matching code", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/notifications") return Promise.reject(rateLimit429(15));
      return Promise.resolve(null);
    });

    render(<NotificationsScreen />);

    await waitFor(() => {
      // The banner is the sole user-visible slow-down signal on this
      // screen — assert it mounts AND that the friendly retry-in copy
      // landed (the parser rounds up, so we expect 15s exactly).
      const banner = screen.getByTestId("notifications-slow-down-banner");
      expect(banner.textContent || "").toContain("Slowing down");
      expect(banner.textContent || "").toContain("15");
    });
  });

  it("ignores cross-resource 429s — a comments rate_limited error must not park the bell", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/notifications") {
        return Promise.reject(
          Object.assign(new Error("Too Many Requests"), {
            status: 429,
            data: {
              code: "comments.rate_limited",
              retryAfterSeconds: 30,
            },
          }),
        );
      }
      return Promise.resolve(null);
    });

    render(<NotificationsScreen />);

    // Give the rejected promise + state set time to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(
      screen.queryByTestId("notifications-slow-down-banner"),
    ).toBeNull();
  });

  it("ignores pull-to-refresh while the cooldown is active so the limiter window isn't reset", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/notifications") return Promise.reject(rateLimit429(20));
      return Promise.resolve(null);
    });

    render(<NotificationsScreen />);

    await waitFor(() => {
      expect(
        screen.getByTestId("notifications-slow-down-banner"),
      ).toBeTruthy();
    });

    const callsBeforeRefresh = apiFetchMock.mock.calls.filter(
      ([u]) => u === "/api/notifications",
    ).length;

    const refresh = await screen.findByTestId("refresh-control");
    await act(async () => {
      fireEvent.click(refresh);
    });
    // Give any erroneously-issued fetch a chance to land.
    await new Promise((r) => setTimeout(r, 30));

    const callsAfterRefresh = apiFetchMock.mock.calls.filter(
      ([u]) => u === "/api/notifications",
    ).length;
    // The whole point: pull-to-refresh during cooldown must NOT issue
    // another /api/notifications fetch, otherwise the user can keep
    // resetting their own slow-down window with one finger.
    expect(callsAfterRefresh).toBe(callsBeforeRefresh);
  });
});
