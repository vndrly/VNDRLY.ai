import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// === Module mocks (must be hoisted before importing the screen) ===

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    accent: "#fef3c7",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

const { routerReplaceMock } = vi.hoisted(() => ({ routerReplaceMock: vi.fn() }));
vi.mock("expo-router", () => ({
  router: { replace: routerReplaceMock, push: vi.fn(), back: vi.fn() },
}));

// react-native-safe-area-context's native bindings don't load in jsdom; render
// SafeAreaView as a plain View pass-through.
vi.mock("react-native-safe-area-context", async () => {
  const RN = await import("react-native");
  return {
    SafeAreaView: RN.View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// useTranslation: looks up keys in a Spanish dictionary so we can assert that
// the screen surfaces localized copy when the API returns structured error
// codes (Task #545). Keys not present in the dictionary fall back to the key
// itself, so the existing key-based assertions in this file still pass.
//
// Keep these strings in sync with `lib/locales/es.json` — they are copied
// verbatim from the corresponding keys.
const ES_STRINGS: Record<string, string> = {
  "visitor.error": "Error",
  "errors.visit.invalid_input":
    "Faltan datos obligatorios para registrar la entrada.",
  "errors.visit.partner_host_mismatch":
    "Ese contacto no trabaja en este sitio. Elige otro.",
  "errors.visit.location_required":
    "Necesitamos tu ubicación para registrar tu entrada. Activa la ubicación e inténtalo de nuevo.",
  "errors.visit.no_access": "No tienes acceso a esta visita.",
  "tickets.errorCheckIn": "No se pudo registrar la entrada",
  "tickets.errorCheckOut": "No se pudo registrar la salida",
  "tickets.offGeofence":
    "Está a {{distance}} m — debe estar a menos de {{radius}} m del sitio para registrarse.",
  // Task #112: friendly session-expired screen copy. Asserted in the
  // session-expired suite below to confirm the visitor sees Spanish, not
  // a generic "ERR_HTTP_401" or untranslated key.
  "visitor.sessionExpiredTitle": "Su sesión de visitante expiró",
  "visitor.sessionExpiredBody":
    "Las sesiones de visitante duran 24 horas. Inicie sesión de nuevo para continuar registrándose.",
  "visitor.signInAgain": "Iniciar sesión de nuevo",
};

function interpolate(
  template: string,
  opts?: Record<string, unknown>,
): string {
  if (!opts) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    String((opts as Record<string, unknown>)[k] ?? ""),
  );
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      ES_STRINGS[k] != null ? interpolate(ES_STRINGS[k], opts) : k,
  }),
}));

const {
  requestForegroundPermissionsAsyncMock,
  getCurrentPositionAsyncMock,
  requestCamPermMock,
  camPermRef,
} = vi.hoisted(() => ({
  requestForegroundPermissionsAsyncMock: vi.fn(),
  getCurrentPositionAsyncMock: vi.fn(),
  requestCamPermMock: vi.fn(async () => ({ granted: true })),
  camPermRef: { current: { granted: true } as { granted: boolean } },
}));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: (...a: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...a),
  getCurrentPositionAsync: (...a: unknown[]) =>
    getCurrentPositionAsyncMock(...a),
}));
vi.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [camPermRef.current, requestCamPermMock],
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), initApi: vi.fn() }));
const { setTokenMock, setUserMock } = vi.hoisted(() => ({
  setTokenMock: vi.fn(),
  setUserMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  setToken: (...a: unknown[]) => setTokenMock(...a),
  setUser: (...a: unknown[]) => setUserMock(...a),
  getToken: vi.fn(),
}));

const {
  fetchActiveVisitMock,
  fetchSiteContextMock,
  visitorCheckOutMock,
  guestLogoutMock,
  visitorCheckInMock,
} = vi.hoisted(() => ({
  fetchActiveVisitMock: vi.fn(),
  fetchSiteContextMock: vi.fn(),
  visitorCheckOutMock: vi.fn(),
  guestLogoutMock: vi.fn(),
  visitorCheckInMock: vi.fn(),
}));
vi.mock("@/lib/guest", () => ({
  fetchActiveVisit: (...a: unknown[]) => fetchActiveVisitMock(...a),
  fetchSiteContext: (...a: unknown[]) => fetchSiteContextMock(...a),
  visitorCheckOut: (...a: unknown[]) => visitorCheckOutMock(...a),
  guestLogout: (...a: unknown[]) => guestLogoutMock(...a),
  visitorCheckIn: (...a: unknown[]) => visitorCheckInMock(...a),
}));

// AmberButton renders as a plain DOM button so we can assert disabled / press
// semantics without loading the asset-backed implementation. Mirrors the shim
// used in the VisitorHostPicker component test.
vi.mock("@/components/AmberButton", async () => {
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
          "aria-disabled": isDisabled || undefined,
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onPress,
        },
        typeof children === "string" ? children : "btn",
      );
    },
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alert } from "react-native";

