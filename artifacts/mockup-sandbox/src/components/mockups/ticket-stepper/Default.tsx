import { Check, AlertTriangle, Ban } from "lucide-react";

// ── Visual reference for Task #496 ──────────────────────────────────
// All 8 stepper variants side-by-side (6 progress states + kickback +
// funds-dispersed all-green). The components below are kept inline and
// independent of the real web/mobile stepper so this preview never
// blocks on the production component re-importing translations or
// pulling in i18n. The colour rules MUST match
//   artifacts/vndrly/src/components/ticket-status-stepper.tsx
//   artifacts/vndrly-mobile/components/TicketStatusStepper.tsx
// If you change colours here, change them in both real components.

const BRAND = "#f59e0b"; // var(--brand-primary) default
const FUTURE_GREY = "#616161";
const SUCCESS_GREEN = "#16a34a";
const ERROR_RED = "#b91c1c";

const STEPS = [
  { key: "initiated", label: "Initiated" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "funds_dispersed", label: "Funds Dispersed" },
];

function statusToActiveIndex(status: string): number {
  switch (status) {
    case "draft":
    case "initiated":
      return 0;
    case "in_progress":
      return 1;
    case "completed":
      return 2;
    case "submitted":
    case "kicked_back":
      return 3;
    case "approved":
      return 4;
    case "funds_dispersed":
      return 5;
    default:
      return 0;
  }
}

function Stepper({ status, surface }: { status: string; surface: "web" | "mobile" }) {
  const activeIndex = statusToActiveIndex(status);
  const isKickedBack = status === "kicked_back";
  const isAllSuccess = status === "funds_dispersed";
  const brand = isAllSuccess ? SUCCESS_GREEN : BRAND;

  // Web uses Tailwind's gloss overlay; mobile is flat. We approximate
  // both here so the canvas reviewer can confirm parity.
  const glossStyle = (color: string) => ({
    backgroundColor: color,
    backgroundImage:
      "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 50%, transparent 50%, transparent 100%)",
    borderColor: color,
  });

  return (
    <div className="w-full">
      <div className="grid grid-cols-6 gap-0">
        {STEPS.map((step, i) => {
          const isCompleted = i < activeIndex;
          const isCurrent = i === activeIndex;
          const isErrorAtCurrent = isCurrent && isKickedBack;
          const isBrandActive = !isErrorAtCurrent && (isAllSuccess || isCompleted || isCurrent);
          const leftActive = isAllSuccess || i <= activeIndex;
          const rightActive = isAllSuccess || i + 1 <= activeIndex;

          const activeFill =
            surface === "web"
              ? isBrandActive
                ? glossStyle(brand)
                : { backgroundColor: "#fff", borderColor: FUTURE_GREY }
              : isBrandActive
                ? { backgroundColor: brand, borderColor: brand }
                : { backgroundColor: "#fff", borderColor: FUTURE_GREY };

          const errorFill = surface === "web"
            ? glossStyle(ERROR_RED)
            : { backgroundColor: ERROR_RED, borderColor: "rgba(185, 28, 28, 0.6)" };

          return (
            <div key={step.key} className="flex flex-col items-center relative">
              {i > 0 && (
                <div
                  className="absolute top-3 right-1/2 left-0 h-0.5 mr-3"
                  style={{ backgroundColor: leftActive ? brand : FUTURE_GREY }}
                />
              )}
              {i < STEPS.length - 1 && (
                <div
                  className="absolute top-3 left-1/2 right-0 h-0.5 ml-3"
                  style={{ backgroundColor: rightActive ? brand : FUTURE_GREY }}
                />
              )}
              <div
                className="relative z-10 w-6 h-6 rounded-full border-2 shadow-sm flex items-center justify-center text-white"
                style={isErrorAtCurrent ? errorFill : activeFill}
              >
                {isAllSuccess || isCompleted ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : isErrorAtCurrent ? (
                  <AlertTriangle className="w-3 h-3" strokeWidth={3} />
                ) : isCurrent ? (
                  <div className="w-2 h-2 rounded-full bg-white" />
                ) : null}
              </div>
              <span
                className="mt-1.5 text-[11px] text-center leading-tight px-1"
                style={{
                  color: isErrorAtCurrent
                    ? ERROR_RED
                    : isBrandActive
                      ? brand
                      : FUTURE_GREY,
                  fontWeight: isCurrent && !isAllSuccess ? 700 : isBrandActive ? 600 : 400,
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {isKickedBack && (
        <p className="mt-2 text-xs text-red-700 text-center font-semibold">
          Sent back for review
        </p>
      )}
    </div>
  );
}

function VariantTile({
  title,
  status,
  caption,
}: {
  title: string;
  status: string;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          {title}
        </span>
        <code className="text-[10px] text-gray-400">{status}</code>
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] uppercase text-gray-400 mb-1">Web</p>
          <Stepper status={status} surface="web" />
        </div>
        <div>
          <p className="text-[10px] uppercase text-gray-400 mb-1">Mobile</p>
          <Stepper status={status} surface="mobile" />
        </div>
      </div>
      {caption && <p className="text-[11px] text-gray-500 mt-3">{caption}</p>}
    </div>
  );
}

export default function TicketStepperPreview() {
  return (
    <div
      className="min-h-screen p-8"
      style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#f8fafc" }}
    >
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">
          Ticket Status Stepper — Task #496 visual reference
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          6-step stepper. Brand-primary for current and earlier steps,{" "}
          <code>#616161</code> for future steps, all-green at{" "}
          <code>funds_dispersed</code>. Web (gloss overlay) and mobile (flat
          fill) shown side by side.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <VariantTile
            title="Initiated"
            status="initiated"
            caption="Brand on step 1; steps 2–6 are #616161."
          />
          <VariantTile
            title="In Progress"
            status="in_progress"
            caption="Brand through step 2."
          />
          <VariantTile
            title="Completed"
            status="completed"
            caption="Brand through step 3."
          />
          <VariantTile
            title="Submitted"
            status="submitted"
            caption="Brand through step 4."
          />
          <VariantTile
            title="Approved"
            status="approved"
            caption="Brand through step 5; only Funds Dispersed remains grey."
          />
          <VariantTile
            title="Funds Dispersed"
            status="funds_dispersed"
            caption="Entire stepper turns green to signal a closed/successful ticket."
          />
          <VariantTile
            title="Kickback (at Submitted)"
            status="kicked_back"
            caption="Submitted step paints in red; preserves existing kickback treatment."
          />
        </div>

        <div className="mt-8 p-4 rounded-md border border-gray-200 bg-white">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">
            Tracking number header
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Both web and mobile ticket-detail headers now display the formatted
            tracking number, padded to 8 digits.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-bold text-lg text-gray-900">VNDRLY-00000009</span>
            <span className="font-bold text-lg text-gray-900">VNDRLY-00000123</span>
            <span className="font-bold text-lg text-gray-900">VNDRLY-00012345</span>
          </div>
        </div>
      </div>
    </div>
  );
}
