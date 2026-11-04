import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingProgressRow } from "@/lib/onboarding-api";

const { navigate, useProgress } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useProgress: vi.fn((): { progress: OnboardingProgressRow | null } => ({ progress: null })),
}));

vi.mock("wouter", async (importOriginal) => ({
  ...await importOriginal<typeof import("wouter")>(),
  useLocation: () => ["/", navigate],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key === "onboardingProgress.legalConsent" ? "Privacy & Messaging" : key }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#00a9c7" }),
}));

vi.mock("@/hooks/use-onboarding-progress", () => ({
  useOnboardingProgress: useProgress,
}));

import FinishSetupWidget, { DashboardSetup } from "./finish-setup-widget";

const completedVendorProgress: OnboardingProgressRow = {
  id: 1,
  orgType: "vendor",
  vendorId: 1,
  currentStep: "first-employee",
  completedSteps: [
    "company-basics",
    "platform-eula",
    "legal-consent",
    "branding",
    "tax-ids",
    "work-types",
    "first-employee",
  ],
  skippedSteps: [],
  payload: {},
  startedAt: "2026-09-09T12:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-09-09T12:00:00.000Z",
};

describe("FinishSetupWidget", () => {
  it("hides a legacy vendor banner when every current onboarding step is done", () => {
    render(<FinishSetupWidget progressOverride={completedVendorProgress} />);

    expect(screen.queryByTestId("finish-setup-widget")).toBeNull();
  });
});

it('keeps required privacy consent visible when all other partner steps are complete', () => {
  sessionStorage.clear();
  render(<FinishSetupWidget progressOverride={{ ...completedVendorProgress, orgType: 'partner', currentStep: 'legal-consent', completedSteps: ['company-basics', 'platform-eula', 'branding', 'first-site', 'tax-billing', 'preferences', 'invite-team'] }} />);
  expect(screen.getByTestId('finish-setup-widget')).not.toBeNull();
  expect(screen.getByText('Privacy & Messaging')).not.toBeNull();
  expect(screen.getByTitle(/Platform Agreement/)).not.toBeNull();
});

it('does not count a skipped mandatory legal step as completion', () => {
  sessionStorage.clear();
  render(<FinishSetupWidget progressOverride={{ ...completedVendorProgress, currentStep: 'legal-consent', completedSteps: completedVendorProgress.completedSteps.filter(step => step !== 'legal-consent'), skippedSteps: ['legal-consent'] }} />);
  expect(screen.getByTestId('finish-setup-widget')).not.toBeNull();
  expect(screen.getByText('Privacy & Messaging')).not.toBeNull();
});


it("links skipped and unvisited steps from the dashboard and opens the selected step", () => {
  useProgress.mockReturnValueOnce({
    progress: {
      ...completedVendorProgress,
      completedSteps: ["company-basics", "platform-eula", "legal-consent"],
      skippedSteps: ["branding"],
    },
  });
  render(<DashboardSetup orgType="vendor" orgId={1} />);
  expect(screen.getByRole("link", { name: "Add your vendor logo and brand color" }).getAttribute("href")).toBe("/onboarding/vendor?step=branding");
  expect(screen.getByRole("link", { name: "Set service area and work types" }).getAttribute("href")).toBe("/onboarding/vendor?step=work-types");
  fireEvent.click(screen.getAllByRole("button", { name: "Tax IDs" })[0]);
  expect(navigate).toHaveBeenCalledWith("/onboarding/vendor?step=tax-ids");
});
