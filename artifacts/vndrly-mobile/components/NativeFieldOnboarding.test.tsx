import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeFieldOnboarding from "./NativeFieldOnboarding";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  generation: 1,
  listeners: new Set<() => void>(),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white" }) }));
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
  pickOnboardingFieldPhoto: vi.fn(),
}));
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
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
const payload = {
  info: {
    firstName: "Sam",
    lastName: "Demo",
    phone: "555",
    vendorRole: "field",
  },
  photoUrl: "/objects/actual-upload",
  pec: { certified: true, expirationDate: "2027-10-01" },
};
const progress = {
  id: 1,
  orgType: "field_employee",
  currentStep: "set-password",
  payload,
  completedSteps: [],
  skippedSteps: [],
  completedAt: null,
};
beforeEach(() => {
  env.generation = 1;
  env.api
    .mockReset()
    .mockImplementation(async (path) =>
      path.endsWith("/complete")
        ? { progress: { ...progress, completedAt: "2026-10-07T12:00:00Z" } }
        : { vendorName: "Synthetic company", progress },
    );
});
afterEach(cleanup);
it("uses the exact invitation endpoint and never saves a password in progress", async () => {
  render(<NativeFieldOnboarding token="synthetic-token-only" />);
  await screen.findByText("Synthetic company");
  fireEvent.change(screen.getByLabelText("onboardingNative.password"), {
    target: { value: "synthetic-device-input" },
  });
  fireEvent.change(screen.getByLabelText("onboardingNative.confirmPassword"), {
    target: { value: "synthetic-device-input" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "onboardingNative.finish" }),
  );
  await screen.findByText("onboardingNative.completedSignIn");
  const saved = env.api.mock.calls.find(([path]) =>
    path.endsWith("/progress"),
  )!;
  expect(saved[1].body).not.toContain("synthetic-device-input");
  const finished = env.api.mock.calls.find(([path]) =>
    path.endsWith("/complete"),
  )!;
  expect(finished[0]).toBe(
    "/api/onboarding/field/by-token/synthetic-token-only/complete",
  );
  expect(JSON.parse(finished[1].body)).toMatchObject({
    vendorRole: "field",
    pecCertification: true,
    photoUrl: "/objects/actual-upload",
    password: "synthetic-device-input",
  });
});
it("clears password and invite data on account changes", async () => {
  render(<NativeFieldOnboarding token="synthetic-token-only" />);
  await screen.findByText("Synthetic company");
  fireEvent.change(screen.getByLabelText("onboardingNative.password"), {
    target: { value: "private-input" },
  });
  env.generation++;
  env.listeners.forEach((listener) => listener());
  await waitFor(() =>
    expect(screen.queryByLabelText("onboardingNative.password")).toBeNull(),
  );
  expect(screen.queryByDisplayValue("private-input")).toBeNull();
  expect(env.api.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(
    false,
  );
});
