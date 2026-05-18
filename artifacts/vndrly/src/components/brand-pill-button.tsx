import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";

const PILL_ASPECT = 900 / 229;

interface BrandPillButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  /**
   * Active/hover color, mapped onto the canonical pill PNG palette.
   *  - "image"  → blue PNG (default).
   *  - "brand"  → blue PNG (no brand-specific PNG in the new palette).
   *  - "blue"   → blue PNG.
   *  - "green"  → green PNG.
   *  - "red"    → red PNG.
   *  - "amber"  → amber PNG.
   */
  tone?: "image" | "brand" | "blue" | "green" | "red" | "amber";
  height?: number;
  attention?: boolean;
  "data-testid"?: string;
}

const TONE_PILL: Record<NonNullable<BrandPillButtonProps["tone"]>, string> = {
  image: bluePill,
  brand: bluePill,
  blue: bluePill,
  green: greenPill,
  red: redPill,
  amber: amberPill,
};

/**
 * Branded pill button — canonical pill-family doctrine.
 *
 * Layers (bottom → top):
 *   1. pillBase PNG (PillBg 3-slice) — opacity-90 rest, group-hover
 *      opacity-100. Always on; owns the silhouette.
 *   2. Hover/attention color PNG (canonical palette). Fades in on
 *      hover (or while pulsing in attention mode).
 *   3. pillGloss PNG (stretched) — opacity-60 rest, fades to 0 when
 *      the colored chrome is showing.
 *
 * Text: grey (no shadow) at rest; white with shadow when colored
 * chrome is visible (hover or pulse).
 */
export default function BrandPillButton({
  children,
  onClick,
  className,
  type = "button",
  disabled,
  href,
  target,
  rel,
  tone = "image",
  height = 24,
  attention = false,
  ...props
}: BrandPillButtonProps) {
  const [pulseOn, setPulseOn] = useState(false);
  useEffect(() => {
    if (!attention || disabled) {
      setPulseOn(false);
      return;
    }
    const id = setInterval(() => setPulseOn((p) => !p), 700);
    return () => clearInterval(id);
  }, [attention, disabled]);

  const sharedClassName = cn(
    "relative cursor-pointer group inline-flex items-center select-none bg-transparent border-0 p-0 disabled:opacity-50 disabled:cursor-not-allowed",
    "transition-transform active:scale-[0.98]",
    className,
  );
  const sharedStyle: React.CSSProperties = { height };

  const colorPng = TONE_PILL[tone];

  const inner = (
    <>
      <PillBg
        src={pillBase}
        imageAspect={PILL_ASPECT}
        className="opacity-90 group-hover:opacity-100 transition-opacity"
      />
      <PillBg
        src={colorPng}
        imageAspect={PILL_ASPECT}
        className={cn(
          "transition-opacity duration-200",
          pulseOn ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
      <PillBg
        src={pillGloss}
        stretch
        className={cn(
          "transition-opacity duration-200",
          pulseOn ? "opacity-0" : "opacity-60 group-hover:opacity-0",
        )}
      />

      <span
        className={cn(
          "relative z-10 flex items-center justify-center gap-1.5 px-3 h-full w-full text-xs font-bold whitespace-nowrap transition-colors duration-200",
          pulseOn
            ? "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
            : "text-gray-800 group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]",
        )}
      >
        {children}
      </span>
    </>
  );

  if (href !== undefined) {
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        onClick={onClick}
        className={sharedClassName}
        style={sharedStyle}
        aria-disabled={disabled || undefined}
        data-testid={props["data-testid"]}
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={sharedClassName}
      style={sharedStyle}
      data-testid={props["data-testid"]}
    >
      {inner}
    </button>
  );
}
