import { useTranslation } from "react-i18next";
import PillBg from "@/components/pill-bg";
import {
  ticketStatusMeta,
  type TicketStatusBadgeColor,
} from "@/lib/ticket-status-meta";
import { cn } from "@/lib/utils";
import {
  TICKET_STATUS_PILL_ASPECT,
  ticketLifecyclePillGloss,
  ticketLifecyclePills,
} from "@/lib/ticket-status-palette";

interface TicketStatusTogglePillProps {
  status: string;
  updatedAt?: string | Date | null;
  className?: string;
  height?: number;
  "data-testid"?: string;
}

/**
 * Read-only ticket-status chip rendered in the canonical TogglePill
 * visual language, mirroring the Dashboard "Recent Activity" card.
 *
 * Color schema is driven by `ticketStatusMeta.badgeColor` and rendered
 * with the same lifecycle PNG palette as the dashboard bars.
 *
 * Staleness/attention is intentionally rendered by nearby warning UI,
 * not by changing the lifecycle color. That keeps a status like
 * Pending Review purple everywhere it appears.
 */
export default function TicketStatusTogglePill({
  status,
  className,
  height = 24,
  ...props
}: TicketStatusTogglePillProps) {
  const { t } = useTranslation();
  const meta = ticketStatusMeta[status];
  const label = meta ? t(meta.badgeLabelKey) : status;
  const testId =
    props["data-testid"] ?? `badge-status-${meta?.testIdStem ?? status}`;

  let color: TicketStatusBadgeColor | null = meta?.badgeColor ?? null;

  if (color == null) {
    return (
      <span
        className="text-xs text-muted-foreground font-medium"
        data-testid={testId}
      >
        {label}
      </span>
    );
  }

  const cfg = ticketLifecyclePills[color];

  return (
    <span
      className={cn(
        "group relative inline-flex items-center select-none pointer-events-none",
        className ?? "min-w-[110px] align-middle",
      )}
      style={{ height }}
      data-testid={testId}
    >
      <PillBg
        src={cfg.src}
        imageAspect={TICKET_STATUS_PILL_ASPECT}
        className="opacity-90 group-hover:opacity-100 transition-opacity"
      />
      <PillBg src={ticketLifecyclePillGloss} stretch className="opacity-60" />
      <span
        className={cn(
          "relative z-10 flex items-center justify-center w-full h-full px-3 text-xs font-bold whitespace-nowrap",
          cfg.light ? "text-gray-700" : "text-white",
        )}
        style={cfg.light ? undefined : { textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
      >
      {label}
      </span>
    </span>
  );
}
