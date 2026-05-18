import path from "node:path";
import Module from "node:module";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The home screen brand logo uses the idiomatic React Native asset
// pattern — an inline `require("@/assets/images/...png")`. Vite/vitest
// don't transform CJS `require()` calls, so we hijack Node's CJS
// resolver to (a) understand the `@/` alias and (b) return a stub for
// `.png` imports. This keeps the test focused on the toast behavior
// without needing the binary asset to load.
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

// Task #630: when the office restores a vendor's site / work-type
// assignment, Task #592 sends a `ticket_unblocked` push. Task #623
// surfaces a brief in-screen confirmation on the *ticket detail* screen
// when the foreground push lands. Workers on the open-tickets list got
// no signal at all because the assignment-removed banner only lives on
// the detail screen. This test verifies the same `ticket_unblocked`
// foreground push surfaces a matching confirmation toast on the open-
// tickets list so the worker knows it's safe to tap the ticket again.

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

// The home screen renders the toast via `t(key, { ticket })`, so the
// test needs the interpolated tracking number to land in the DOM. Mock
// the `t` helper to look up the real English string from the bundled
// locale file and run a minimal `{{var}}` substitution against the
// interpolation values.
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

// Capture every listener registered with addNotificationReceivedListener
// so the test can drive it directly.
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

vi.mock("@/lib/push", () => ({
  registerForPushNotifications: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 99, role: "field_employee", displayName: "Field Tester" },
    activeMembership: {
      orgName: "Acme Vendor",
      orgType: "vendor",
    },
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

import HomeScreen from "../(tabs)/index";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  routerPushMock.mockReset();
  pushListeners.length = 0;
  removeSpies.length = 0;

  // Default happy-path API responses for the home-screen loader.
  apiFetchMock.mockImplementation((url: string) => {
    if (url === "/api/field/open-tickets") return Promise.resolve([]);
    if (url === "/api/notifications/unread-count")
      return Promise.resolve({ count: 0 });
    if (url === "/api/field/me")
      return Promise.resolve({ vendorName: "Acme Vendor" });
    return Promise.resolve(null);
  });
});

describe("HomeScreen — Task #630 foreground ticket_unblocked toast", () => {
  it("shows a confirmation toast naming the ticket when a foreground ticket_unblocked push arrives", async () => {
    render(<HomeScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
    });

    // No toast yet.
    expect(screen.queryAllByTestId("toast-assignment-restored").length).toBe(0);

    const listener = pushListeners[pushListeners.length - 1];
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "ticket_unblocked", ticketId: 42 },
          },
        },
      });
    });

    await waitFor(() => {
      const node = screen.getAllByTestId("toast-assignment-restored")[0];
      expect(node).toBeTruthy();
      // The interpolated message must include the formatted tracking
      // number so the worker knows which ticket was restored.
      expect(node.textContent || "").toContain("VNDRLY-00000042");
    });
  });

  it("ignores foreground pushes whose type is not ticket_unblocked", async () => {
    render(<HomeScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
    });

    const listener = pushListeners[pushListeners.length - 1];
    await act(async () => {
      listener({
        request: {
          content: {
            data: { type: "comment_mention", ticketId: 42 },
          },
        },
      });
    });

    // Wait a tick to let any state updates settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("toast-assignment-restored").length).toBe(0);
  });

  it("ignores ticket_unblocked pushes with a missing/invalid ticket id", async () => {
    render(<HomeScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
    });

    const listener = pushListeners[pushListeners.length - 1];
    await act(async () => {
      listener({
        request: {
          content: { data: { type: "ticket_unblocked" } },
        },
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("toast-assignment-restored").length).toBe(0);
  });

  it("removes the foreground push listener on unmount", async () => {
    const { unmount } = render(<HomeScreen />);

    await waitFor(() => {
      expect(pushListeners.length).toBeGreaterThan(0);
    });

    const removeSpy = removeSpies[removeSpies.length - 1];
    expect(removeSpy).not.toHaveBeenCalled();
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });
});
