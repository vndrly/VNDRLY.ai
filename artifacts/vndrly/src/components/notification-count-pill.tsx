import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

const PILL_ASPECT = 900 / 229;

interface NotificationCountPillProps {
  icon: LucideIcon;
  count: number;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

/**
 * Notification-count chip — rendered with the canonical blue pill PNG
 * + pillGloss overlay so it follows the global pill doctrine
 * (PillBg 3-slice, height 24, opacity-90 rest / 100 hover, text-shadow
 * on the colored pill).
 */
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
        "group relative inline-flex items-center justify-center select-none align-middle pointer-events-none",
        className,
      )}
      style={{ height: 24, minWidth: 38 }}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <PillBg
        src={bluePill}
        imageAspect={PILL_ASPECT}
        className="opacity-90 group-hover:opacity-100 transition-opacity"
      />
      <PillBg src={pillGloss} stretch className="opacity-60" />
      <span
        className="relative z-10 inline-flex items-center gap-1 px-2 text-xs font-bold text-white"
        style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
      >
        <Icon className="w-3 h-3" />
        {count}
      </span>
    </span>
  );
}
