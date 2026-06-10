import ImagePill from "@/components/image-pill";
import type { ImagePillColor } from "@/components/image-pill";
import { cn } from "@/lib/utils";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";

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
  height?: number;
}

export default function PecStatusBadge({
  expirationDate,
  className,
  height = PILL_HEIGHT_PX,
}: PecStatusBadgeProps) {
  const state = getPecState(expirationDate);

  if (state.kind === "none") {
    return (
      <ImagePill
        color="grey"
        height={height}
        className={cn(PEC_PILL_BASE_CLASS, className)}
        data-testid="pec-status-badge-none"
      >
        None
      </ImagePill>
    );
  }

  const colorByKind: Record<"expired" | "soon" | "active", ImagePillColor> = {
    expired: "red",
    soon: "amber",
    active: "green",
  };

  return (
    <ImagePill
      color={colorByKind[state.kind]}
      height={height}
      className={cn(PEC_PILL_BASE_CLASS, className)}
      data-testid={`pec-status-badge-${state.kind}`}
    >
      {state.label}
    </ImagePill>
  );
}
