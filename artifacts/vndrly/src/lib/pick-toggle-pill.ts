import type { CSSProperties } from "react";
import tanPill from "@assets/button-palette/900x229_tan_Pill-v3.png";
import { isWinchesterBrand } from "@/lib/portal-branding";
// Toggle pills MUST share one canvas size (500×127) so active + idle
// halves scale to the same height under the 200% background clip.
import amberPill from "@assets/900x229_Amber_Pill_v3.png";
import bluePill from "@assets/900x229_blue_Pill_v3.png";
import greenPill from "@assets/900x229_green_Pill_v3_1777847855324.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import greyPill from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import whitePill from "@assets/900x229_white_Pill2_1778850026167.png";

type PaletteEntry = { hex: string; src: string };

const TOGGLE_PILL_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: redPill },
  { hex: "#F39C1A", src: amberPill },
  { hex: "#149F3D", src: greenPill },
  { hex: "#1E5BD0", src: bluePill },
];

const NEUTRAL_TOGGLE_PILL_SRC = greyPill;

/** Natural width:height of the canonical 500×127 toggle pill PNGs. */
export const TOGGLE_PILL_IMAGE_ASPECT = 500 / 127;

/** Canonical white pill for the inactive half of split toggles. */
export const TOGGLE_IDLE_PILL_SRC = whitePill;

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

export const SPLIT_TOGGLE_ACTIVE_TEXT_SHADOW =
  "drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]";

/** Inactive half label — fixed dark grey on light surfaces. */
export const SPLIT_TOGGLE_IDLE_TEXT_CLASS = "text-gray-700";

export type SplitToggleVariant = "dark" | "light";

/** Active half label — no drop shadow on dark surfaces so the pill art reads crisp. */
export function splitToggleActiveTextClass(variant: SplitToggleVariant): string {
  if (variant === "dark") return "text-white";
  return `text-white ${SPLIT_TOGGLE_ACTIVE_TEXT_SHADOW}`;
}

/** Inactive half label — high contrast on dark chrome, grey on light. */
export function splitToggleIdleTextClass(variant: SplitToggleVariant): string {
  if (variant === "dark") return "text-neutral-100";
  return SPLIT_TOGGLE_IDLE_TEXT_CLASS;
}

export function splitToggleDividerClass(variant: SplitToggleVariant): string {
  return variant === "dark" ? "bg-white/45" : "bg-gray-400";
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
  if (isWinchesterBrand(brandName)) return tanPill;
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
