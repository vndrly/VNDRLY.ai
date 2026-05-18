import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

// 6-step stepper. Visual parity with the web stepper (Task #496):
// brand-primary for current/earlier steps, #616161 for future steps,
// entire stepper turns green when the ticket is at funds_dispersed.
// Source of truth for color tokens is the web stepper at
// artifacts/vndrly/src/components/ticket-status-stepper.tsx — keep
// these constants in sync. Mobile cannot read CSS vars so we use the
// same hard-coded fallback values web does.
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
    // Task #594: awaiting_payment is a vendor-side branch off in_progress
    // ("we wrapped on site, the customer owes us"). It's the AP-blocking
    // sibling of "approved" — the next move is funds_dispersed — so we
    // light it up at the same step as approved on the stepper. Matches
    // the web stepper's behavior introduced in Task #576.
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

interface Props {
  status: string;
}

const DOT_SIZE = 24;
const DOT_HALF = DOT_SIZE / 2;
const LINE_TOP = DOT_HALF - 1;

const FUTURE_GREY = "#616161";
const SUCCESS_GREEN = "#16a34a";
const ERROR_RED = "#b91c1c";
const CANCEL_GREY = "#d1d5db";

export default function TicketStatusStepper({ status }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const activeIndex = statusToActiveIndex(status);
  const isCancelled = status === "cancelled";
  const isKickedBack = status === "kicked_back";
  const isAllSuccess = status === "funds_dispersed";
  const isAwaitingPayment = status === "awaiting_payment";

  // colors.primary resolves to the brand color set by the admin in
  // /admin/vndrly (cascading partner > vendor > platform), or the
  // neutral near-black fallback when no brand color is configured.
  const brandColor = isAllSuccess ? SUCCESS_GREEN : colors.primary;

  // Task #594: When the ticket is awaiting_payment we render step 4 with
  // the "Awaiting Payment" label instead of "Approved" — the two states
  // share a slot on the stepper but are mutually exclusive, so the
  // visible label should always reflect the actual status. Matches the
  // web stepper's behavior introduced in Task #576.
  const stepsForStatus = isAwaitingPayment
    ? STEPS.map((step, i) =>
        i === 4 ? { ...step, labelKey: "tickets.awaitingPaymentStatus" } : step,
      )
    : STEPS;

  return (
    <View style={{ width: "100%" }}>
      <View style={{ flexDirection: "row" }}>
        {stepsForStatus.map((step, i) => {
          const isCompleted = !isCancelled && i < activeIndex;
          const isCurrent = !isCancelled && i === activeIndex;
          const isErrorAtCurrent = isCurrent && isKickedBack;
          const isBrandActive =
            !isCancelled && !isErrorAtCurrent && (isAllSuccess || isCompleted || isCurrent);

          const leftLineActive = isAllSuccess || (!isCancelled && i <= activeIndex);
          const rightLineActive = isAllSuccess || (!isCancelled && i + 1 <= activeIndex);

          const lineColor = (active: boolean) => {
            if (isCancelled) return CANCEL_GREY;
            return active ? brandColor : FUTURE_GREY;
          };

          // Dot fill colors. Active steps fill with brand color; future
          // steps are an outlined #616161 ring on white.
          const dotBackground = isCancelled
            ? "#e5e7eb"
            : isErrorAtCurrent
              ? ERROR_RED
              : isBrandActive
                ? brandColor
                : "#ffffff";
          const dotBorder = isCancelled
            ? CANCEL_GREY
            : isErrorAtCurrent
              ? "rgba(185, 28, 28, 0.6)"
              : isBrandActive
                ? brandColor
                : FUTURE_GREY;

          const labelColor = isCancelled
            ? "#9ca3af"
            : isErrorAtCurrent
              ? ERROR_RED
              : isBrandActive
                ? brandColor
                : FUTURE_GREY;

          return (
            <View key={step.key} style={{ flex: 1, alignItems: "center", position: "relative" }}>
              {i > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: LINE_TOP,
                    left: 0,
                    right: "50%",
                    marginRight: DOT_HALF,
                    height: 2,
                    backgroundColor: lineColor(leftLineActive),
                  }}
                />
              ) : null}
              {i < STEPS.length - 1 ? (
                <View
                  style={{
                    position: "absolute",
                    top: LINE_TOP,
                    left: "50%",
                    right: 0,
                    marginLeft: DOT_HALF,
                    height: 2,
                    backgroundColor: lineColor(rightLineActive),
                  }}
                />
              ) : null}

              <View
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_HALF,
                  borderWidth: 2,
                  borderColor: dotBorder,
                  backgroundColor: dotBackground,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isAllSuccess ? (
                  <Feather name="check" size={12} color="#ffffff" />
                ) : isCompleted ? (
                  <Feather name="check" size={12} color="#ffffff" />
                ) : isErrorAtCurrent ? (
                  <Feather name="alert-triangle" size={11} color="#ffffff" />
                ) : isCancelled ? (
                  <Feather name="slash" size={11} color="#9ca3af" />
                ) : isCurrent ? (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#ffffff" }} />
                ) : null}
              </View>

              <Text
                style={{
                  marginTop: 6,
                  fontSize: 10,
                  textAlign: "center",
                  paddingHorizontal: 2,
                  color: labelColor,
                  fontFamily: isCurrent || isErrorAtCurrent
                    ? "Inter_700Bold"
                    : isBrandActive
                      ? "Inter_600SemiBold"
                      : "Inter_400Regular",
                }}
              >
                {t(step.labelKey)}
              </Text>
            </View>
          );
        })}
      </View>
      {isKickedBack ? (
        <Text style={{ marginTop: 8, fontSize: 11, color: ERROR_RED, textAlign: "center", fontFamily: "Inter_700Bold" }}>
          {t("tickets.stepperKickedBackNote")}
        </Text>
      ) : null}
      {isCancelled ? (
        <Text style={{ marginTop: 8, fontSize: 11, color: "#6b7280", textAlign: "center", fontFamily: "Inter_700Bold" }}>
          {t("tickets.stepperCancelledNote")}
        </Text>
      ) : null}
    </View>
  );
}
