import { useTranslation } from "react-i18next";
import { ticketStatusMeta } from "@/lib/ticket-status-meta";
import { cn } from "@/lib/utils";
import { ticketLifecyclePills } from "@/lib/ticket-status-palette";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
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
  const cfg = meta.badgeColor ? ticketLifecyclePills[meta.badgeColor] : null;
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
      <PillGlossOverlay />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5",
          cfg.light ? "text-gray-700" : "text-white",
        )}
        style={cfg.light ? undefined : { textShadow: PILL_TEXT_SHADOW }}
      >
        <Icon className="h-4 w-4" />
        {label}
      </span>
    </button>
  );
}
