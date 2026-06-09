import { useState } from "react";
import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import amberPng from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePng from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPng from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPng from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

export type RolePillColor = "amber" | "green" | "red" | "blue" | "grey" | "lightGrey";

const COLOR_PNG: Record<RolePillColor, string> = {
  amber: amberPng,
  green: greenPng,
  red: redPng,
  blue: bluePng,
  grey: pillBase,
  lightGrey: pillBase,
};

const TEXT_CLASS: Record<RolePillColor, string> = {
  amber: "text-white",
  green: "text-white",
  red: "text-white",
  blue: "text-white",
  grey: "text-gray-800",
  lightGrey: "text-gray-800",
};

export function RolePill({
  color,
  hoverColor,
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
  const [hover, setHover] = useState(false);
  const activeColor = hover && hoverColor ? hoverColor : color;
  const isLight = activeColor === "grey" || activeColor === "lightGrey";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      data-testid={testId}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "cursor-pointer border-0 bg-transparent p-0 transition-transform active:scale-[0.98]",
        TEXT_CLASS[activeColor],
        className,
      )}
      style={{ height }}
    >
      <PillColorLayer
        src={COLOR_PNG[activeColor]}
        className="group-hover:opacity-100"
      />
      <PillGlossOverlay />
      <span
        className={cn(PILL_LABEL_CLASS, "h-full")}
        style={isLight ? undefined : { textShadow: PILL_TEXT_SHADOW }}
      >
        {children}
      </span>
    </button>
  );
}
