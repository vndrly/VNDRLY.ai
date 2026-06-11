import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import {
  PILL_ACTION,
  PILL_BRAND,
  PILL_IDLE,
  PILL_TOGGLE_IDLE,
  pillAmber,
  pillBlue,
  pillGreen,
  pillRed,
} from "@/lib/pill-palette-assets";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_READONLY_WRAPPER_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";

/** Inactive half of EN/ES + dark/light inline toggles. */
export const HALF_TOGGLE_IDLE_SRC = PILL_TOGGLE_IDLE;

type HueEntry = { hex: string; src: string };

const HUE_PILL_PALETTE: HueEntry[] = [
  { hex: "#D80B0B", src: pillRed },
  { hex: "#F39C1A", src: pillAmber },
  { hex: "#149F3D", src: pillGreen },
  { hex: "#1E5BD0", src: pillBlue },
];

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

/** Nearest amber/blue/green/red pill for a brand hex (grey if unsaturated). */
export function brandHuePillSrc(brandColor: string | null | undefined): string {
  if (!brandColor) return PILL_IDLE;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return PILL_IDLE;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return PILL_IDLE;
  let bestSrc = HUE_PILL_PALETTE[0].src;
  let bestScore = Infinity;
  for (const entry of HUE_PILL_PALETTE) {
    const erRgb = hexToRgb(entry.hex);
    if (!erRgb) continue;
    const [eh, es, el] = rgbToHsl(erRgb[0], erRgb[1], erRgb[2]);
    const score =
      (hueDistance(h, eh) / 180) * 3 +
      Math.abs(s - es) * 1 +
      Math.abs(l - el) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestSrc = entry.src;
    }
  }
  return bestSrc;
}

/** Brand-named overrides, then hue match — for progress bars, sidebar, etc. */
export function brandImagePillSrc(
  brandColor: string | null | undefined,
  brandName: string | null | undefined,
): string {
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("baker")) return PILL_BRAND.baker;
  if (name.includes("winchester")) return PILL_BRAND.winchester;
  if (name.includes("vndrly")) return PILL_BRAND.vndrly;
  return brandHuePillSrc(brandColor);
}

export const PNG_PILL_GLOSS_GRADIENT =
  "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 50%, transparent 50%, transparent 100%)";

export const PNG_PILL_TEXT_SHADOW = PILL_TEXT_SHADOW;

export const PNG_PILL_COLORS = {
  brand: "var(--brand-primary)",
  blue: "#3260CD",
  green: "#15803D",
  red: "#DC2626",
  amber: "#F59E0B",
} as const;

export type PngPillColor = keyof typeof PNG_PILL_COLORS;

function hoverSrcForColor(
  color: PngPillColor | "image",
  activeSrc: string | undefined,
  brandName: string | null | undefined,
): string {
  if (activeSrc) return activeSrc;
  if (color === "red") return PILL_ACTION.red;
  if (color === "green") return PILL_ACTION.green;
  if (color === "amber") return PILL_ACTION.amber;
  if (color === "blue") return PILL_ACTION.blue;
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("baker")) return PILL_BRAND.baker;
  if (name.includes("winchester")) return PILL_BRAND.winchester;
  if (name.includes("vndrly")) return PILL_BRAND.vndrly;
  return PILL_ACTION.blue;
}

function coloredSrcForChip(color: PngPillColor): string {
  if (color === "red") return PILL_ACTION.red;
  if (color === "green") return PILL_ACTION.green;
  if (color === "amber") return PILL_ACTION.amber;
  return PILL_ACTION.blue;
}

interface PngPillProps {
  children: React.ReactNode;
  color?: PngPillColor;
  rest?: boolean;
  height?: number;
  size?: "xs" | "sm";
  className?: string;
  /** Allow nested controls (e.g. crew-chip remove button). */
  interactive?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
}

/** Read-only pill — idle PNG when `rest`, colored PNG otherwise. */
export default function PngPill({
  children,
  color = "brand",
  rest = false,
  height = PILL_HEIGHT_PX,
  size = "xs",
  className,
  interactive = false,
  ...props
}: PngPillProps) {
  const src = rest ? PILL_IDLE : coloredSrcForChip(color);
  const wrapperClass = interactive ? PILL_WRAPPER_CLASS : PILL_READONLY_WRAPPER_CLASS;

  return (
    <div
      className={cn(
        wrapperClass,
        PILL_HEIGHT_CLASS,
        interactive && "pointer-events-auto",
        className,
      )}
      style={{ height }}
      data-testid={props["data-testid"]}
      aria-label={props["aria-label"]}
    >
      <PillColorLayer src={src} />
      <PillGlossOverlay />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5",
          rest ? "text-gray-700" : "text-white",
        )}
        style={rest ? undefined : { textShadow: PNG_PILL_TEXT_SHADOW }}
      >
        {children}
      </span>
    </div>
  );
}

interface PngPillButtonProps {
  children: React.ReactNode;
  color?: PngPillColor | "image";
  activeSrc?: string;
  idleSrc?: string;
  idleOpacity?: number;
  fullWidth?: boolean;
  activeTextShadowClass?: string;
  hoverTextShadowClass?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  height?: number;
  size?: "xs" | "sm";
  attention?: boolean;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

/** Interactive pill — two PNG layers: idle crossfades to hover. */
export function PngPillButton({
  children,
  color = "image",
  activeSrc,
  idleSrc,
  idleOpacity = 1,
  fullWidth = false,
  activeTextShadowClass = "drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]",
  hoverTextShadowClass = "group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]",
  onClick,
  type = "button",
  disabled,
  height = PILL_HEIGHT_PX,
  size = "xs",
  attention = false,
  className,
  title,
  ...props
}: PngPillButtonProps) {
  const brand = useBrand();
  const hoverSrc = hoverSrcForColor(color, activeSrc, brand.name);
  const restSrc = idleSrc ?? PILL_IDLE;

  const [pulseOn, setPulseOn] = useState(false);
  useEffect(() => {
    if (!attention || disabled) {
      setPulseOn(false);
      return;
    }
    const id = setInterval(() => setPulseOn((v) => !v), 700);
    return () => clearInterval(id);
  }, [attention, disabled]);

  const showHover = pulseOn;
  const alwaysColored = idleOpacity === 1 && restSrc === hoverSrc;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "group cursor-pointer bg-transparent border-0 p-0",
        fullWidth && "w-full",
        "transition-transform active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      style={{ height }}
      data-testid={props["data-testid"]}
    >
      <PillColorLayer
        src={restSrc}
        className={cn(
          "transition-opacity duration-200",
          alwaysColored
            ? "opacity-90"
            : showHover
              ? "opacity-0"
              : cn(
                  "group-hover:opacity-0",
                  idleOpacity === 1 ? "opacity-90" : "opacity-45",
                ),
        )}
      />
      {!alwaysColored && (
        <PillColorLayer
          src={hoverSrc}
          className={cn(
            "transition-opacity duration-200",
            showHover ? "opacity-90" : "opacity-0 group-hover:opacity-90",
          )}
        />
      )}
      <PillGlossOverlay />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5 transition-colors duration-200",
          alwaysColored || showHover
            ? "text-white"
            : "text-gray-700 group-hover:text-white group-hover:[text-shadow:0_2px_4px_rgba(0,0,0,0.9)]",
        )}
        style={alwaysColored || showHover ? { textShadow: PILL_TEXT_SHADOW } : undefined}
      >
        {children}
      </span>
    </button>
  );
}
