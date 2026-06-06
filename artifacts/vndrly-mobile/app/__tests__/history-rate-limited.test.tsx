import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isElementDisabled } from "../../lib/testDomHelpers";

// Task #762 — verifies the History tab behaves correctly when the
// per-session rate limiter (Task #675) trips on the field endpoints.
// Mirrors the open-tickets rate-limited test from Task #691.
// Two scenarios:
//   1) The screen mounts while a cooldown is already active (e.g. the
//      home tab or the background live-location reporter just tripped
//      a 429). The History tab MUST surface the reconnecting toast
//      instead of silently re-tripping the limiter, and MUST auto-
//      recover when the window expires.
//   2) A 429 lands during a normal load. The reconnecting toast must
//      appear and the manual-refresh button must be disabled so a tap
//      can't immediately re-trip the limiter.

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

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("expo-router", () => ({
  router: {
    push: routerPushMock,
    back: vi.fn(),
    replace: vi.fn(),
  },
  // Render the headerRight element so the test can drive it like any
  // other in-DOM control.
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerRight?: () => React.ReactNode };
    }) => {
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

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "field_employee" } }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  __resetTicketsRateLimitForTests,
  noteTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";

import HistoryScreen from "../history";

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
  routerPushMock.mockReset();
  __resetTicketsRateLimitForTests();
});

describe("HistoryScreen — Task #762 rate-limit gate", () => {
  it("surfaces the reconnecting toast when mounted while a cooldown is already active, then auto-recovers when the window expires", async () => {
    // Pre-arm the shared cooldown to simulate the home tab or
    // background reporter having already tripped a 429 just before
    // the user opened the History tab. Use a short window so the test
    // recovers quickly without fake-timer plumbing.
    noteTicketsRateLimit(makeRateLimitError(1));

    // /api/field/history must NOT be hit while the cooldown is
    // active — otherwise we'd immediately re-trip the limiter on
    // every mount.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets") {
        throw new Error("/api/field/open-tickets must not run during cooldown");
      }
      if (url === "/api/field/history") {
        throw new Error("/api/field/history must not run during cooldown");
      }
      return Promise.resolve(null);
    });

    render(<HistoryScreen />);

    // The reconnecting toast must appear so the user understands the
    // pause instead of seeing a silent loading spinner.
    await waitFor(() => {
      expect(
        screen.queryAllByTestId("toast-tickets-rate-limited").length,
      ).toBeGreaterThan(0);
    });

    // Sanity: the early-exit guard inside `load()` must short-circuit
    // before any /api/field/history call.
    const earlyHistoryCalls = apiFetchMock.mock.calls.filter(
      ([u]) => u === "/api/field/open-tickets" || u === "/api/field/history",
    );
    expect(earlyHistoryCalls.length).toBe(0);

    // Now arm the happy path so when the cooldown expires the
    // recovery effect's load() actually populates the list.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets") return Promise.resolve([]);
      if (url === "/api/field/history") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    // Wait for the cooldown to expire and the recovery effect to
    // fire /api/field/history at least once. The wall-clock window
    // here covers (a) the 1s real-timer cooldown set above, plus
    // (b) the React re-render + recovery effect that re-invokes
    // load(). 8s mirrors the open-tickets test's budget so this
    // assertion stays meaningful even when the full mobile vitest
    // suite runs together and shares a thread pool.
    await waitFor(
      () => {
        expect(
          apiFetchMock.mock.calls.some(
            ([u]) => u === "/api/field/open-tickets" || u === "/api/field/history",
          ),
        ).toBe(true);
      },
      { timeout: 8000 },
    );

    // And the reconnecting toast clears once we're back online.
    await waitFor(() => {
      expect(
        screen.queryAllByTestId("toast-tickets-rate-limited").length,
      ).toBe(0);
    });
  });

  it("shows the reconnecting toast and disables the header refresh button when the shared cooldown arms", async () => {
    // Initial mount: list loads happily so the refresh button is in
    // the DOM and we can assert the disabled flip.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets") return Promise.resolve([]);
      if (url === "/api/field/history") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<HistoryScreen />);

    const button = await screen.findByTestId("button-refresh-history");
    expect(isElementDisabled(button)).toBe(false);
    expect(screen.queryAllByTestId("toast-tickets-rate-limited").length).toBe(
      0,
    );

    // Arm the cooldown manually (simulating the gate hook observing a
    // 429 raised by some other caller — e.g. the home tab or the
    // live-location reporter).
    await act(async () => {
      noteTicketsRateLimit(makeRateLimitError(15));
    });

    // The reconnecting toast must be visible.
    await waitFor(() => {
      expect(
        screen.queryAllByTestId("toast-tickets-rate-limited").length,
      ).toBeGreaterThan(0);
    });

    // And the manual refresh button must be disabled — a tap during
    // cooldown would just re-trip the limiter.
    await waitFor(() => {
      const btn = screen.getByTestId("button-refresh-history");
      expect(isElementDisabled(btn)).toBe(true);
    });
  });
});
