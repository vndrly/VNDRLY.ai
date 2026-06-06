import greyPill from "@/assets/pill-stack/light-grey.png";
import amberPill from "@/assets/pill-stack/mid-orange.png";
import bluePill from "@/assets/pill-stack/mid-blue.png";
import greenPill from "@/assets/pill-stack/mid-green-v3.png";
import redPill from "@/assets/pill-stack/mid-red-v2.png";
import tanPill from "@/assets/pill-stack/mid-tan-v3.png";
import tealPill from "@/assets/pill-stack/mid-teal.png";

type PaletteEntry = { hex: string; src: number };

const TOGGLE_PILL_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: redPill },
  { hex: "#F39C1A", src: amberPill },
  { hex: "#149F3D", src: greenPill },
  { hex: "#1E5BD0", src: bluePill },
];

/** Inactive half of EN/ES toggles — light pill PNG (web white idle half). */
export const TOGGLE_IDLE_PILL_SRC = greyPill;

/** Neutral grey for disabled status chips. */
export const NEUTRAL_PILL_SRC = greyPill;

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

/** Nearest amber/blue/green/red pill for a brand hex; grey if unsaturated. */
export function pickTogglePillSrc(
  brandColor: string | null | undefined,
  brandName?: string | null,
): number {
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("winchester")) return tanPill;
  if (name.includes("baker")) return tealPill;
  if (!brandColor) return bluePill;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return bluePill;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return greyPill;
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