import VisitorCheckInScreen from "../visitor-checkin";
import type { SiteContext } from "@/lib/guest";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  camPermRef.current = { granted: true };
  requestCamPermMock.mockImplementation(async () => ({ granted: true }));
  fetchActiveVisitMock.mockResolvedValue(null);
});

const SITE_CTX: SiteContext = {
  site: {
    id: 42,
    name: "Acme HQ",
    address: "123 Main St",
    latitude: 37.7,
    longitude: -122.4,
    siteRadiusMeters: 100,
    siteCode: "ACME-HQ",
  },
  partner: { id: 7, name: "Acme Partner" },
  vendors: [
    { id: 11, name: "Bolt Vendor" },
    { id: 12, name: "Wire Vendor" },
  ],
};

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <VisitorCheckInScreen />
    </QueryClientProvider>,
  );
}

// react-native-web sometimes propagates `data-testid` to a wrapper as well as
// the underlying interactive element; pick the first match (the outer node).
function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

async function findFirstByTestId(id: string): Promise<HTMLElement> {
  await screen.findByTestId(id);
  return firstByTestId(id);
}

// react-native-web's <Pressable>/<TouchableOpacity> uses the React Native
// responder system, which listens for pointer events rather than `click`.
function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

function isDisabled(el: HTMLElement): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  if ((el as HTMLButtonElement).disabled === true) return true;
  return false;
}

describe("VisitorCheckInScreen — full screen render flow", () => {
  it("shows the site code form once the active-visit query resolves with no active visit", async () => {
    renderScreen();
    const codeInput = await findFirstByTestId("site-code-input");
    expect(codeInput).toBeTruthy();
    expect(firstByTestId("site-lookup-btn")).toBeTruthy();
    expect(firstByTestId("open-scanner-btn")).toBeTruthy();
    // The site-context query stays disabled until a code is confirmed.
    expect(fetchSiteContextMock).not.toHaveBeenCalled();
  });

  it("renders the active-visit card (with check-out button) when the user already has an open visit", async () => {
    fetchActiveVisitMock.mockResolvedValueOnce({
      id: 555,
      siteLocationId: 42,
      siteName: "Acme HQ",
      siteAddress: "123 Main St",
      hostType: "partner",
      hostPartnerName: "Acme Partner",
      hostVendorName: null,
      purpose: "Inspection",
      expectedDurationMinutes: 60,
      checkInTime: new Date("2026-01-01T12:00:00Z").toISOString(),
      expiresAt: null,
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getAllByText("visitor.checkOut").length).toBeGreaterThan(0);
    });
    // The site code form is NOT rendered while an active visit is in progress.
    expect(screen.queryAllByTestId("site-code-input").length).toBe(0);
    // The purpose label and value are separate Text children inside one row,
    // so use a regex that tolerates the "visitor.purpose: Inspection" join.
    expect(screen.getAllByText(/Inspection/).length).toBeGreaterThan(0);
  });

  it("renders the camera overlay (with cancel button) when the user opens the QR scanner", async () => {
    renderScreen();
    const scanBtn = await findFirstByTestId("open-scanner-btn");
    tap(scanBtn);

    // The form is replaced by the scanner overlay; the cancel button uses the
    // i18n key `visitor.cancel`.
    await waitFor(() => {
      expect(screen.getAllByText("visitor.cancel").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByTestId("site-code-input").length).toBe(0);
    expect(requestCamPermMock).not.toHaveBeenCalled(); // perm already granted
  });

  it("walks through code entry → site confirmation → host pick → check-in submit", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValue({
      coords: { latitude: 1.23, longitude: 4.56 },
    });
    visitorCheckInMock.mockResolvedValue({ id: 999 });

    renderScreen();

    // 1. Type the site code and tap the lookup button.
    const codeInput = await findFirstByTestId("site-code-input");
    fireEvent.change(codeInput, { target: { value: "acme-hq" } });
    tap(firstByTestId("site-lookup-btn"));

    // 2. Wait for the confirmation card; it shows the site name from the API.
    const acceptBtn = await findFirstByTestId("accept-site-btn");
    expect(screen.getAllByText("Acme HQ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("123 Main St").length).toBeGreaterThan(0);
    expect(fetchSiteContextMock).toHaveBeenCalledWith("ACME-HQ");

    // 3. The host picker is not visible yet — only the confirmation card is.
    expect(screen.queryAllByTestId("host-picker-card").length).toBe(0);

    // 4. Tap "yes, continue" to advance into the host picker.
    tap(acceptBtn);

    const checkInBtn = await findFirstByTestId("check-in-btn");
    expect(firstByTestId("host-picker-card")).toBeTruthy();

    // 5. The check-in button is disabled until a host is picked — assert
    //    against the actual rendered DOM, not just the helper function.
    expect(isDisabled(checkInBtn)).toBe(true);
    tap(checkInBtn);
    expect(visitorCheckInMock).not.toHaveBeenCalled();

    // 6. Pick a host. The button should flip to enabled.
    tap(firstByTestId("host-option-partner:7"));
    await waitFor(() => {
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false);
    });

    // 7. Tap check-in. The screen calls submitVisitorCheckIn, which requests
    //    location permission, reads the GPS, and calls visitorCheckIn().
    tap(firstByTestId("check-in-btn"));

    await waitFor(() => {
      expect(visitorCheckInMock).toHaveBeenCalledTimes(1);
    });
    expect(visitorCheckInMock).toHaveBeenCalledWith({
      siteLocationId: 42,
      hostType: "partner",
      hostPartnerId: 7,
      hostVendorId: undefined,
      purpose: undefined,
      expectedDurationMinutes: 60,
      latitude: 1.23,
      longitude: 4.56,
    });
    expect(requestForegroundPermissionsAsyncMock).toHaveBeenCalledTimes(1);
    expect(getCurrentPositionAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("blocks the API call (and surfaces no submit) when the OS denies foreground location after a host is selected", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "denied",
    });

    renderScreen();

    const codeInput = await findFirstByTestId("site-code-input");
    fireEvent.change(codeInput, { target: { value: "ACME-HQ" } });
    tap(firstByTestId("site-lookup-btn"));

    const acceptBtn = await findFirstByTestId("accept-site-btn");
    tap(acceptBtn);

    await findFirstByTestId("check-in-btn");
    tap(firstByTestId("host-option-vendor:11"));
    await waitFor(() => {
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false);
    });

    tap(firstByTestId("check-in-btn"));

    await waitFor(() => {
      expect(requestForegroundPermissionsAsyncMock).toHaveBeenCalledTimes(1);
    });
    expect(getCurrentPositionAsyncMock).not.toHaveBeenCalled();
    expect(visitorCheckInMock).not.toHaveBeenCalled();
  });
});

