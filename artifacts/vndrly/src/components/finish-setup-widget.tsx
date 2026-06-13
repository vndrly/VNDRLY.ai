import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { CheckCircle2, Circle } from "lucide-react";
import { type OnboardingProgressRow } from "@/lib/onboarding-api";
import { useTranslation } from "react-i18next";
import { useBrand } from "@/hooks/use-brand";
import { useOnboardingProgress } from "@/hooks/use-onboarding-progress";
import {
  isOnboardingIncomplete,
  onboardingResumeHref,
  onboardingStepHref,
} from "@/lib/onboarding-progress-utils";

type StepEntry = { key: string; label: string; href: string };

const PARTNER_STEPS: Record<string, { label: string; href: string }> = {
  "platform-eula": { label: "Accept the VNDRLY Platform Agreement", href: "/onboarding/partner?step=platform-eula" },
  branding: { label: "Add your logo and brand colors", href: "/onboarding/partner?step=branding" },
  "first-site": { label: "Set up your first site", href: "/onboarding/partner?step=first-site" },
  "tax-billing": { label: "Add tax IDs and billing address", href: "/onboarding/partner?step=tax-billing" },
  preferences: { label: "Set hours of operation and operating radius", href: "/onboarding/partner?step=preferences" },
  "invite-team": { label: "Invite teammates", href: "/onboarding/partner?step=invite-team" },
};

const VENDOR_STEPS: Record<string, { label: string; href: string }> = {
  "platform-eula": { label: "Accept the VNDRLY Platform Agreement", href: "/onboarding/vendor?step=platform-eula" },
  branding: { label: "Add your vendor logo and brand color", href: "/onboarding/vendor?step=branding" },
  "tax-ids": { label: "Add tax IDs and billing address", href: "/onboarding/vendor?step=tax-ids" },
  "work-types": { label: "Set service area and work types", href: "/onboarding/vendor?step=work-types" },
  compliance: { label: "Upload your insurance certificate", href: "/onboarding/vendor?step=compliance" },
  rates: { label: "Set your rates and 1099 delivery", href: "/onboarding/vendor?step=rates" },
  "first-employee": { label: "Add your first field employee", href: "/onboarding/vendor?step=first-employee" },
};

// Canonical step order per org type. Mirrors the same lists used by
// the onboarding wizards (artifacts/vndrly/src/pages/onboarding-*.tsx)
// and the assistant-panel mini stepper so the dashboard widget shows
// the user the same sequence they'll walk through.
const STEPS_BY_ORG: Record<"partner" | "vendor", { key: string; label: string }[]> = {
  partner: [
    { key: "company-basics", label: "Company Basics" },
    { key: "platform-eula", label: "Platform Agreement" },
    { key: "branding", label: "Branding" },
    { key: "first-site", label: "First Site" },
    { key: "tax-billing", label: "Tax & Billing" },
    { key: "preferences", label: "Preferences" },
    { key: "invite-team", label: "Invite Team" },
  ],
  vendor: [
    { key: "company-basics", label: "Company Basics" },
    { key: "platform-eula", label: "Platform Agreement" },
    { key: "branding", label: "Branding" },
    { key: "tax-ids", label: "Tax IDs" },
    { key: "work-types", label: "Service & Work Types" },
    { key: "compliance", label: "Compliance" },
    { key: "rates", label: "Rates & 1099" },
    { key: "first-employee", label: "First Employee" },
  ],
};

// Session-scoped key used to remember "the user clicked Dismiss this
// session" so we don't keep popping the widget back up on every page
// nav. sessionStorage clears when the browser tab closes (and the
// auth/logout flow always lands on a fresh page load), so dismissal
// effectively persists "until next logon" — and the natural "all
// steps complete → widget hides itself" guard handles "until
// completed" without needing to read this key.
const DISMISS_STORAGE_KEY = "vndrly:finishSetup:dismissed";

interface FinishSetupWidgetProps {
  progressOverride?: OnboardingProgressRow | null;
}

