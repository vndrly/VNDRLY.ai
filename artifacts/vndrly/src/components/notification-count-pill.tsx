import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

interface NotificationCountPillProps {
  icon: LucideIcon;
  count: number;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

export default function NotificationCountPill({
  icon: Icon,
  count,
  title,
  ariaLabel,
  testId,
  className,
}: NotificationCountPillProps) {
  return (
    <span
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "pointer-events-none min-w-[38px]",
        className,
      )}
      style={{ height: PILL_HEIGHT_PX }}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <PillColorLayer src={bluePill} />
      <PillGlossOverlay />
      <span
        className={cn(PILL_LABEL_CLASS, "h-full gap-1 text-white")}
        style={{ textShadow: PILL_TEXT_SHADOW }}
      >
        <Icon className="w-3 h-3" />
        {count}
      </span>
    </span>
  );
}
