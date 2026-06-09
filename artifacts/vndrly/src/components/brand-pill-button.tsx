import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

interface BrandPillButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
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
  height = PILL_HEIGHT_PX,
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
    PILL_WRAPPER_CLASS,
    PILL_HEIGHT_CLASS,
    "cursor-pointer border-0 bg-transparent p-0 disabled:opacity-50 disabled:cursor-not-allowed",
    "transition-transform active:scale-[0.98]",
    className,
  );
  const sharedStyle: React.CSSProperties = { height };

  const colorPng = TONE_PILL[tone];
  const showColored = pulseOn;

  const inner = (
    <>
      <PillColorLayer src={pillBase} className="group-hover:opacity-100" />
      <PillColorLayer
        src={colorPng}
        className={cn(
          "transition-opacity duration-200",
          showColored ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
      <PillGlossOverlay
        className={cn(
          "transition-opacity duration-200",
          showColored ? "opacity-0" : "opacity-60 group-hover:opacity-0",
        )}
      />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5 transition-colors duration-200",
          showColored
            ? "text-white"
            : "text-gray-800 group-hover:text-white",
        )}
        style={showColored ? { textShadow: PILL_TEXT_SHADOW } : undefined}
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