export default function FinishSetupWidget({
  progressOverride,
}: FinishSetupWidgetProps = {}): React.ReactElement | null {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const brand = useBrand();
  const tint = brand.primary;
  const { progress: fetchedProgress } = useOnboardingProgress();
  const progress =
    progressOverride !== undefined ? progressOverride : fetchedProgress;
  // Lazily seed `hidden` from sessionStorage so a dismissed widget
  // stays dismissed across in-app navigation/refresh within the same
  // tab, but reappears on the next login (sessionStorage is per-tab
  // and is wiped when the tab/window closes).
  const [hidden, setHiddenState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(DISMISS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setHidden = (v: boolean) => {
    setHiddenState(v);
    if (typeof window !== "undefined") {
      try {
        if (v) window.sessionStorage.setItem(DISMISS_STORAGE_KEY, "1");
        else window.sessionStorage.removeItem(DISMISS_STORAGE_KEY);
      } catch {
        // sessionStorage unavailable (e.g. SSR / privacy mode) — fall
        // back to in-memory only, which still hides for the lifetime
        // of this mount.
      }
    }
  };

  const items: StepEntry[] = useMemo(() => {
    if (!progress) return [];
    const map = progress.orgType === "partner" ? PARTNER_STEPS : progress.orgType === "vendor" ? VENDOR_STEPS : {};
    return (progress.skippedSteps ?? [])
      .map((k) => {
        const entry = map[k];
        return entry ? { key: k, label: entry.label, href: entry.href } : null;
      })
      .filter((x): x is StepEntry => x !== null);
  }, [progress]);

  const incomplete = isOnboardingIncomplete(progress);
  const resumeHref =
    progress && incomplete ? onboardingResumeHref(progress) : null;

  const stepper = useMemo(() => {
    if (!progress || !incomplete) return null;
    if (progress.orgType !== "partner" && progress.orgType !== "vendor") {
      return null;
    }
    const steps = STEPS_BY_ORG[progress.orgType];
    const done = new Set([
      ...(progress.completedSteps ?? []),
      ...(progress.skippedSteps ?? []),
    ]);
    const currentIdx = steps.findIndex((s) => s.key === progress.currentStep);
    const doneCount = steps.filter((s) => done.has(s.key)).length;
    const currentLabel =
      currentIdx >= 0
        ? steps[currentIdx].label
        : (steps.find((s) => !done.has(s.key))?.label ?? null);
    return { steps, done, currentIdx, doneCount, currentLabel };
  }, [progress, incomplete]);

  if (hidden || !progress) return null;
  if (!incomplete && items.length === 0) return null;

  const goToStep = (stepKey: string) => {
    if (progress.orgType !== "partner" && progress.orgType !== "vendor") return;
    navigate(onboardingStepHref(progress.orgType, stepKey));
  };

  return (
    <Card
      className="border-2 bg-amber-50/30 mb-4"
      style={{ borderColor: tint }}
      data-testid="finish-setup-widget"
    >
      <CardHeader className="pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base leading-tight">
            {t("onboardingProgress.bannerTitle")}
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            {resumeHref && (
              <PillButton
                color="image"
                onClick={() => navigate(resumeHref)}
                data-testid="button-resume-onboarding"
                className="h-7 px-2 font-medium"
              >
                {t("onboardingActions.resume")}
              </PillButton>
            )}
            <PillButton
              color="red"
              onClick={() => setHidden(true)}
              data-testid="button-dismiss-finish-setup"
              className="h-7 px-2"
            >
              {t("onboardingProgress.dismiss")}
            </PillButton>
          </div>
        </div>
        {incomplete && (
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {t("onboardingProgress.bannerHint")}
          </p>
        )}
      </CardHeader>
      <CardContent className="pb-3">
        {stepper && (
          <div
            className={(items.length > 0 ? "mb-4 " : "") + "space-y-1.5"}
            data-testid="finish-setup-stepper"
          >
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span className="font-medium uppercase tracking-wide">
                {progress.orgType} {t("onboardingProgress.onboardingLabel")}
              </span>
              <span>
                {stepper.doneCount} / {stepper.steps.length}{" "}
                {t("onboardingProgress.stepsDone")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {stepper.steps.map((s, i) => {
                const isDone = stepper.done.has(s.key);
                const isCurrent = !isDone && i === stepper.currentIdx;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => goToStep(s.key)}
                    className="flex-1 flex items-center gap-1 min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                    title={`${s.label} — ${t("onboardingProgress.clickToContinue")}`}
                    data-testid={`finish-setup-stepper-${s.key}`}
                  >
                    {isDone ? (
                      <CheckCircle2
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: tint }}
                      />
                    ) : isCurrent ? (
                      <Circle
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: tint, fill: `${tint}33` }}
                      />
                    ) : (
                      <Circle className="w-3.5 h-3.5 shrink-0 text-gray-300" />
                    )}
                    {i < stepper.steps.length - 1 && (
                      <div
                        className="h-px flex-1"
                        style={{ backgroundColor: isDone ? tint : "rgb(229 231 235)" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {stepper.currentLabel && (
              <div className="text-xs text-gray-600">
                {t("onboardingProgress.currentStep")}:{" "}
                <button
                  type="button"
                  className="font-medium text-gray-800 underline-offset-2 hover:underline"
                  onClick={() => {
                    const key =
                      stepper.currentIdx >= 0
                        ? stepper.steps[stepper.currentIdx].key
                        : stepper.steps.find((s) => !stepper.done.has(s.key))?.key;
                    if (key) goToStep(key);
                  }}
                >
                  {stepper.currentLabel}
                </button>
              </div>
            )}
          </div>
        )}
        {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.key}
              className="flex items-center justify-between gap-3 text-sm"
              data-testid={`pending-step-${it.key}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: tint }}
                />
                <span className="text-gray-700 truncate">{it.label}</span>
              </div>
              <PillButton
                color="blue"
                className="h-auto p-0"
                onClick={() => navigate(it.href)}
                data-testid={`button-finish-step-${it.key}`}
              >
                {t("onboardingProgress.finishStep")}
              </PillButton>
            </li>
          ))}
        </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Top-of-layout banner — hidden on signup/onboarding wizard routes. */
export function OnboardingProgressBanner(): React.ReactElement | null {
  const [location] = useLocation();
  const onWizard =
    location.startsWith("/onboarding/") || location.startsWith("/signup/");
  if (onWizard) return null;
  return <FinishSetupWidget />;
}
