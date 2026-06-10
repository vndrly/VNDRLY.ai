import { useTranslation } from "react-i18next";

import { ticketStatusMeta } from "@/lib/ticket-status-meta";

import { cn } from "@/lib/utils";

import { ticketLifecyclePillForStatus } from "@/lib/ticket-status-palette";

import { PillColorLayer } from "@/components/png-pill-chrome";

import {

  PILL_HEIGHT_CLASS,

  PILL_HEIGHT_PX,

  PILL_LABEL_CLASS,

  PILL_WRAPPER_CLASS,

  pillLabelToneClass,

} from "@/lib/pill-doctrine";



interface TicketStatusActionPillProps {

  status: string;

}



export default function TicketStatusActionPill({ status }: TicketStatusActionPillProps) {

  const { t } = useTranslation();

  const meta = ticketStatusMeta[status];

  if (!meta?.actionPill) return null;



  const { icon: Icon } = meta.actionPill;

  const testId = `status-${meta.testIdStem}`;

  const label = t(meta.badgeLabelKey);

  const cfg = meta.badgeColor ? ticketLifecyclePillForStatus(status) : null;

  if (!cfg) return null;



  return (

    <button

      type="button"

      disabled

      className={cn(

        PILL_WRAPPER_CLASS,

        PILL_HEIGHT_CLASS,

        "min-w-[118px] border-0 bg-transparent p-0 disabled:cursor-not-allowed",

      )}

      style={{ height: PILL_HEIGHT_PX }}

      data-testid={testId}

    >

      <PillColorLayer src={cfg.src} />

      <span

        className={cn(

          PILL_LABEL_CLASS,

          "h-full gap-1.5",

          pillLabelToneClass(cfg.light),

        )}

      >

        <Icon className="h-4 w-4" />

        {label}

      </span>

    </button>

  );

}

