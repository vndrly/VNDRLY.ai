import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("react-native-safe-area-context", async () => {
  const RN = await import("react-native");
  return {
    SafeAreaView: RN.View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// Minimal Spanish dictionary so we can verify the guest sign-in screen
// surfaces the localized copy already shipped at errors.guest.* (Task #539).
// Keep this in sync with the real keys in lib/locales/es.json.
const ES_STRINGS: Record<string, string> = {
  "visitor.error": "Error",
  "visitor.requireName": "El nombre y el apellido son obligatorios.",
  "visitor.requireSafety": "Por favor confirme que acepta las reglas de seguridad.",
  "common.required": "Obligatorio",
  "errors.guest.name_required": "El nombre y apellido son obligatorios.",
  "errors.guest.safety_required":
    "Confirma el aviso de seguridad para continuar.",
};
// `lib/i18n.ts` (pulled in transitively via `<LanguageToggle />`) calls
// `i18n.use(initReactI18next).init(...)`. Without an `initReactI18next`
// export on this mock, the module-load chain throws
// `No "initReactI18next" export is defined on the "react-i18next" mock`
// and the entire test file fails to register any tests. Provide an
// inert plugin object that satisfies i18next's `.use()` contract — it
// just needs a `type` so i18next doesn't complain. The screen tests
// drive translations through the mocked `useTranslation` above, so the
// real plugin's behavior is irrelevant here.
// `<LanguageToggle />` (rendered inside the guest sign-in screen) reads
// `i18n.language` off the hook return value to highlight the active
// EN/ES pill, so the mock must surface a stub `i18n` object too. A
// fixed `"en"` is fine — these tests assert against the screen's
// localized error rendering by stubbing the `t()` lookup table above,
// not by exercising the language toggle itself.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => ES_STRINGS[k] ?? k,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), initApi: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  setToken: vi.fn(),
  setUser: vi.fn(),
  getToken: vi.fn(),
}));

const { startGuestSessionMock } = vi.hoisted(() => ({
  startGuestSessionMock: vi.fn(),
}));
vi.mock("@/lib/guest", () => ({
  startGuestSession: (...a: unknown[]) => startGuestSessionMock(...a),
}));

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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alert } from "react-native";

import GuestLoginScreen from "../guest-login";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  startGuestSessionMock.mockResolvedValue({
    token: "tok",
    guestSessionId: 1,
    role: "guest",
    expiresAt: new Date().toISOString(),
    profile: {
      firstName: "Jane",
      lastName: "Doe",
      phone: null,
      email: null,
      company: null,
      vehiclePlate: null,
      lastPurpose: null,
    },
  });
});

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

function isDisabled(el: HTMLElement): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  if ((el as HTMLButtonElement).disabled === true) return true;
  return false;
}

function setText(testId: string, value: string): void {
  fireEvent.change(firstByTestId(testId), { target: { value } });
}

// react-native-web's <Switch> renders an <input type="checkbox">. To toggle
// it we click the underlying checkbox so the onValueChange handler fires.
function toggleSwitch(testId: string): void {
  const root = firstByTestId(testId);
  const checkbox =
    (root.querySelector('input[type="checkbox"]') as HTMLInputElement | null) ??
    (root.tagName === "INPUT" ? (root as HTMLInputElement) : null);
  if (!checkbox) {
    throw new Error(`Could not find checkbox inside testID=${testId}`);
  }
  fireEvent.click(checkbox);
}

