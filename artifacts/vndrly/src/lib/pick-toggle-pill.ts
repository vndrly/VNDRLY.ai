import type { CSSProperties } from "react";
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
import { isWinchesterBrand } from "@/lib/portal-branding";
import {
  PILL_LABEL_ON_COLOR_CLASS,
  PILL_LABEL_ON_LIGHT_CLASS,
  splitToggleLabelClass,
} from "@/lib/pill-doctrine";

type PaletteEntry = { hex: string; src: string };

const TOGGLE_PILL_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: pillRed },
  { hex: "#F39C1A", src: pillAmber },
  { hex: "#149F3D", src: pillGreen },
  { hex: "#1E5BD0", src: pillBlue },
];

const NEUTRAL_TOGGLE_PILL_SRC = PILL_IDLE;

/** Natural width:height of the canonical 500×127 toggle pill PNGs. */
export const TOGGLE_PILL_IMAGE_ASPECT = 500 / 127;

/** Canonical white pill for the inactive half of split toggles. */
export const TOGGLE_IDLE_PILL_SRC = PILL_TOGGLE_IDLE;

/** CSS background for one half of a split toggle pill. */
export function toggleHalfPillBgStyle(
  src: string,
  side: "left" | "right",
): CSSProperties {
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: "200% 100%",
    backgroundPosition: side === "left" ? "left center" : "right center",
    backgroundRepeat: "no-repeat",
  };
}

/** Inactive half label — nav square idle treatment. */
export const SPLIT_TOGGLE_IDLE_TEXT_CLASS = PILL_LABEL_ON_LIGHT_CLASS;

export type SplitToggleVariant = "dark" | "light";

/** Active half label — nav square active treatment. */
export function splitToggleActiveTextClass(_variant?: SplitToggleVariant): string {
  return splitToggleLabelClass(true);
}

/** Inactive half label. */
export function splitToggleIdleTextClass(_variant?: SplitToggleVariant): string {
  return splitToggleLabelClass(false);
}

export function splitToggleDividerClass(_variant?: SplitToggleVariant): string {
  return "bg-gray-400";
}

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

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
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

export function pickTogglePillSrc(
  brandColor: string | null | undefined,
  brandName?: string | null,
): string {
  if (isWinchesterBrand(brandName)) return PILL_BRAND.winchester;
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("baker")) return PILL_BRAND.baker;
  if (name.includes("vndrly")) return PILL_BRAND.vndrly;
  if (!brandColor) return NEUTRAL_TOGGLE_PILL_SRC;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return NEUTRAL_TOGGLE_PILL_SRC;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return NEUTRAL_TOGGLE_PILL_SRC;
  let bestSrc = TOGGLE_PILL_PALETTE[0].src;
  let bestScore = Infinity;
  for (const entry of TOGGLE_PILL_PALETTE) {
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
