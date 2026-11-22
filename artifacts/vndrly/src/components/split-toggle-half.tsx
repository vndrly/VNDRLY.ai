import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/pages/vendor-profile.css";
export const SPLIT_TOGGLE_PILL_HEIGHT_PX = 44;
type SplitToggleHalfProps = {
  side: "left" | "right";
  pillSrc: string;
  active: boolean;
  children: ReactNode;
  textClassName?: string;
  bgClassName?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;
/** Compatibility export: paired view actions use the same minicards as other actions. */
export default function SplitToggleHalf({
  side: _side,
  pillSrc: _pillSrc,
  active,
  children,
  className,
  textClassName,
  bgClassName: _bgClassName,
  type = "button",
  style,
  ...props
}: SplitToggleHalfProps) {
  return (
    <button
      {...props}
      type={type}
      className={cn("vendor-mini-card-button", className)}
      aria-pressed={props["aria-pressed"] ?? active}
      data-ui-button="mini-card"
      style={{
        ...style,
        minHeight: 44,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <span className={textClassName}>{children}</span>
    </button>
  );
}
