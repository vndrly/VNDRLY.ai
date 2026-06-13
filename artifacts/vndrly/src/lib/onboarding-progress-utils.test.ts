import { describe, expect, it } from "vitest";
import type { OnboardingProgressRow } from "@/lib/onboarding-api";
import {
  isOnboardingIncomplete,
  vendorFeatureUnlocked,
} from "./onboarding-progress-utils";

const vendorProgress = (overrides: Partial<OnboardingProgressRow> = {}): OnboardingProgressRow => ({
  id: 1,
  orgType: "vendor",
  vendorId: 10,
  currentStep: "branding",
  completedSteps: ["company-basics"],
  skippedSteps: [],
  payload: {},
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("onboarding-progress-utils", () => {
  it("treats incomplete vendor progress as incomplete", () => {
    expect(isOnboardingIncomplete(vendorProgress())).toBe(true);
  });

  it("locks hotlist bid area until work-types is done", () => {
    expect(vendorFeatureUnlocked(vendorProgress(), "hotlist_bid_area")).toBe(false);
    expect(
      vendorFeatureUnlocked(
        vendorProgress({ completedSteps: ["company-basics", "work-types"] }),
        "hotlist_bid_area",
      ),
    ).toBe(true);
  });
});
