import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Task #485 — guarantee the field-employee invite wizard renders in
// Spanish when the toggle is set to Español. Task #477 made the
// assistant reply in Spanish from the very first turn, but until this
// task the surrounding wizard (labels, headings, helper text, button
// labels, validation toasts) was still English-only. This test mounts
// the page with a Spanish-preferring invite, then asserts the visible
// copy across all three steps + the validation toast renders in
// Spanish — and then flips the toggle back to English to confirm the
// re-render happens without a full reload.

// --- wouter: useRoute returns the static field invite route, useLocation
// is a no-op navigate. Mounting a real <Router> is overkill for a
// translation regression — we just need the route params to populate.
vi.mock("wouter", () => ({
  useRoute: () => [true, { token: "test-token" }],
  useLocation: () => [
    "/onboarding/field/test-token",
    () => undefined,
  ],
}));

// --- onboardingApi: returns a Spanish-preferring invitee. The page
// hydrates `info.preferredLanguage = "es"` from this and switches the
// global i18n locale to "es" on mount, which is what flips every
// `t(...)` call to its Spanish translation.
const getFieldByTokenMock = vi.fn();
const updateFieldLanguageMock = vi.fn();
vi.mock("@/lib/onboarding-api", () => ({
  onboardingApi: {
    getFieldByToken: (token: string) => getFieldByTokenMock(token),
    updateFieldLanguageByToken: (token: string, lang: "en" | "es" | null) =>
      updateFieldLanguageMock(token, lang),
    updateFieldProgressByToken: () => Promise.resolve({}),
    completeFieldByToken: () => Promise.resolve({}),
  },
}));

// --- Toaster: capture toast titles so the regression can assert the
// Spanish copy of the validation toast that fires when the invitee
// hits Continue with empty name fields.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Reset the global i18n state before each test so a "switch back to EN"
// run can't bleed into a "renders in ES" run.
import i18n from "@/lib/i18n";

import OnboardingField from "./onboarding-field";

beforeEach(async () => {
  toastSpy.mockReset();
  getFieldByTokenMock.mockReset();
  updateFieldLanguageMock.mockReset();
  // Default to English between tests; individual tests bump to Spanish.
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function makeFieldInviteResponse(preferredLanguage: "en" | "es" | null = "es") {
  return {
    vendorPeopleId: 1,
    vendorId: 11,
    vendorName: "Acme Vendor",
    firstName: "",
    lastName: "",
    email: "crew@example.com",
    phone: null,
    photoUrl: null,
    preferredLanguage,
    progress: {
      id: 1,
      orgType: "field_employee" as const,
      vendorPeopleId: 1,
      currentStep: "personal-info",
      completedSteps: [],
      skippedSteps: [],
      payload: {},
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

describe("OnboardingField Spanish wizard (Task #485)", () => {
  it("renders the personal-info step in Spanish when the invitee prefers Español", async () => {
    getFieldByTokenMock.mockResolvedValueOnce(makeFieldInviteResponse("es"));

    render(<OnboardingField />);

    // Wait for the API call to resolve and the page to hydrate the
    // Spanish locale before asserting any copy.
    await waitFor(() =>
      expect(screen.getByText("Bienvenido a Acme Vendor")).toBeTruthy(),
    );

    // Hero copy + first-step heading both in Spanish.
    expect(
      screen.getByText("Vamos a preparar tu cuenta en 3 pasos rápidos."),
    ).toBeTruthy();
    expect(screen.getByText("Confirma tus datos personales")).toBeTruthy();

    // Field labels — render in Spanish, including the asterisk on
    // required ones (matches the rest of the wizard's "Field *" pattern).
    expect(screen.getByText("Nombre *")).toBeTruthy();
    expect(screen.getByText("Apellido *")).toBeTruthy();
    expect(screen.getByText("Teléfono")).toBeTruthy();
    expect(screen.getByText("Idioma preferido")).toBeTruthy();
    expect(screen.getByText("¿Qué tipo de trabajo realizarás? *")).toBeTruthy();

    // Role chips translated.
    expect(screen.getByTestId("role-field").textContent).toBe("Campo");
    expect(screen.getByTestId("role-foreman").textContent).toBe("Capataz");
    expect(screen.getByTestId("role-office").textContent).toBe("Oficina");
    expect(screen.getByTestId("role-both").textContent).toBe("Campo + Oficina");

    // Stepper labels.
    expect(screen.getByText("Datos personales")).toBeTruthy();
    expect(screen.getByText("Foto y certificados")).toBeTruthy();
    expect(screen.getByText("Crear contraseña")).toBeTruthy();

    // Continue button.
    expect(screen.getByTestId("button-next").textContent).toBe("Continuar");
  });

  it("fires Spanish validation toasts when required fields are empty", async () => {
    getFieldByTokenMock.mockResolvedValueOnce(makeFieldInviteResponse("es"));

    render(<OnboardingField />);
    await waitFor(() =>
      expect(screen.getByText("Bienvenido a Acme Vendor")).toBeTruthy(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-next"));

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Se requieren nombre y apellido.",
        variant: "destructive",
      }),
    );
  });

  it("re-renders in English when the language toggle is flipped back, without a reload", async () => {
    getFieldByTokenMock.mockResolvedValueOnce(makeFieldInviteResponse("es"));
    updateFieldLanguageMock.mockResolvedValue({ preferredLanguage: "en" });

    render(<OnboardingField />);
    await waitFor(() =>
      expect(screen.getByText("Bienvenido a Acme Vendor")).toBeTruthy(),
    );

    // Sanity: we're starting in Spanish.
    expect(screen.getByText("Confirma tus datos personales")).toBeTruthy();

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("lang-en"));
    });

    // The page must re-render in English without us having to remount
    // it — i18n.changeLanguage propagation through useTranslation is
    // what makes this work.
    await waitFor(() =>
      expect(screen.getByText("Welcome to Acme Vendor")).toBeTruthy(),
    );
    expect(screen.getByText("Confirm your personal info")).toBeTruthy();
    expect(screen.getByTestId("button-next").textContent).toBe("Continue");

    // The toggle also persisted the new choice up to vendor_people so
    // the assistant primes in English on the next visit.
    expect(updateFieldLanguageMock).toHaveBeenCalledWith("test-token", "en");
  });

  it("renders the localised invalid-token card in Spanish when the active locale is es", async () => {
    // No preferredLanguage to inherit from the API — the user landed
    // on a dead link, so we exercise the *active* locale codepath.
    await i18n.changeLanguage("es");
    getFieldByTokenMock.mockRejectedValueOnce(new Error("not found"));

    render(<OnboardingField />);

    await waitFor(() =>
      expect(
        screen.getByText("Enlace de invitación no encontrado"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "Este enlace de invitación no es válido o ya se utilizó. Pide a tu empleador que te envíe uno nuevo.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Volver a iniciar sesión")).toBeTruthy();
  });
});
