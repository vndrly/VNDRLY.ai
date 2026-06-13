import type { OnboardingProgressRow } from "@/lib/onboarding-api";

export type OnboardingOrgType = "partner" | "vendor";

export function isOnboardingIncomplete(
  progress: OnboardingProgressRow | null | undefined,
): boolean {
  if (!progress) return false;
  if (progress.orgType !== "partner" && progress.orgType !== "vendor") return false;
  return !progress.completedAt;
}

export function isOnboardingStepDone(
  progress: OnboardingProgressRow,
  stepKey: string,
): boolean {
  const done = new Set([
    ...(progress.completedSteps ?? []),
    ...(progress.skippedSteps ?? []),
  ]);
  return done.has(stepKey);
}

export function onboardingStepHref(
  orgType: OnboardingOrgType,
  stepKey: string,
): string {
  return `/onboarding/${orgType}?step=${encodeURIComponent(stepKey)}`;
}

export function onboardingResumeHref(
  progress: OnboardingProgressRow,
  stepKey?: string,
): string {
  const step = stepKey ?? progress.currentStep ?? "";
  const qs = step ? `?step=${encodeURIComponent(step)}` : "";
  return `/onboarding/${progress.orgType}${qs}`;
}

/** Vendor features that unlock as onboarding steps are completed. */
export const VENDOR_FEATURE_STEPS = {
  hotlist_browse: "company-basics",
  hotlist_bid_area: "work-types",
} as const;

export type VendorFeatureKey = keyof typeof VENDOR_FEATURE_STEPS;

export function vendorFeatureUnlocked(
  progress: OnboardingProgressRow | null | undefined,
  feature: VendorFeatureKey,
): boolean {
  if (!progress || progress.orgType !== "vendor") return true;
  if (progress.completedAt) return true;
  const requiredStep = VENDOR_FEATURE_STEPS[feature];
  return isOnboardingStepDone(progress, requiredStep);
}

export function vendorFeatureUnlockMessage(
  progress: OnboardingProgressRow | null | undefined,
  feature: VendorFeatureKey,
): { stepKey: string; href: string } | null {
  if (!progress || progress.orgType !== "vendor") return null;
  if (vendorFeatureUnlocked(progress, feature)) return null;
  const stepKey = VENDOR_FEATURE_STEPS[feature];
  return { stepKey, href: onboardingStepHref("vendor", stepKey) };
}
