import { useState } from "react";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";

// Full 900x229 colored PNGs — same family the new Pill / PillButton
// uses. Rendered through PillBg's 3-slice geometry (15% caps, 70%
// stretched middle) so labels of any width keep crisp rounded caps
// — no resizing artifact. Diagonal pillGloss overlay sits on top
// of every variant for the shared sheen highlight.
import amberPng from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePng from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPng from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPng from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

export type RolePillColor = "amber" | "green" | "red" | "blue" | "grey" | "lightGrey";

const COLOR_PNG: Record<RolePillColor, string> = {
  amber: amberPng,
  green: greenPng,
  red: redPng,
  blue: bluePng,
  grey: pillBase,
  lightGrey: pillBase,
};

const PILL_ASPECT = 900 / 229;

const TEXT_CLASS: Record<RolePillColor, string> = {
  amber: "text-white",
  green: "text-white",
  red: "text-white",
  blue: "text-white",
  grey: "text-gray-800",
  lightGrey: "text-gray-800",
};

const TEXT_SHADOW: Record<RolePillColor, string> = {
  amber: "0 2px 4px rgba(0,0,0,0.9)",
  green: "0 2px 4px rgba(0,0,0,0.9)",
  red: "0 2px 4px rgba(0,0,0,0.9)",
  blue: "0 2px 4px rgba(0,0,0,0.9)",
  // Grey/lightGrey rest chrome: no text-shadow per pill doctrine.
  grey: "none",
  lightGrey: "none",
};

export function RolePill({
  color,
  hoverColor,
  children,
  onClick,
  testId,
  height = 24,
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
        "group relative inline-flex items-center justify-center font-semibold text-xs transition-transform active:scale-[0.98]",
        TEXT_CLASS[activeColor],
        className,
      )}
      style={{ height, padding: 0, background: "transparent", border: 0 }}
    >
      <PillBg
        src={COLOR_PNG[activeColor]}
        imageAspect={PILL_ASPECT}
        className="opacity-90 transition-opacity duration-200 group-hover:opacity-100"
      />
      <PillBg src={pillGloss} className="opacity-60" />
      <span
        className="relative z-10 inline-flex items-center justify-center whitespace-nowrap px-4"
        style={{ textShadow: TEXT_SHADOW[activeColor] }}
      >
        {children}
      </span>
    </button>
  );
}
