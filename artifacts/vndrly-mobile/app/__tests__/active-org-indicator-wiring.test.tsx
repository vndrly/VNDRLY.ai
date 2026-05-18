import path from "node:path";
import Module from "node:module";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Task #186 — proves the active-organization indicator is injected
// into BOTH the tab navigator's `screenOptions.headerRight` AND the
// root authenticated stack's `screenOptions.headerRight`. The first
// covers Home / Schedule / Scan / Profile; the second covers
// Notifications, History, New Ticket, Ticket detail, Edit Profile,
// etc. Without the root-stack wiring a dual-role user loses the
// active-org reminder the moment they push into a stack screen,
// which is exactly when they're most likely to take a destructive
// action under the wrong org.
//
// This is a structural test: we mock `expo-router` so `Tabs` /
// `Stack` capture whatever `screenOptions` they were given, and we
// then call `headerRight()` and assert it returns an
// `ActiveOrgIndicator` element. We also stub the network /
// notifications / fonts / sentry / etc. side effects the real
// `_layout.tsx` would otherwise fire on import so the test is
// hermetic.

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

const { tabsCalls, stackCalls } = vi.hoisted(() => ({
  tabsCalls: [] as Array<{ screenOptions?: Record<string, unknown> }>,
  stackCalls: [] as Array<{ screenOptions?: Record<string, unknown> }>,
}));

vi.mock("expo-router", () => {
  const Tabs = (props: { screenOptions?: Record<string, unknown> }) => {
    tabsCalls.push({ screenOptions: props.screenOptions });
    return null;
  };
  Tabs.Screen = (() => null) as unknown as React.FC<unknown>;
  const Stack = (props: { screenOptions?: Record<string, unknown> }) => {
    stackCalls.push({ screenOptions: props.screenOptions });
    return null;
  };
  Stack.Screen = (() => null) as unknown as React.FC<unknown>;
  const useFocusEffect = (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
    }, [cb]);
  };
  return {
    Tabs,
    Stack,
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
    useFocusEffect,
    useSegments: () => [],
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

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

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    availableMemberships: [
      { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
      { id: 2, orgType: "partner", orgName: "Globex Partner" },
    ],
    activeMembership: { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/use-brand", () => ({
  BrandProvider: ({ children }: { children: React.ReactNode }) => children,
  useBrand: () => ({ name: null, isOrgBranded: false, logoUrl: null, logoSquareUrl: null }),
}));

vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
  getLastNotificationResponseAsync: vi.fn(async () => null),
  setNotificationHandler: vi.fn(),
}));

vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: vi.fn(),
  hideAsync: vi.fn(),
}));

vi.mock("@expo-google-fonts/inter", () => ({
  useFonts: () => [true, null],
  Inter_400Regular: "Inter_400Regular",
  Inter_500Medium: "Inter_500Medium",
  Inter_600SemiBold: "Inter_600SemiBold",
  Inter_700Bold: "Inter_700Bold",
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: class {},
  QueryCache: class {},
  MutationCache: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/SafeKeyboardProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/SplashLogo", () => ({ default: () => null }));

vi.mock("@/lib/api", () => ({
  initApi: vi.fn(),
  apiFetch: vi.fn(async () => null),
  refreshAuthMe: vi.fn(async () => undefined),
  switchContext: vi.fn(),
  logout: vi.fn(),
  updatePreferredLanguage: vi.fn(),
  getApiBase: () => "http://localhost",
}));

vi.mock("@/lib/auth", () => ({
  getCachedToken: () => "token",
  getCachedRole: () => "field_employee",
  getToken: vi.fn(async () => "token"),
  getUser: vi.fn(async () => ({ id: 1, role: "field_employee" })),
  isTokenCacheReady: () => true,
  subscribeToken: () => () => undefined,
  subscribeUser: () => () => undefined,
}));

vi.mock("@/lib/locationConsent", () => ({
  hasActiveConsentForThisDevice: vi.fn(async () => true),
  isConsentDeclined: vi.fn(async () => false),
}));

vi.mock("@/lib/liveLocationReporter", () => ({
  startLiveLocationReporter: vi.fn(),
  stopLiveLocationReporter: vi.fn(),
}));

vi.mock("@/lib/sentry", () => ({
  initSentry: vi.fn(),
  setSentryUser: vi.fn(),
  wrapRoot: <T,>(c: T) => c,
}));

vi.mock("@/lib/i18n", () => ({}));

import { render } from "@testing-library/react";

beforeEach(() => {
  tabsCalls.length = 0;
  stackCalls.length = 0;
});

describe("ActiveOrgIndicator wiring (Task #186)", () => {
  it("is injected into the tab navigator's headerRight", async () => {
    const TabLayout = (await import("../(tabs)/_layout")).default;
    render(<TabLayout />);
    expect(tabsCalls.length).toBeGreaterThan(0);
    const screenOpts = tabsCalls[0].screenOptions;
    expect(screenOpts).toBeDefined();
    expect(typeof screenOpts!.headerRight).toBe("function");
    const rendered = (
      screenOpts!.headerRight as () => React.ReactElement<unknown, React.JSXElementConstructor<unknown>>
    )();
    expect((rendered.type as { name?: string }).name).toBe("ActiveOrgIndicator");
  });

  it("is injected into the root stack's headerRight so non-tab screens get it too", async () => {
    const RootLayout = (await import("../_layout")).default;
    render(<RootLayout />);
    expect(stackCalls.length).toBeGreaterThan(0);
    const screenOpts = stackCalls[0].screenOptions;
    expect(screenOpts).toBeDefined();
    expect(typeof screenOpts!.headerRight).toBe("function");
    const rendered = (
      screenOpts!.headerRight as () => React.ReactElement<unknown, React.JSXElementConstructor<unknown>>
    )();
    expect((rendered.type as { name?: string }).name).toBe("ActiveOrgIndicator");
  });
});
