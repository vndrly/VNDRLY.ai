import amberPill from "@/assets/pills/pill_amber.png";
import bakerPill from "@/assets/pills/pill_baker.png";
import bluePill from "@/assets/pills/pill_blue.png";
import greenPill from "@/assets/pills/pill_green.png";
import redPill from "@/assets/pills/pill_red.png";
import vndrlyPill from "@/assets/pills/pill_vndrly.png";
import whitePill from "@/assets/pills/pill_white.png";
import winchesterPill from "@/assets/pills/pill_winchester.png";

type PaletteEntry = { hex: string; src: number };

const TOGGLE_PILL_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: redPill },
  { hex: "#F39C1A", src: amberPill },
  { hex: "#149F3D", src: greenPill },
  { hex: "#1E5BD0", src: bluePill },
];

/** Inactive half of EN/ES toggles — same white idle half used by the web nav pane. */
export const TOGGLE_IDLE_PILL_SRC = whitePill;

/** Neutral grey for disabled status chips. */
export const NEUTRAL_PILL_SRC = whitePill;

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
  if (name.includes("winchester")) return winchesterPill;
  if (name.includes("baker")) return bakerPill;
  if (name.includes("vndrly")) return vndrlyPill;
  if (!brandColor) return vndrlyPill;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return vndrlyPill;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return whitePill;
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
