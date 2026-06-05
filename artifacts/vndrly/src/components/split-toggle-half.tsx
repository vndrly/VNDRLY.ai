import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toggleHalfPillBgStyle } from "@/lib/pick-toggle-pill";

/** Fixed pill height — all toggle halves share this exactly. */
export const SPLIT_TOGGLE_PILL_HEIGHT_PX = 23;

type SplitToggleHalfProps = {
  side: "left" | "right";
  pillSrc: string;
  children: ReactNode;
  className?: string;
  textClassName?: string;
  bgClassName?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * One half of a split EN/ES, Dark/Light, Map/Satellite, etc. toggle.
 * Background lives on an absolute inset-0 layer so text/padding never
 * change pill height; pill PNG is clipped with the 200% width trick.
 */
export default function SplitToggleHalf({
  side,
  pillSrc,
  children,
  className,
  textClassName,
  bgClassName,
  type = "button",
  ...props
}: SplitToggleHalfProps) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        "border-0 m-0 p-0 px-2 bg-transparent",
        "text-xs font-bold leading-none cursor-pointer select-none",
        className,
      )}
      style={{ height: SPLIT_TOGGLE_PILL_HEIGHT_PX, minHeight: SPLIT_TOGGLE_PILL_HEIGHT_PX, maxHeight: SPLIT_TOGGLE_PILL_HEIGHT_PX }}
    >
      <span
        aria-hidden
        className={cn("absolute inset-0 pointer-events-none", bgClassName)}
        style={toggleHalfPillBgStyle(pillSrc, side)}
      />
      <span className={cn("relative z-10", textClassName)}>{children}</span>
    </button>
  );
}
