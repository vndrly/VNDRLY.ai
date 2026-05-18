import path from "node:path";
import Module from "node:module";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #691 — verifies the home/dashboard tab behaves correctly when
// the per-session rate limiter (Task #675) trips on the field
// endpoints. Mirrors the ticket-detail rate-limited test (Task #686).
// Two scenarios:
//   1) The screen mounts while a cooldown is already active (e.g. the
//      background live-location reporter or the detail screen just
//      tripped a 429). The home tab MUST surface the reconnecting
//      affordance instead of silently re-tripping the limiter, and
//      MUST auto-recover when the window expires.
//   2) A 429 lands during a normal load. The reconnecting toast must
//      appear and the manual-refresh button must be disabled so a
//      tap can't immediately re-trip the limiter.

// The home screen brand logo uses an inline `require("@/assets/...png")`.
// Mirror the alias + .png stub from the manual-refresh test so vitest
// can resolve the asset without parsing it.
const ASSETS_ROOT = path.resolve(__dirname, "..", "..");
const _Module = Module as unknown as {
  _resolveFilename: (
    request: string,
    parent: NodeModule,
    ...rest: unknown[]
  ) => string;
  _extensions: Record<string, (m: { exports: unknown }, f: string) => void>;
};
const origResolve = _Module._resolveFilename.bind(_Module);
_Module._resolveFilename = (request, parent, ...rest) => {
  if (request.startsWith("@/")) {
    return path.join(ASSETS_ROOT, request.slice(2));
  }
  return origResolve(request, parent, ...rest);
};
_Module._extensions[".png"] = (m, filename) => {
  m.exports = filename;
};

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
vi.mock("expo-router", () => {
  const useFocusEffect = (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
    }, [cb]);
  };
  return {
    router: { push: routerPushMock, replace: vi.fn(), back: vi.fn() },
    useFocusEffect,
  };
});

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

vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
}));

vi.mock("@/lib/push", () => ({
  registerForPushNotifications: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 99, role: "field_employee", displayName: "Field Tester" },
    activeMembership: { orgName: "Acme Vendor", orgType: "vendor" },
  }),
}));

vi.mock("@/components/AmberButton", async () => {
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
        { "data-testid": testID, onClick: onPress },
        typeof children === "string" ? children : "btn",
      ),
  };
});

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

import HomeScreen from "../(tabs)/index";

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

describe("HomeScreen — Task #691 rate-limit gate", () => {
  it("surfaces the reconnecting toast when mounted while a cooldown is already active, then auto-recovers when the window expires", async () => {
    // Pre-arm the shared cooldown to simulate the background reporter
    // having already tripped a 429 just before the user opened this
    // tab. Use a short window so the test recovers quickly without
    // fake-timer plumbing.
    noteTicketsRateLimit(makeRateLimitError(1));

    // /api/field/open-tickets must NOT be hit while the cooldown is
    // active. Other endpoints (notifications, /api/field/me) are on
    // different limiters and may still be called.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets") {
        throw new Error("/api/field/open-tickets must not run during cooldown");
      }
      if (url === "/api/field/history") {
        throw new Error("/api/field/history must not run during cooldown");
      }
      if (url === "/api/notifications/unread-count")
        return Promise.resolve({ count: 0 });
      if (url === "/api/field/me")
        return Promise.resolve({ vendorName: "Acme Vendor" });
      return Promise.resolve(null);
    });

    render(<HomeScreen />);

    // The reconnecting toast must appear so the user understands the
    // pause instead of seeing a silent empty list.
    await waitFor(() => {
      expect(
        screen.queryAllByTestId("toast-tickets-rate-limited").length,
      ).toBeGreaterThan(0);
    });

    // Sanity: the early-exit guard inside `load()` must short-circuit
    // before any /api/field/open-tickets call — otherwise we'd
    // immediately re-trip the limiter on every mount.
    const earlyOpenCalls = apiFetchMock.mock.calls.filter(
      ([u]) => u === "/api/field/open-tickets",
    );
    expect(earlyOpenCalls.length).toBe(0);

    // Now arm the happy path so when the cooldown expires the
    // recovery effect's load() actually populates the list.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets")
        return Promise.resolve([
          {
            id: 1234,
            status: "in_progress",
            siteLocationId: 50,
            siteName: "Acme Site",
            partnerName: "Globex",
            workTypeName: "Maintenance",
            fieldEmployeeId: 99,
            fieldEmployeeFirstName: "Field",
            fieldEmployeeLastName: "Tester",
            createdAt: new Date().toISOString(),
          },
        ]);
      if (url === "/api/field/history") return Promise.resolve([]);
      if (url === "/api/notifications/unread-count")
        return Promise.resolve({ count: 0 });
      if (url === "/api/field/me")
        return Promise.resolve({ vendorName: "Acme Vendor" });
      return Promise.resolve(null);
    });

    // Wait for the cooldown to expire and the recovery effect to fire
    // /api/field/open-tickets at least once. The wall-clock window
    // here covers (a) the 1s real-timer cooldown set above, plus (b)
    // the React re-render + recovery effect that re-invokes load().
    // 3s was enough when this test ran in isolation, but once the
    // full mobile vitest suite runs together (Task #653) the shared
    // thread pool can starve real timers for long enough to slip
    // past that budget. Bumping to 8s keeps the assertion meaningful
    // (still well under the default 5m vitest-test timeout) without
    // changing what the test verifies.
    await waitFor(
      () => {
        expect(
          apiFetchMock.mock.calls.some(
            ([u]) => u === "/api/field/open-tickets",
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
      if (url === "/api/notifications/unread-count")
        return Promise.resolve({ count: 0 });
      if (url === "/api/field/me")
        return Promise.resolve({ vendorName: "Acme Vendor" });
      return Promise.resolve(null);
    });

    render(<HomeScreen />);

    const button = await screen.findByTestId("button-refresh-tickets");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryAllByTestId("toast-tickets-rate-limited").length).toBe(
      0,
    );

    // Arm the cooldown manually (simulating the gate hook observing a
    // 429 raised by some other caller — e.g. the live-location
    // reporter or the ticket detail screen).
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
      const btn = screen.getByTestId(
        "button-refresh-tickets",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
