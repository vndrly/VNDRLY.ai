import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import {
  ticketStatusMeta,
  type TicketStatusBadgeColor,
} from "@/lib/ticket-status-meta";
import { ticketLifecyclePills } from "@/lib/ticket-status-palette";
import {

  PILL_HEIGHT_PX,
  PILL_HEIGHT_CLASS,

  PILL_LABEL_CLASS,

  PILL_MIN_HEIGHT_CLASS,

  PILL_STATUS_MIN_WIDTH_CLASS,

  PILL_TEXT_SHADOW,

  PILL_WRAPPER_CLASS,

} from "@/lib/pill-doctrine";



interface TicketStatusBadgeProps {

  status: string;

  updatedAt?: string | Date | null;

  /** Narrower pill for tight layouts (e.g. foreman pick-ticket modal). */

  compact?: boolean;

  className?: string;

  "data-testid"?: string;

}



export default function TicketStatusBadge({

  status,

  compact = false,

  className,

  "data-testid": testId,

}: TicketStatusBadgeProps) {

  const { t } = useTranslation();

  const meta = ticketStatusMeta[status];

  const label = meta ? t(meta.badgeLabelKey) : status;

  let color: TicketStatusBadgeColor | null = meta?.badgeColor ?? null;



  if (color == null) {

    return (

      <span className={cn("text-xs text-muted-foreground font-normal", className)}>

        {label}

      </span>

    );

  }



  const cfg = ticketLifecyclePills[color];



  return (

    <span

      className={cn(

        PILL_WRAPPER_CLASS,

        "pointer-events-none",

        compact

          ? cn(PILL_HEIGHT_CLASS, PILL_MIN_HEIGHT_CLASS, "min-w-0 max-w-full")

          : cn(PILL_HEIGHT_CLASS, PILL_STATUS_MIN_WIDTH_CLASS),

        className,

      )}

      style={{ height: PILL_HEIGHT_PX }}

      data-testid={testId}

    >

      <PillColorLayer src={cfg.src} />

      <PillGlossOverlay />

      <span

        className={cn(

          PILL_LABEL_CLASS,

          compact ? "leading-tight text-center whitespace-normal" : "h-full",

          cfg.light ? "text-gray-700" : "text-white",

        )}

        style={cfg.light ? undefined : { textShadow: PILL_TEXT_SHADOW }}

      >

        {label}

      </span>

    </span>

  );

}

