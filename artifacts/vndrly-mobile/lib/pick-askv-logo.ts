import type { ImageSourcePropType } from "react-native";

const askVAmber = require("@/assets/askv/AskV_VNDRLY_Amber_v3.png");
const askVGrey = require("@/assets/askv/AskV_VNDRLY_Grey_v2.png");
const askVBaker = require("@/assets/askv/AskV_VNDRLY_Baker_v1.png");
const askVBlue = require("@/assets/askv/AskV_VNDRLY_Blue_v1.png");
const askVGreen = require("@/assets/askv/AskV_VNDRLY_Green_v1.png");
const askVPurple = require("@/assets/askv/AskV_VNDRLY_Purple_v1.png");
const askVRed = require("@/assets/askv/AskV_VNDRLY_Red_v3.png");
const askVWinchester = require("@/assets/askv/AskV_VNDRLY_Winchester_v2.png");
const askVFlywheel = require("@/assets/askv/AskV_VNDRLY_flywheel_Blue_v1.png");
const askVMidcon = require("@/assets/askv/AskV_VNDRLY_midcon_Blue_v1.png");

type PaletteEntry = { hex: string; src: ImageSourcePropType };

const ASKV_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: askVRed },
  { hex: "#F97316", src: askVAmber },
  { hex: "#F39C1A", src: askVAmber },
  { hex: "#149F3D", src: askVGreen },
  { hex: "#1E5BD0", src: askVBlue },
  { hex: "#6B1FB8", src: askVPurple },
];

export const ASKV_DEFAULT_SRC: ImageSourcePropType = askVAmber;
export const ASKV_IDLE_SRC: ImageSourcePropType = askVGrey;

function normalizedBrandName(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
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
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, l];
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
  else h = 60 * ((rn - gn) / delta + 4);
  return [h < 0 ? h + 360 : h, s, l];
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return distance > 180 ? 360 - distance : distance;
}

export function pickAskVLogoIdle(): ImageSourcePropType {
  return ASKV_IDLE_SRC;
}

export function pickAskVLogo(
  brandColor?: string | null,
  brandName?: string | null,
): ImageSourcePropType {
  const name = normalizedBrandName(brandName);
  if (name.includes("baker")) return askVBaker;
  if (name.includes("winchester")) return askVWinchester;
  if (name.includes("flywheel")) return askVFlywheel;
  if (name.includes("midcon")) return askVMidcon;
  if (name.includes("vndrly")) return askVAmber;
  if (!brandColor) return ASKV_DEFAULT_SRC;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return ASKV_DEFAULT_SRC;
  const [h, s, l] = rgbToHsl(...rgb);
  if (s < 0.12) return ASKV_DEFAULT_SRC;

  let best = ASKV_PALETTE[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of ASKV_PALETTE) {
    const candidateRgb = hexToRgb(candidate.hex);
    if (!candidateRgb) continue;
    const [candidateHue, candidateSaturation, candidateLightness] = rgbToHsl(
      ...candidateRgb,
    );
    const score =
      (hueDistance(h, candidateHue) / 180) * 3 +
      Math.abs(s - candidateSaturation) +
      Math.abs(l - candidateLightness) * 0.5;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best.src;
}
