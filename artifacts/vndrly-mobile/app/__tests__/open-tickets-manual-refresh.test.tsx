import path from "node:path";
import Module from "node:module";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #669: tests cover the manual refresh button on the open-tickets
// list — the field-side equivalent of the web dispatcher's clickable
// connection pill (Task #667). The button funnels through the same
// `load()` the auto-refresh / pull-to-refresh use, then surfaces a brief
// "Refreshed" confirmation toast on success so the field employee gets
// the same visible cue as the web dispatcher.

// The home screen brand logo uses an inline `require("@/assets/...png")`.
// Mirror the alias + .png stub from the foreground-unblock test so
// vitest can resolve the asset without parsing it.
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
    user: {
      userId: 99,
      role: "field_employee",
      vendorId: 11,
      vendorRole: "field",
      displayName: "Field Op",
    },
    activeMembership: null,
    activeMembershipId: null,
    availableMemberships: [],
    switchContext: async () => {},
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
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import HomeScreen from "../(tabs)/index";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  routerPushMock.mockReset();

  apiFetchMock.mockImplementation((url: string) => {
    if (url === "/api/field/open-tickets") return Promise.resolve([]);
    if (url === "/api/notifications/unread-count")
      return Promise.resolve({ count: 0 });
    if (url === "/api/field/me")
      return Promise.resolve({ vendorName: "Acme Vendor" });
    return Promise.resolve(null);
  });
});

describe("HomeScreen — Task #669 manual refresh button", () => {
  it("re-fetches the open-tickets list when the header refresh button is tapped", async () => {
    render(<HomeScreen />);

    // Wait for the initial load to settle.
    await waitFor(() => {
      const openCalls = apiFetchMock.mock.calls.filter(
        ([u]) => u === "/api/field/open-tickets",
      );
      expect(openCalls.length).toBeGreaterThan(0);
    });
    const initialOpenCalls = apiFetchMock.mock.calls.filter(
      ([u]) => u === "/api/field/open-tickets",
    ).length;

    const button = await screen.findByTestId("button-refresh-tickets");
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      const after = apiFetchMock.mock.calls.filter(
        ([u]) => u === "/api/field/open-tickets",
      ).length;
      // The tap must trigger at least one *additional* fetch on top of
      // the mount-time loads (Strict-mode + focus-effect can cause the
      // initial count to be 1 or 2; we just need to see it grow).
      expect(after).toBeGreaterThan(initialOpenCalls);
    });
  });

  it("flashes the 'Refreshed' confirmation toast after a successful manual refresh", async () => {
    render(<HomeScreen />);

    // Wait for the button to mount (mount-time load can otherwise win
    // the race and leave us asserting against the wrong frame).
    const button = await screen.findByTestId("button-refresh-tickets");

    expect(screen.queryAllByTestId("toast-tickets-refreshed").length).toBe(0);

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      const toast = screen.queryAllByTestId("toast-tickets-refreshed")[0];
      expect(toast).toBeTruthy();
      expect(toast?.textContent || "").toContain("Refreshed");
    });
  });

  it("does NOT show the 'Refreshed' toast when the manual refresh fails", async () => {
    // Fail the next /open-tickets request so the toast never appears.
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets")
        return Promise.reject(new Error("network down"));
      if (url === "/api/notifications/unread-count")
        return Promise.resolve({ count: 0 });
      return Promise.resolve(null);
    });

    render(<HomeScreen />);
    const button = await screen.findByTestId("button-refresh-tickets");

    await act(async () => {
      fireEvent.click(button);
    });

    // Give the failed promise time to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("toast-tickets-refreshed").length).toBe(0);
  });
});
