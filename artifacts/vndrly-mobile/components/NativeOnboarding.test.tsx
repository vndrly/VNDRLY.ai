import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeOnboarding from "./NativeOnboarding";
import { LEGAL_POLICY_VERSION } from "@workspace/api-zod";
import { PLATFORM_EULA_VERSION } from "../../../lib/platform-eula/src/index";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  generation: 1,
  listeners: new Set<() => void>(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: env.generation }),
  isAuthScopeCurrent: (scope: any) => scope.generation === env.generation,
  subscribeUser: (fn: any) => {
    env.listeners.add(fn);
    return () => env.listeners.delete(fn);
  },
  subscribeToken: () => () => {},
}));
vi.mock("@/lib/onboarding-field-photo", () => ({
  pickOnboardingCompanyLogo: vi.fn(),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black" }) }));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled, accessibilityLabel }: any) => (
    <button
      disabled={disabled}
      aria-label={accessibilityLabel}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const progress = {
  id: 1,
  orgType: "vendor",
  vendorId: 7,
  currentStep: "first-employee",
  payload: {},
  completedSteps: [],
  skippedSteps: [],
  completedAt: null,
};
beforeEach(() => {
  env.generation = 1;
  env.api.mockReset().mockImplementation(async () => progress);
});
afterEach(cleanup);
it("defers the last section without requesting final completion", async () => {
  render(<NativeOnboarding organization={{ type: "vendor", id: 7 }} />);
  await screen.findAllByText("onboardingNative.sections.first-employee");
  fireEvent.click(
    screen.getByRole("button", { name: "onboardingNative.defer" }),
  );
  await waitFor(() =>
    expect(env.api.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
      true,
    ),
  );
  const saved = env.api.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(JSON.parse(saved[1].body)).toMatchObject({
    currentStep: "first-employee",
    skippedSteps: ["first-employee"],
  });
  expect(env.api.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(
    false,
  );
});
it("retains canonical missing-field errors and never displays completion from a failed finalizer", async () => {
  const loaded = {
    ...progress,
    currentStep: "done",
    payload: {
      platformEula: { accepted: true, version: PLATFORM_EULA_VERSION },
      legalConsent: { accepted: true, version: LEGAL_POLICY_VERSION },
      taxIds: {
        federalTaxId: "fictional",
        stateTaxId: "fictional",
        physicalAddress: "fictional",
        billingAddress: "fictional",
      },
      serviceArea: { operatingRadiusMiles: 50 },
      workTypeIds: [1],
      firstEmployee: {
        firstName: "Sam",
        lastName: "Demo",
        email: "synthetic@example.invalid",
      },
    },
  };
  env.api.mockImplementation(async (path) => {
    if (path.endsWith("/complete"))
      throw Object.assign(new Error("Required fields missing"), {
        data: { missing: ["taxIds.federalTaxId"] },
        status: 400,
      });
    return loaded;
  });
  render(<NativeOnboarding organization={{ type: "vendor", id: 7 }} />);
  await screen.findByRole("button", { name: "onboardingNative.finish" });
  fireEvent.click(
    screen.getByRole("button", { name: "onboardingNative.finish" }),
  );
  expect(await screen.findByText(/taxIds.federalTaxId/)).toBeTruthy();
  expect(screen.queryByText("onboardingNative.completed")).toBeNull();
  expect(env.api.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(
    true,
  );
});
it("discards a delayed progress response after the authenticated account changes", async () => {
  let resolve!: (value: any) => void;
  env.api.mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  render(<NativeOnboarding organization={{ type: "partner", id: 609 }} />);
  env.generation++;
  env.listeners.forEach((listener) => listener());
  resolve({
    ...progress,
    orgType: "partner",
    partnerId: 609,
    payload: { taxBilling: { federalTaxId: "private-old-account" } },
  });
  await waitFor(() =>
    expect(screen.getByText("onboardingNative.accountChanged")).toBeTruthy(),
  );
  expect(
    screen.queryByRole("button", { name: "onboardingNative.finish" }),
  ).toBeNull();
  expect(screen.queryByDisplayValue("private-old-account")).toBeNull();
});
it("does not mark a stale legal acceptance complete without current human acceptance", async () => {
  env.api.mockResolvedValue({
    ...progress,
    currentStep: "legal-consent",
    payload: {
      legalConsent: { accepted: true, version: "2026-08-20", smsOptIn: false },
    },
  });
  render(<NativeOnboarding organization={{ type: "vendor", id: 7 }} />);
  await screen.findByRole("button", { name: "onboardingNative.saveContinue" });
  fireEvent.click(
    screen.getByRole("button", { name: "onboardingNative.saveContinue" }),
  );
  await screen.findByText(/onboardingNative.missing/);
  expect(
    env.api.mock.calls.some(
      ([, init]) => init?.method === "PUT" || init?.method === "POST",
    ),
  ).toBe(false);
});
it("does not treat historical completion with stale policy acceptance as current completion", async () => {
  env.api.mockResolvedValue({
    ...progress,
    completedAt: "2026-08-21T12:00:00Z",
    payload: { legalConsent: { accepted: true, version: "2026-08-20" } },
  });
  render(<NativeOnboarding organization={{ type: "vendor", id: 7 }} />);
  await screen.findByRole("button", { name: "onboardingNative.finish" });
  expect(screen.queryByText("onboardingNative.completed")).toBeNull();
});
