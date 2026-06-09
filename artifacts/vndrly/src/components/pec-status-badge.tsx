import { RolePill, type RolePillColor } from "@/components/role-pill";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import { cn } from "@/lib/utils";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";
/**
 * Shared sizing for every PEC Status pill — fixed min-width so the
 * label is always centered within the same footprint regardless of
 * value ("None" vs "MM/DD/YY"), matching the rest of the read-only
 * pill family in tables.
 */
const PEC_PILL_BASE_CLASS = "min-w-[70px] justify-center text-center";

function formatExpDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

type PecState =
  | { kind: "none" }
  | { kind: "expired"; label: string }
  | { kind: "soon"; label: string }
  | { kind: "active"; label: string };

function getPecState(expirationDate: string | null): PecState {
  if (!expirationDate) return { kind: "none" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(expirationDate + "T00:00:00");
  const diffMs = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const label = formatExpDate(expDate);
  if (diffDays < 0) return { kind: "expired", label };
  if (diffDays < 30) return { kind: "soon", label };
  return { kind: "active", label };
}

interface PecStatusBadgeProps {
  expirationDate: string | null;
  className?: string;
  /** Pill height in px. Defaults to 22 for compact table rows. */
  height?: number;
}

/**
 * Partner Expense Card status pill.
 *
 * Colored states (expired / soon / active) render via <RolePill> —
 * the same explicit left/center/right 3-slice (cap = height/2 widths)
 * that the Roles column uses, so the rounded caps never stretch.
 *
 * The "None" / no-expiration state renders the same grey idle chrome
 * as the Bulk Upload Logins / Add Employee buttons (the new Pill /
 * TogglePillButton family): light-grey `pillBase` PNG at 90% opacity
 * + diagonal `pillGloss` overlay at 60%, with dark text. This makes
 * the idle PEC pill read as the rest state of an action button —
 * consistent with the rest of the new Pill doctrine.
 */
export default function PecStatusBadge({ expirationDate, className, height = PILL_HEIGHT_PX }: PecStatusBadgeProps) {
  const state = getPecState(expirationDate);

  if (state.kind === "none") {
    return (
      <span
        className={cn(
          PILL_WRAPPER_CLASS,
          PILL_HEIGHT_CLASS,
          "pointer-events-none",
          PEC_PILL_BASE_CLASS,
          className,
        )}
        style={{ height }}
        data-testid="pec-status-badge-none"
      >
        <PillColorLayer src={pillBase} />
        <PillGlossOverlay />
        <span className={cn(PILL_LABEL_CLASS, "h-full text-gray-800")}>
          None
        </span>
      </span>    );
  }

  const colorByKind: Record<"expired" | "soon" | "active", RolePillColor> = {
    expired: "red",
    soon: "amber",
    active: "green",
  };

  return (
    <RolePill
      color={colorByKind[state.kind]}
      height={height}
      className={cn(PEC_PILL_BASE_CLASS, className)}
      testId={`pec-status-badge-${state.kind}`}
    >
      {state.label}
    </RolePill>
  );
}