// Task #545 — Spanish visitors must see localized copy when the visitor
// check-in API rejects with a structured error code. The two `catch` blocks
// in visitor-checkin.tsx route the error through `translateApiError(e, t)`,
// so the Spanish strings from `lib/locales/es.json` must end up in the
// Alert (not the raw English `err.message`).
describe("VisitorCheckInScreen — localized API error rendering", () => {
  function makeApiError(
    code: string,
    extra?: Record<string, unknown>,
  ): Error {
    const err = new Error(`raw english copy for ${code}`) as Error & {
      status?: number;
      code?: string;
      data?: Record<string, unknown>;
    };
    err.status = 400;
    err.code = code;
    err.data = { code, ...(extra ?? {}) };
    return err;
  }

  async function reachCheckInButton(): Promise<HTMLElement> {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValue({
      coords: { latitude: 1.23, longitude: 4.56 },
    });

    renderScreen();

    const codeInput = await findFirstByTestId("site-code-input");
    fireEvent.change(codeInput, { target: { value: "ACME-HQ" } });
    tap(firstByTestId("site-lookup-btn"));

    const acceptBtn = await findFirstByTestId("accept-site-btn");
    tap(acceptBtn);

    await findFirstByTestId("check-in-btn");
    tap(firstByTestId("host-option-partner:7"));
    await waitFor(() => {
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false);
    });
    return firstByTestId("check-in-btn");
  }

  it("shows the Spanish copy for visit.invalid_input when check-in fails", async () => {
    const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    visitorCheckInMock.mockRejectedValueOnce(
      makeApiError("visit.invalid_input"),
    );

    const checkInBtn = await reachCheckInButton();
    tap(checkInBtn);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        "Faltan datos obligatorios para registrar la entrada.",
      );
    });
    alertSpy.mockRestore();
  });

  it("shows the interpolated Spanish copy for off_geofence on check-in", async () => {
    const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    visitorCheckInMock.mockRejectedValueOnce(
      makeApiError("off_geofence", {
        distanceMeters: 320,
        radiusMeters: 150,
      }),
    );

    const checkInBtn = await reachCheckInButton();
    tap(checkInBtn);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        "Está a 320 m — debe estar a menos de 150 m del sitio para registrarse.",
      );
    });
    alertSpy.mockRestore();
  });

  it("shows the Spanish copy for visit.no_access when check-out fails", async () => {
    const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    fetchActiveVisitMock.mockResolvedValueOnce({
      id: 555,
      siteLocationId: 42,
      siteName: "Acme HQ",
      siteAddress: "123 Main St",
      hostType: "partner",
      hostPartnerName: "Acme Partner",
      hostVendorName: null,
      purpose: "Inspection",
      expectedDurationMinutes: 60,
      checkInTime: new Date("2026-01-01T12:00:00Z").toISOString(),
      expiresAt: null,
    });
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValue({
      coords: { latitude: 1.23, longitude: 4.56 },
    });
    visitorCheckOutMock.mockRejectedValueOnce(
      makeApiError("visit.no_access"),
    );

    renderScreen();

    // The active-visit card renders a "visitor.checkOut" button; find and tap it.
    await waitFor(() => {
      expect(screen.getAllByText("visitor.checkOut").length).toBeGreaterThan(0);
    });
    const checkOutBtn = screen.getAllByText("visitor.checkOut")[0];
    tap(checkOutBtn);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        "No tienes acceso a esta visita.",
      );
    });
    alertSpy.mockRestore();
  });
});

