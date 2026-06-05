import path from "node:path";
import Module from "node:module";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #187 — covers the inline org-switcher bottom sheet that opens
// when a dual-role user taps the active-org pill on the Home header.
// The switcher saves the two extra taps a foreman would otherwise spend
// going to Profile to flip context. The behaviors under test mirror
// the task spec's "Done looks like":
//
//   - Tapping the Partner/Vendor pill opens a sheet listing both
//     memberships.
//   - Selecting a membership calls switchContext and dismisses the
//     sheet.
//   - Single-membership users see no change (the pill stays
//     non-interactive).
//
// We mirror the alias + .png stub from the existing open-tickets tests
// so vitest can resolve the brand-logo asset without parsing it.
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

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    isOrgBranded: false,
    name: null,
    logoUrl: null,
    logoSquareUrl: null,
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

const { switchContextMock } = vi.hoisted(() => ({
  switchContextMock: vi.fn(async () => undefined),
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    user: {
      id: 99,
      role: "field_employee" as string,
      displayName: "Field Tester",
    } as Record<string, unknown> | null,
    activeMembership: {
      id: 1,
      orgName: "Acme Vendor",
      orgType: "vendor" as "vendor" | "partner",
    } as Record<string, unknown> | null,
    activeMembershipId: 1 as number | null,
    availableMemberships: [
      { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
      { id: 2, orgType: "partner", orgName: "Globex Partner" },
    ] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: authState.user,
    activeMembership: authState.activeMembership,
    activeMembershipId: authState.activeMembershipId,
    availableMemberships: authState.availableMemberships,
    switchContext: switchContextMock,
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
  switchContextMock.mockReset();
  switchContextMock.mockResolvedValue(undefined);

  // Restore the dual-membership baseline so individual tests can mutate
  // it without bleeding into the next.
  authState.user = {
    id: 99,
    role: "field_employee",
    displayName: "Field Tester",
  };
  authState.activeMembership = {
    id: 1,
    orgName: "Acme Vendor",
    orgType: "vendor",
  };
  authState.activeMembershipId = 1;
  authState.availableMemberships = [
    { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
    { id: 2, orgType: "partner", orgName: "Globex Partner" },
  ];

  apiFetchMock.mockImplementation((url: string) => {
    if (url === "/api/field/open-tickets") return Promise.resolve([]);
    if (url === "/api/field/history") return Promise.resolve([]);
    if (url === "/api/notifications/unread-count")
      return Promise.resolve({ count: 0 });
    if (url === "/api/field/me")
      return Promise.resolve({ vendorName: "Acme Vendor" });
    return Promise.resolve(null);
  });
});

describe("HomeScreen — Task #187 org-switcher pill", () => {
  it("makes the active-org pill tappable and opens the bottom sheet listing both memberships", async () => {
    render(<HomeScreen />);

    // Sheet starts closed.
    expect(screen.queryByTestId("sheet-org-switcher")).toBeNull();

    const opener = await screen.findByTestId("button-open-org-switcher");
    await act(async () => {
      fireEvent.click(opener);
    });

    const sheet = await screen.findByTestId("sheet-org-switcher");
    expect(sheet).toBeTruthy();
    // Both memberships are listed as pickable rows.
    expect(screen.getByTestId("button-pick-context-1")).toBeTruthy();
    expect(screen.getByTestId("button-pick-context-2")).toBeTruthy();
  });

  it("calls switchContext with the selected membership when a row is tapped", async () => {
    render(<HomeScreen />);

    const opener = await screen.findByTestId("button-open-org-switcher");
    await act(async () => {
      fireEvent.click(opener);
    });
    await screen.findByTestId("sheet-org-switcher");

    const otherOrg = screen.getByTestId("button-pick-context-2");
    await act(async () => {
      fireEvent.click(otherOrg);
    });

    // The handler must call `switchContext` with the picked
    // membership id. The auth context's downstream re-render is what
    // dismisses the sheet — that wiring is exercised end-to-end in the
    // testing-skill flow, while this unit test focuses on the click
    // contract because react-native-web's animated Modal keeps its
    // children mounted under jsdom until a real `animationend` fires.
    await waitFor(() => {
      expect(switchContextMock).toHaveBeenCalledWith(2);
    });
  });

  it("does not call switchContext when the row tapped is already the active membership", async () => {
    render(<HomeScreen />);

    const opener = await screen.findByTestId("button-open-org-switcher");
    await act(async () => {
      fireEvent.click(opener);
    });
    await screen.findByTestId("sheet-org-switcher");

    // Active membership is id=1; tapping it should be a no-op against
    // the API. This guards against accidentally re-issuing a network
    // call (and the auth-context churn that comes with it) when a
    // user opens the sheet to look but keeps the current org.
    const sameOrg = screen.getByTestId("button-pick-context-1");
    await act(async () => {
      fireEvent.click(sameOrg);
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(switchContextMock).not.toHaveBeenCalled();
  });

  it("does not render an opener (or sheet) for single-membership users", async () => {
    // Only one membership → the pill must remain a static View.
    authState.availableMemberships = [
      { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
    ];
    // Vendor/admin roles show the org-type badge on the static pill;
    // field employees intentionally hide it (see Home header wiring).
    authState.user = {
      id: 99,
      role: "vendor",
      displayName: "Vendor Tester",
    };

    render(<HomeScreen />);

    // The opener button is gone, but the static org name + badge remain
    // so the user still sees their single org on the header.
    await screen.findByTestId("text-active-org-name");
    expect(screen.queryByTestId("button-open-org-switcher")).toBeNull();
    expect(screen.queryByTestId("sheet-org-switcher")).toBeNull();
    expect(screen.getByTestId("badge-active-org-vendor")).toBeTruthy();
  });
});
