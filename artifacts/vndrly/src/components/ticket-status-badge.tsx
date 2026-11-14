import { useTranslation } from "react-i18next";



import { cn } from "@/lib/utils";



import { PillColorLayer } from "@/components/png-pill-chrome";

import {

  ticketStatusMeta,

  type TicketStatusBadgeColor,

} from "@/lib/ticket-status-meta";

import { ticketLifecyclePillForStatus } from "@/lib/ticket-status-palette";

import {

  PILL_HEIGHT_PX,

  PILL_HEIGHT_CLASS,

  PILL_LABEL_CLASS,

  PILL_MIN_HEIGHT_CLASS,

  PILL_STATUS_MIN_WIDTH_CLASS,

  PILL_READONLY_WRAPPER_CLASS,

  pillLabelToneClass,

} from "@/lib/pill-doctrine";



interface TicketStatusBadgeProps {
  appearance?: "pill" | "indicator";

  status: string;

  updatedAt?: string | Date | null;

  compact?: boolean;

  className?: string;

  "data-testid"?: string;

}



export default function TicketStatusBadge({
  appearance = "pill",

  status,

  compact = false,

  className,

  "data-testid": testId,

}: TicketStatusBadgeProps) {

  const { t } = useTranslation();

  const meta = ticketStatusMeta[status];

  const label = meta ? t(meta.badgeLabelKey) : status;
  if (appearance === "indicator") {
    const cfg = ticketLifecyclePillForStatus(status);
    return <span role="status" data-testid={testId} style={{ color: cfg.hex }} className={cn("inline-flex min-h-[26px] items-center gap-[5px] rounded-full bg-white/[0.055] px-[10px] py-[3px] text-xs font-semibold", className)}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{label}
    </span>;
  }



  let color: TicketStatusBadgeColor | null = meta?.badgeColor ?? null;



  if (color == null) {

    return (

      <span className={cn("text-xs text-muted-foreground font-normal", className)}>

        {label}

      </span>

    );

  }



  const cfg = ticketLifecyclePillForStatus(status);



  return (

    <span

      className={cn(

        PILL_READONLY_WRAPPER_CLASS,

        compact

          ? cn(PILL_HEIGHT_CLASS, PILL_MIN_HEIGHT_CLASS, "min-w-0 max-w-full")

          : cn(PILL_HEIGHT_CLASS, PILL_STATUS_MIN_WIDTH_CLASS),

        className,

      )}

      style={{ height: PILL_HEIGHT_PX }}

      data-testid={testId}

    >

      <PillColorLayer src={cfg.src} />

      <span

        className={cn(

          PILL_LABEL_CLASS,

          compact ? "leading-tight text-center whitespace-normal" : "h-full",

          pillLabelToneClass(cfg.light),

        )}

      >

        {label}

      </span>

    </span>

  );

}

