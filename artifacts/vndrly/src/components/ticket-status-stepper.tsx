import { useTranslation } from "react-i18next";
import { Check, AlertTriangle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface TicketStatusStepperProps {
  status: string;
  className?: string;
}

// 6-step stepper. Funds Dispersed is the new terminal step (Task #496).
// `funds_dispersed` flips the entire stepper green to signal a closed
// ticket. The actual `funds_dispersed` workflow (AP role + endpoint) is
// owned by the downstream task; here we only render the visual state.
const STEPS: { key: string; labelKey: string }[] = [
  { key: "initiated", labelKey: "tickets.initiated" },
  { key: "in_progress", labelKey: "tickets.inProgress" },
  { key: "completed", labelKey: "tickets.completed" },
  { key: "submitted", labelKey: "tickets.submitted" },
  { key: "approved", labelKey: "tickets.approved" },
  { key: "funds_dispersed", labelKey: "tickets.fundsDispersed" },
];

function statusToActiveIndex(status: string): number {
  switch (status) {
    case "draft":
    case "initiated":
    case "awaiting_acceptance":
    case "denied":
      return 0;
    case "in_progress":
      return 1;
    case "pending_review":
    case "completed":
      return 2;
    case "submitted":
    case "kicked_back":
      return 3;
    case "approved":
      return 4;
    // Task #576: awaiting_payment is a vendor-side branch off in_progress
    // ("we wrapped on site, the customer owes us"). It's the AP-blocking
    // sibling of "approved" — the next move is funds_dispersed — so we
    // light it up at the same step as approved on the stepper.
    case "awaiting_payment":
      return 4;
    case "funds_dispersed":
      return 5;
    case "cancelled":
      return -1;
    default:
      return 0;
  }
}

// Future-step grey (per spec). Source-of-truth for the parallel mobile
// stepper — keep these two values in sync (mobile/components/TicketStatusStepper.tsx).
const FUTURE_GREY = "#616161";
const SUCCESS_GREEN = "#16a34a";

export default function TicketStatusStepper({ status, className }: TicketStatusStepperProps) {
  const { t } = useTranslation();
  const activeIndex = statusToActiveIndex(status);
  const isCancelled = status === "cancelled";
  const isKickedBack = status === "kicked_back";
  const isAllSuccess = status === "funds_dispersed";
  const isAwaitingPayment = status === "awaiting_payment";

  // Task #576: When the ticket is awaiting_payment we render step 4 with the
  // "Awaiting Payment" label instead of "Approved" — the two states share a
  // slot on the stepper but are mutually exclusive, so the visible label
  // should always reflect the actual status.
  const stepsForStatus = isAwaitingPayment
    ? STEPS.map((step, i) =>
        i === 4 ? { ...step, labelKey: "tickets.awaitingPaymentStatus" } : step,
      )
    : STEPS;

  // Brand-color glossy fill: solid brand-primary base with a 50% white
  // overlay on the top half — same treatment used by the login-page
  // EN/ES toggle so the active dots/lines read as the partner brand.
  const brandColor = isAllSuccess ? SUCCESS_GREEN : "var(--brand-primary, #f59e0b)";
  const brandGlossStyle = {
    backgroundColor: brandColor,
    backgroundImage:
      "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 50%, transparent 50%, transparent 100%)",
    borderColor: brandColor,
  } as const;
  const brandLineStyle = { backgroundColor: brandColor } as const;
  const brandTextStyle = { color: brandColor } as const;

  // Future steps render in #616161 (per spec). When the entire stepper
  // is in the success state, every step uses the green token instead.
  const futureDotStyle = {
    backgroundColor: "#ffffff",
    borderColor: FUTURE_GREY,
    color: FUTURE_GREY,
  } as const;
  const futureLineStyle = { backgroundColor: FUTURE_GREY } as const;
  const futureTextStyle = { color: FUTURE_GREY } as const;

  return (
    <div className={cn("w-full", className)} data-testid="ticket-status-stepper">
      <div className="grid grid-cols-6 gap-0">
        {stepsForStatus.map((step, i) => {
          const isCompleted = !isCancelled && i < activeIndex;
          const isCurrent = !isCancelled && i === activeIndex;
          const isErrorAtCurrent = isCurrent && isKickedBack;
          // In the success state every step paints brand (green); otherwise
          // active = current + earlier.
          const isBrandActive =
            !isCancelled && !isErrorAtCurrent && (isAllSuccess || isCompleted || isCurrent);

          const dotBg = isCancelled
            ? "bg-gray-200 border-gray-300 text-gray-400"
            : isErrorAtCurrent
              ? "bg-gradient-to-b from-red-400 via-red-500 to-red-700 border-red-700/60 text-white"
              : isBrandActive
                ? "text-white"
                : "";

          // Lines: when fully successful every line is brand (green). Otherwise
          // a line is brand if both endpoints are at-or-before the active step;
          // future lines are #616161.
          const leftLineActive = isAllSuccess || (!isCancelled && i <= activeIndex);
          const rightLineActive = isAllSuccess || (!isCancelled && i + 1 <= activeIndex);

          const labelClass = isCancelled
            ? "text-gray-400"
            : isErrorAtCurrent
              ? "text-red-700 font-bold"
              : isCurrent && !isAllSuccess
                ? "font-bold"
                : isBrandActive
                  ? "font-medium"
                  : "";

          return (
            <div key={step.key} className="flex flex-col items-center relative">
              {i > 0 && (
                <div
                  className={cn(
                    "absolute top-3 right-1/2 left-0 h-0.5 mr-3",
                    isCancelled ? "bg-gray-300" : "",
                  )}
                  style={
                    isCancelled
                      ? undefined
                      : leftLineActive
                        ? brandLineStyle
                        : futureLineStyle
                  }
                />
              )}
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "absolute top-3 left-1/2 right-0 h-0.5 ml-3",
                    isCancelled ? "bg-gray-300" : "",
                  )}
                  style={
                    isCancelled
                      ? undefined
                      : rightLineActive
                        ? brandLineStyle
                        : futureLineStyle
                  }
                />
              )}
              <div
                className={cn(
                  "relative z-10 w-6 h-6 rounded-full border-2 shadow-sm flex items-center justify-center transition-colors",
                  dotBg,
                )}
                style={
                  isBrandActive
                    ? brandGlossStyle
                    : !isCancelled && !isErrorAtCurrent
                      ? futureDotStyle
                      : undefined
                }
                data-testid={`step-${step.key}-${
                  isAllSuccess && !isCurrent
                    ? "done"
                    : isCompleted
                      ? "done"
                      : isCurrent
                        ? "current"
                        : "future"
                }`}
              >
                {isAllSuccess ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : isCompleted ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : isErrorAtCurrent ? (
                  <AlertTriangle className="w-3 h-3" strokeWidth={3} />
                ) : isCancelled ? (
                  <Ban className="w-3 h-3" strokeWidth={2.5} />
                ) : isCurrent ? (
                  <div className="w-2 h-2 rounded-full bg-white" />
                ) : null}
              </div>
              <span
                className={cn("mt-1.5 text-[11px] text-center leading-tight px-1", labelClass)}
                style={
                  isCancelled
                    ? undefined
                    : isErrorAtCurrent
                      ? undefined
                      : isBrandActive
                        ? brandTextStyle
                        : futureTextStyle
                }
              >
                {t(step.labelKey)}
              </span>
            </div>
          );
        })}
      </div>
      {isKickedBack && (
        <p className="mt-2 text-xs text-red-700 text-center font-semibold" data-testid="stepper-note-kicked-back">
          {t("tickets.stepperKickedBackNote")}
        </p>
      )}
      {isCancelled && (
        <p className="mt-2 text-xs text-gray-500 text-center font-semibold" data-testid="stepper-note-cancelled">
          {t("tickets.stepperCancelledNote")}
        </p>
      )}
    </div>
  );
}
