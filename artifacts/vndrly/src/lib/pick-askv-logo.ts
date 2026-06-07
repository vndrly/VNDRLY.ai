// Ask V launcher logos — hue-matched like login/pill buttons, with
// Winchester and Baker cutouts by org name.

import askVAmber from "@assets/askv/AskV_VNDRLY_Amber_v1.png";
import askVBaker from "@assets/askv/AskV_VNDRLY_Baker_v1.png";
import askVBlue from "@assets/askv/AskV_VNDRLY_Blue_v1.png";
import askVGreen from "@assets/askv/AskV_VNDRLY_Green_v1.png";
import askVOrange from "@assets/askv/AskV_VNDRLY_Orange_v1.png";
import askVPurple from "@assets/askv/AskV_VNDRLY_Purple_v1.png";
import askVRed from "@assets/askv/AskV_VNDRLY_Red_v1.png";
import askVWinchester from "@assets/askv/AskV_VNDRLY_Winchester_v2.png";

import { isBakerBrand, isWinchesterBrand } from "@/lib/portal-branding";

type PaletteEntry = { hex: string; src: string };

const ASKV_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: askVRed },
  { hex: "#F97316", src: askVOrange },
  { hex: "#F39C1A", src: askVAmber },
  { hex: "#149F3D", src: askVGreen },
  { hex: "#1E5BD0", src: askVBlue },
  { hex: "#6B1FB8", src: askVPurple },
];

export const ASKV_DEFAULT_SRC = askVAmber;

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

/** Resolve the Ask V speech-bubble logo for a brand primary + name. */
export function pickAskVLogo(
  brandColor: string | null | undefined,
  brandName?: string | null,
): string {
  if (isBakerBrand(brandName)) return askVBaker;
  if (isWinchesterBrand(brandName)) return askVWinchester;
  if (!brandColor) return ASKV_DEFAULT_SRC;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return ASKV_DEFAULT_SRC;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return ASKV_DEFAULT_SRC;
  let bestSrc = ASKV_PALETTE[0].src;
  let bestScore = Infinity;
  for (const entry of ASKV_PALETTE) {
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