describe("GuestLoginScreen — sign-up form", () => {
  it("renders the title, all required inputs, and the submit button", () => {
    render(<GuestLoginScreen />);

    expect(screen.getAllByText("visitor.signInTitle").length).toBeGreaterThan(0);
    expect(firstByTestId("guest-first-name")).toBeTruthy();
    expect(firstByTestId("guest-last-name")).toBeTruthy();
    expect(firstByTestId("guest-phone")).toBeTruthy();
    expect(firstByTestId("guest-email")).toBeTruthy();
    expect(firstByTestId("guest-company")).toBeTruthy();
    expect(firstByTestId("guest-vehicle-plate")).toBeTruthy();
    expect(firstByTestId("guest-purpose")).toBeTruthy();
    expect(firstByTestId("guest-safety-switch")).toBeTruthy();
    expect(firstByTestId("guest-submit-btn")).toBeTruthy();
  });

  it("keeps the submit button tappable so the visitor can trigger inline hints (only disables while submitting)", () => {
    render(<GuestLoginScreen />);

    // Task #113: the button is no longer disabled while the form is
    // invalid — that's how we get a chance to show field-level hints
    // when the visitor taps it. It only goes disabled while a request
    // is in flight (covered by `busy`).
    expect(isDisabled(firstByTestId("guest-submit-btn"))).toBe(false);

    setText("guest-first-name", "Jane");
    setText("guest-last-name", "Doe");
    toggleSwitch("guest-safety-switch");
    expect(isDisabled(firstByTestId("guest-submit-btn"))).toBe(false);
  });

  it("does not call startGuestSession when the form is invalid, even if the button is tapped", () => {
    render(<GuestLoginScreen />);
    fireEvent.click(firstByTestId("guest-submit-btn"));
    expect(startGuestSessionMock).not.toHaveBeenCalled();
  });

  it("submits a trimmed payload with all optional fields and navigates to the visitor check-in screen", async () => {
    render(<GuestLoginScreen />);

    setText("guest-first-name", "  Jane ");
    setText("guest-last-name", " Doe  ");
    setText("guest-phone", " 555-1234 ");
    setText("guest-email", " jane@example.com ");
    setText("guest-company", " Acme ");
    setText("guest-vehicle-plate", " ABC123 ");
    setText("guest-purpose", " Inspection ");
    toggleSwitch("guest-safety-switch");

    expect(isDisabled(firstByTestId("guest-submit-btn"))).toBe(false);

    fireEvent.click(firstByTestId("guest-submit-btn"));

    await waitFor(() => {
      expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(startGuestSessionMock).toHaveBeenCalledWith({
      firstName: "Jane",
      lastName: "Doe",
      phone: "555-1234",
      email: "jane@example.com",
      company: "Acme",
      vehiclePlate: "ABC123",
      purpose: "Inspection",
      safetyAcknowledged: true,
    });

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/visitor-checkin");
    });
  });

  it("omits unfilled optional fields from the payload (sent as undefined, not empty strings)", async () => {
    render(<GuestLoginScreen />);

    setText("guest-first-name", "Jane");
    setText("guest-last-name", "Doe");
    toggleSwitch("guest-safety-switch");

    fireEvent.click(firstByTestId("guest-submit-btn"));

    await waitFor(() => {
      expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(startGuestSessionMock).toHaveBeenCalledWith({
      firstName: "Jane",
      lastName: "Doe",
      phone: undefined,
      email: undefined,
      company: undefined,
      vehiclePlate: undefined,
      purpose: undefined,
      safetyAcknowledged: true,
    });
  });

  it("does not navigate away when startGuestSession rejects", async () => {
    startGuestSessionMock.mockRejectedValueOnce(new Error("boom"));

    render(<GuestLoginScreen />);
    setText("guest-first-name", "Jane");
    setText("guest-last-name", "Doe");
    toggleSwitch("guest-safety-switch");
    fireEvent.click(firstByTestId("guest-submit-btn"));

    await waitFor(() => {
      expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(routerReplaceMock).not.toHaveBeenCalledWith("/visitor-checkin");
  });

  it("navigates back to /login when the user taps the cancel link", () => {
    render(<GuestLoginScreen />);
    const cancel = screen.getAllByText("common.cancel")[0];
    fireEvent.click(cancel);
    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
  });

  // Task #113 — visitors who can't tap the button got no explanation about
  // *which* required field was empty. The fix surfaces inline hints next
  // to first name, last name, and the safety toggle so the form actually
  // tells you what to do.
  describe("inline required-field hints", () => {
    it("does not show any inline hints on first render (visitor hasn't touched anything yet)", () => {
      render(<GuestLoginScreen />);
      expect(screen.queryByTestId("guest-first-name-hint")).toBeNull();
      expect(screen.queryByTestId("guest-last-name-hint")).toBeNull();
      expect(screen.queryByTestId("guest-safety-hint")).toBeNull();
    });

    it("shows the 'Required' hint next to first name once the visitor blurs the field while empty", () => {
      render(<GuestLoginScreen />);
      // No hint while just focused — only after a blur.
      fireEvent.blur(firstByTestId("guest-first-name"));
      const hint = screen.getByTestId("guest-first-name-hint");
      expect(hint).toBeTruthy();
      expect(hint.textContent).toBe("Obligatorio");
    });

    it("shows the 'Required' hint next to last name once the visitor blurs the field while empty", () => {
      render(<GuestLoginScreen />);
      fireEvent.blur(firstByTestId("guest-last-name"));
      const hint = screen.getByTestId("guest-last-name-hint");
      expect(hint).toBeTruthy();
      expect(hint.textContent).toBe("Obligatorio");
    });

    it("clears a name hint as soon as the visitor types something into the field", () => {
      render(<GuestLoginScreen />);
      fireEvent.blur(firstByTestId("guest-first-name"));
      expect(screen.getByTestId("guest-first-name-hint")).toBeTruthy();
      setText("guest-first-name", "Jane");
      expect(screen.queryByTestId("guest-first-name-hint")).toBeNull();
    });

    it("does NOT show the safety hint on blur of name fields — safety only flags after a submit attempt", () => {
      render(<GuestLoginScreen />);
      fireEvent.blur(firstByTestId("guest-first-name"));
      fireEvent.blur(firstByTestId("guest-last-name"));
      // The Switch can't be "blurred" the way an input can, so the safety
      // hint is gated on attempting to submit.
      expect(screen.queryByTestId("guest-safety-hint")).toBeNull();
    });

    it("on submit with an empty form, surfaces hints for first name, last name, AND safety all at once", () => {
      render(<GuestLoginScreen />);
      fireEvent.click(firstByTestId("guest-submit-btn"));

      expect(screen.getByTestId("guest-first-name-hint").textContent).toBe(
        "Obligatorio",
      );
      expect(screen.getByTestId("guest-last-name-hint").textContent).toBe(
        "Obligatorio",
      );
      // Safety hint reuses the existing localized copy.
      expect(screen.getByTestId("guest-safety-hint").textContent).toBe(
        "Por favor confirme que acepta las reglas de seguridad.",
      );
      expect(startGuestSessionMock).not.toHaveBeenCalled();
    });

    it("on submit with names filled but safety off, only the safety hint appears", () => {
      render(<GuestLoginScreen />);
      setText("guest-first-name", "Jane");
      setText("guest-last-name", "Doe");
      fireEvent.click(firstByTestId("guest-submit-btn"));

      expect(screen.queryByTestId("guest-first-name-hint")).toBeNull();
      expect(screen.queryByTestId("guest-last-name-hint")).toBeNull();
      expect(screen.getByTestId("guest-safety-hint")).toBeTruthy();
      expect(startGuestSessionMock).not.toHaveBeenCalled();
    });

    it("clears the safety hint as soon as the visitor flips the toggle on", () => {
      render(<GuestLoginScreen />);
      fireEvent.click(firstByTestId("guest-submit-btn"));
      expect(screen.getByTestId("guest-safety-hint")).toBeTruthy();
      toggleSwitch("guest-safety-switch");
      expect(screen.queryByTestId("guest-safety-hint")).toBeNull();
    });

    it("does NOT pop a blocking Alert for missing fields — the hints replace the old Alert path", () => {
      const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      render(<GuestLoginScreen />);
      fireEvent.click(firstByTestId("guest-submit-btn"));
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it("treats whitespace-only names as empty and surfaces the hint after submit", () => {
      render(<GuestLoginScreen />);
      setText("guest-first-name", "   ");
      setText("guest-last-name", "Doe");
      toggleSwitch("guest-safety-switch");
      fireEvent.click(firstByTestId("guest-submit-btn"));

      expect(screen.getByTestId("guest-first-name-hint")).toBeTruthy();
      expect(screen.queryByTestId("guest-last-name-hint")).toBeNull();
      expect(screen.queryByTestId("guest-safety-hint")).toBeNull();
      expect(startGuestSessionMock).not.toHaveBeenCalled();
    });
  });

  // Task #539 — Spanish visitors must see localized copy when the server
  // rejects the guest sign-in. We assert the actual Spanish strings end up
  // in the Alert (not the raw English `err.message`), which proves the
  // screen is routing the error through translateApiError().
  describe("localized API error rendering", () => {
    function makeApiError(code: string): Error {
      const err = new Error(`raw english copy for ${code}`) as Error & {
        status?: number;
        code?: string;
        data?: { code?: string };
      };
      err.status = 400;
      err.code = code;
      err.data = { code };
      return err;
    }

    async function submitValidForm(): Promise<void> {
      render(<GuestLoginScreen />);
      setText("guest-first-name", "Jane");
      setText("guest-last-name", "Doe");
      toggleSwitch("guest-safety-switch");
      fireEvent.click(firstByTestId("guest-submit-btn"));
      await waitFor(() => {
        expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
      });
    }

    it("shows the Spanish copy for guest.name_required from the server", async () => {
      const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      startGuestSessionMock.mockRejectedValueOnce(
        makeApiError("guest.name_required"),
      );

      await submitValidForm();

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          "Error",
          "El nombre y apellido son obligatorios.",
        );
      });
      alertSpy.mockRestore();
    });

    it("shows the Spanish copy for guest.safety_required from the server", async () => {
      const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      startGuestSessionMock.mockRejectedValueOnce(
        makeApiError("guest.safety_required"),
      );

      await submitValidForm();

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          "Error",
          "Confirma el aviso de seguridad para continuar.",
        );
      });
      alertSpy.mockRestore();
    });
  });
});
