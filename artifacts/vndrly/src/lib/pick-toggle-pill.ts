import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
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

/** Natural width:height of the canonical 900×229 toggle pill PNGs. */
export const TOGGLE_PILL_IMAGE_ASPECT = 900 / 229;

/**
 * Canonical white pill PNG used for the *inactive* half of these
 * inline toggles. Rendered via `ToggleHalfPillBg` (PillBg 3-slice)
 * so the endcaps stay circular while the middle stretches.
 */
export const TOGGLE_IDLE_PILL_SRC = whitePill;

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

/**
 * Pick the best-matching canonical 900x229 pill PNG to use as the
 * active-half background of the dark/light + EN/ES inline toggles.
 *
 * This is intentionally separate from `pickPillForBrand` in
 * `baker-pill-button.tsx`:
 *   - We restrict the palette to the four canonical *colored* pills
 *     (amber / blue / green / red) plus a grey neutral fallback. The
 *     baker / teal / purple / pink / etc. variants are deliberately
 *     excluded per the user spec ("except baker") — these toggles
 *     should always read as one of the four core semantic colors.
 *   - Returns the grey pill (rather than the baker teal pill) when no
 *     brand color is supplied or the input is too desaturated to pick
 *     a meaningful hue.
 */
export function pickTogglePillSrc(
  brandColor: string | null | undefined,
): string {
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
