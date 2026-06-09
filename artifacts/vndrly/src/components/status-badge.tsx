import { cn } from "@/lib/utils";
import { SiteLocationStatus, type SiteLocationStatus as SiteLocationStatusType } from "@workspace/api-client-react";
import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";

/**
 * Site-location status pill (Active / Inactive / Standby / Offline).
 *
 * Renders via the canonical PNG ImagePill treatment (same family as
 * RoleBadge / PecStatusBadge / Lead Admin). Color mapping follows the
 * TogglePill semantic rules: green = on, amber = warning, red = down,
 * grey rest = idle.
 */

type Variant = ImagePillColor | "rest";

const statusColorMap: Record<SiteLocationStatusType, Variant> = {
  [SiteLocationStatus.active]: "green",
  [SiteLocationStatus.inactive]: "rest",
  [SiteLocationStatus.standby]: "amber",
  [SiteLocationStatus.offline]: "red",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  if (!status) return null;
  const normalized = status.toLowerCase() as SiteLocationStatusType;
  const variant: Variant = statusColorMap[normalized] ?? "rest";
  const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  // Normalized to 23 px to match the rest of the read-only image-pill
  // family (RoleBadge / PecStatusBadge / TicketStatusBadge). Any
  // legacy `h-[Npx]` passed in via className is stripped so the pill
  // PNG always renders at the canonical height.
  const sanitizedClassName = className?.replace(/h-\[\d+px\]/g, "").trim() || undefined;

  return (
    <ImagePill
      color={variant === "rest" ? "grey" : variant}
      rest={variant === "rest"}
      height={PILL_HEIGHT_PX}
      className={cn(sanitizedClassName)}
    >
      {label}
    </ImagePill>
  );
}
