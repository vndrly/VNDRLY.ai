import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import {
  ticketStatusMeta,
  type TicketStatusBadgeColor,
} from "@/lib/ticket-status-meta";
import {
  TICKET_STATUS_PILL_ASPECT,
  ticketLifecyclePillGloss,
  ticketLifecyclePills,
} from "@/lib/ticket-status-palette";

interface TicketStatusBadgeProps {
  status: string;
  updatedAt?: string | Date | null;
  className?: string;
  "data-testid"?: string;
}

export default function TicketStatusBadge({ status, className, "data-testid": testId }: TicketStatusBadgeProps) {
  const { t } = useTranslation();
  const meta = ticketStatusMeta[status];
  const label = meta ? t(meta.badgeLabelKey) : status;
  let color: TicketStatusBadgeColor | null = meta?.badgeColor ?? null;

  if (color == null) {
    return (
      <span className={cn("text-xs text-muted-foreground font-medium", className)}>
        {label}
      </span>
    );
  }

  const cfg = ticketLifecyclePills[color];

  return (
    <span
      className={cn(
        "group relative inline-flex items-center h-[24px] min-w-[98px] select-none pointer-events-none align-middle",
        className,
      )}
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
