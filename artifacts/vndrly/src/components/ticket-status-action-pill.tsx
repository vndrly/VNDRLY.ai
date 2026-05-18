import { useTranslation } from "react-i18next";
import { ticketStatusMeta } from "@/lib/ticket-status-meta";
import PillBg from "@/components/pill-bg";
import { cn } from "@/lib/utils";
import {
  TICKET_STATUS_PILL_ASPECT,
  ticketLifecyclePillGloss,
  ticketLifecyclePills,
} from "@/lib/ticket-status-palette";

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
  const cfg = ticketLifecyclePills[meta.badgeColor];

  return (
    <button
      type="button"
      disabled
      className="group relative inline-flex h-[24px] min-w-[118px] select-none items-center border-0 bg-transparent p-0 disabled:cursor-not-allowed"
      data-testid={testId}
    >
      <PillBg
        src={cfg.src}
        imageAspect={TICKET_STATUS_PILL_ASPECT}
        className="opacity-90"
      />
      <PillBg src={ticketLifecyclePillGloss} stretch className="opacity-60" />
      <span
        className={cn(
          "relative z-10 flex h-full w-full items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs font-bold",
          cfg.light ? "text-gray-700" : "text-white",
        )}
        style={cfg.light ? undefined : { textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
      >
        <Icon className="h-4 w-4" />
        {label}
      </span>
    </button>
  );
}
