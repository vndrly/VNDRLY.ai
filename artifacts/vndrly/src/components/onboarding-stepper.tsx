import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  key: string;
  label: string;
}

interface OnboardingStepperProps {
  steps: StepperStep[];
  /** Index of the step the user is currently editing. */
  currentIndex: number;
  /** Step keys the user has explicitly completed (Next-clicked or saved). */
  completedKeys?: string[];
  /** Step keys the user has chosen to "Skip for now". */
  skippedKeys?: string[];
  className?: string;
}

/**
 * Generic, brand-styled progress stepper used by every onboarding
 * wizard (Partner / Vendor / Field Employee). Visually mirrors
 * `TicketStatusStepper` so all branded progress visuals across the app
 * share one identity. The stepper is purely presentational — it does
 * not know how to navigate, the wizard owns that.
 */
export default function OnboardingStepper({
  steps,
  currentIndex,
  completedKeys = [],
  skippedKeys = [],
  className,
}: OnboardingStepperProps) {
  const completedSet = new Set(completedKeys);
  const skippedSet = new Set(skippedKeys);

  // Brand-color glossy fill: matches TicketStatusStepper exactly so the
  // two visual families read as one design system.
  const brandGlossStyle = {
    backgroundColor: "var(--brand-primary, #f59e0b)",
    backgroundImage:
      "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 50%, transparent 50%, transparent 100%)",
    borderColor: "var(--brand-primary, #f59e0b)",
  } as const;
  const brandLineStyle = { backgroundColor: "var(--brand-primary, #f59e0b)" } as const;
  const brandTextStyle = { color: "var(--brand-primary, #f59e0b)" } as const;

  return (
    <div className={cn("w-full", className)} data-testid="onboarding-stepper">
      <div
        className="grid gap-0"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, i) => {
          const isCompleted = completedSet.has(step.key) || i < currentIndex;
          const isCurrent = i === currentIndex;
          const isSkipped = skippedSet.has(step.key);
          const isBrandActive = isCompleted || isCurrent;

          const dotBg = isSkipped
            ? "bg-amber-100 border-amber-400 text-amber-700"
            : isBrandActive
              ? "text-white"
              : "bg-white border-gray-300 text-gray-400";

          const leftLineActive = i <= currentIndex || isCompleted;
          const rightLineActive = i + 1 <= currentIndex || (i + 1 < steps.length && completedSet.has(steps[i + 1]?.key ?? ""));

          const labelClass = isCurrent
            ? "font-bold"
            : isCompleted
              ? "text-gray-700 font-medium"
              : "text-gray-400";

          return (
            <div key={step.key} className="flex flex-col items-center relative">
              {i > 0 && (
                <div
                  className={cn(
                    "absolute top-3 right-1/2 left-0 h-0.5 mr-3",
                    !leftLineActive ? "bg-gray-300" : "",
                  )}
                  style={leftLineActive ? brandLineStyle : undefined}
                />
              )}
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "absolute top-3 left-1/2 right-0 h-0.5 ml-3",
                    !rightLineActive ? "bg-gray-300" : "",
                  )}
                  style={rightLineActive ? brandLineStyle : undefined}
                />
              )}
              <div
                className={cn(
                  "relative z-10 w-6 h-6 rounded-full border-2 shadow-sm flex items-center justify-center transition-colors",
                  dotBg,
                )}
                style={isBrandActive && !isSkipped ? brandGlossStyle : undefined}
                data-testid={`step-${step.key}-${isCompleted ? "done" : isCurrent ? "current" : isSkipped ? "skipped" : "future"}`}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : isCurrent ? (
                  <div className="w-2 h-2 rounded-full bg-white" />
                ) : isSkipped ? (
                  <span className="text-[10px] font-bold leading-none">!</span>
                ) : null}
              </div>
              <span
                className={cn("mt-1.5 text-[11px] text-center leading-tight px-1", labelClass)}
                style={isCurrent ? brandTextStyle : undefined}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
