import { cn } from "@/lib/utils";
import { PillColorLayer } from "@/components/png-pill-chrome";
import {
  pillAmber,
  pillBlue,
  pillGreen,
  pillRed,
  PILL_IDLE,
} from "@/lib/pill-palette-assets";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_WRAPPER_CLASS,
  pillLabelToneClass,
} from "@/lib/pill-doctrine";

export type RolePillColor = "amber" | "green" | "red" | "blue" | "grey" | "lightGrey";

const COLOR_PNG: Record<RolePillColor, string> = {
  amber: pillAmber,
  green: pillGreen,
  red: pillRed,
  blue: pillBlue,
  grey: PILL_IDLE,
  lightGrey: PILL_IDLE,
};

export function RolePill({
  color,
  hoverColor: _hoverColor,
  children,
  onClick,
  testId,
  height = PILL_HEIGHT_PX,
  className = "",
}: {
  color: RolePillColor;
  hoverColor?: RolePillColor;
  children: React.ReactNode;
  onClick?: () => void;
  testId?: string;
  height?: number;
  className?: string;
}) {
  const isLight = color === "grey" || color === "lightGrey";
  const wrapperClass = cn(
    PILL_WRAPPER_CLASS,
    PILL_HEIGHT_CLASS,
    onClick
      ? "cursor-pointer border-0 bg-transparent p-0"
      : "pointer-events-none",
    className,
  );
  const inner = (
    <>
      <PillColorLayer src={COLOR_PNG[color]} />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5",
          pillLabelToneClass(isLight),
        )}
      >
        {children}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={wrapperClass}
        style={{ height }}
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      data-testid={testId}
      className={wrapperClass}
      style={{ height }}
    >
      {inner}
    </span>
  );
}