// Task #112 — when the 24-hour visitor session expires, every API call
// returns 401. Instead of an opaque system Alert, the screen should flip
// into a friendly "session expired" card with a button straight back to
// the visitor sign-in form.
describe("VisitorCheckInScreen — Task #112 expired session", () => {
  function make401(): Error {
    const err = new Error("Guest session expired") as Error & {
      status?: number;
      code?: string;
      data?: Record<string, unknown>;
    };
    err.status = 401;
    err.code = "auth.guest_expired";
    err.data = { code: "auth.guest_expired" };
    return err;
  }

  it("renders the session-expired card when the active-visit query 401s", async () => {
    fetchActiveVisitMock.mockRejectedValueOnce(make401());

    renderScreen();

    await waitFor(() => {
      expect(screen.getAllByTestId("session-expired-card").length).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByText("Su sesión de visitante expiró").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Las sesiones de visitante duran 24 horas. Inicie sesión de nuevo para continuar registrándose.",
      ).length,
    ).toBeGreaterThan(0);
    // The normal screen chrome (header sign-out link, site code form) is gone
    // — the visitor only has one obvious next action.
    expect(screen.queryAllByText("nav.signOut").length).toBe(0);
    expect(screen.queryAllByTestId("site-code-input").length).toBe(0);
  });

  it("clears the dead token and routes to /guest-login when the visitor taps Sign in again", async () => {
    fetchActiveVisitMock.mockRejectedValueOnce(make401());

    renderScreen();

    const signInBtn = await findFirstByTestId("session-expired-sign-in-btn");
    tap(signInBtn);

    await waitFor(() => {
      expect(setTokenMock).toHaveBeenCalledWith(null);
    });
    expect(setUserMock).toHaveBeenCalledWith(null);
    expect(routerReplaceMock).toHaveBeenCalledWith("/guest-login");
  });

  it("flips into the session-expired screen (instead of an Alert) when check-in 401s", async () => {
    const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValue({
      coords: { latitude: 1.23, longitude: 4.56 },
    });
    visitorCheckInMock.mockRejectedValueOnce(make401());

    renderScreen();

    const codeInput = await findFirstByTestId("site-code-input");
    fireEvent.change(codeInput, { target: { value: "ACME-HQ" } });
    tap(firstByTestId("site-lookup-btn"));

    const acceptBtn = await findFirstByTestId("accept-site-btn");
    tap(acceptBtn);

    await findFirstByTestId("check-in-btn");
    tap(firstByTestId("host-option-partner:7"));
    await waitFor(() => {
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false);
    });
    tap(firstByTestId("check-in-btn"));

    await waitFor(() => {
      expect(screen.getAllByTestId("session-expired-card").length).toBeGreaterThan(0);
    });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("flips into the session-expired screen (instead of an Alert) when check-out 401s", async () => {
    const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    fetchActiveVisitMock.mockResolvedValueOnce({
      id: 555,
      siteLocationId: 42,
      siteName: "Acme HQ",
      siteAddress: "123 Main St",
      hostType: "partner",
      hostPartnerName: "Acme Partner",
      hostVendorName: null,
      purpose: "Inspection",
      expectedDurationMinutes: 60,
      checkInTime: new Date("2026-01-01T12:00:00Z").toISOString(),
      expiresAt: null,
    });
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValue({
      coords: { latitude: 1.23, longitude: 4.56 },
    });
    visitorCheckOutMock.mockRejectedValueOnce(make401());

    renderScreen();

    await waitFor(() => {
      expect(screen.getAllByText("visitor.checkOut").length).toBeGreaterThan(0);
    });
    const checkOutBtn = screen.getAllByText("visitor.checkOut")[0];
    tap(checkOutBtn);

    await waitFor(() => {
      expect(screen.getAllByTestId("session-expired-card").length).toBeGreaterThan(0);
    });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
