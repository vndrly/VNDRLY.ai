// Login-portal square button palette (button-palette/*_square*.png).
//
// Enumerated brands: Baker → teal, Winchester → tan square v4 + tan pill v3, unbranded VNDRLY → amber.
// Idle (all brands): light-grey v2r square. Everyone else: best hue match.

import idleSquare from "@assets/button-palette/900x229_Light-grey_v2r_square.png";
import greySquare from "@assets/button-palette/900x229_grey_square.png";
import redSquare from "@assets/button-palette/900x229_red_square_v4.png";
import amberSquare from "@assets/button-palette/900x229_Amber_squarel_v3.png";
import tanSquare from "@assets/button-palette/900x229_tan_square-v2.png";
import limeSquare from "@assets/button-palette/900x229_lime_green_square_v3.png";
import greenSquare from "@assets/button-palette/900x229_green_square_v3.png";
import darkGreenSquare from "@assets/button-palette/900x229_dark_green_square.png";
import tealSquare from "@assets/button-palette/900x229_teal_square.png";
import blueSquare from "@assets/button-palette/900x229_dark_blue_square-v2.png";
import purpleSquare from "@assets/button-palette/900x229_purple_square_v2.png";
import hotPinkSquare from "@assets/button-palette/900x229_hot-pink_square-v2l.png";
import pinkSquare from "@assets/button-palette/900x229_pink_square.png";
import bakerTealSquare from "@assets/button-palette/900x229_baker_teal_button.png";
import winchesterTanSquare from "@assets/button-palette/900x229_tan_square-v4.png";

/** Universal light-grey idle square — every brand at rest. */
export const LOGIN_IDLE_SQUARE_SRC = idleSquare;

/** Natural width:height of the 900×229 square PNGs. */
export const LOGIN_BUTTON_IMAGE_ASPECT = 900 / 229;

type PaletteEntry = { hex: string; src: string };

const SQUARE_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: redSquare },
  { hex: "#F39C1A", src: amberSquare },
  { hex: "#B89C3A", src: tanSquare },
  { hex: "#6EB13B", src: limeSquare },
  { hex: "#149F3D", src: greenSquare },
  { hex: "#1F7A47", src: darkGreenSquare },
  { hex: "#4A8FAF", src: tealSquare },
  { hex: "#00ADB5", src: bakerTealSquare },
  { hex: "#1E5BD0", src: blueSquare },
  { hex: "#6B1FB8", src: purpleSquare },
  { hex: "#D62598", src: hotPinkSquare },
  { hex: "#DB1E5C", src: pinkSquare },
];

const VNDRLY_DEFAULT_SRC = amberSquare;

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

function isBakerBrand(name: string | null | undefined): boolean {
  return !!name?.toLowerCase().includes("baker");
}

function isWinchesterBrand(name: string | null | undefined): boolean {
  return !!name?.toLowerCase().includes("winchester");
}

/** Active/hover square for login CTAs. */
export function pickLoginSquareActive(
  brandColor: string | null | undefined,
  brandName?: string | null,
): string {
  if (isBakerBrand(brandName)) return bakerTealSquare;
  if (isWinchesterBrand(brandName)) return winchesterTanSquare;
  if (!brandColor) return VNDRLY_DEFAULT_SRC;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return VNDRLY_DEFAULT_SRC;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return greySquare;
  let bestSrc = SQUARE_PALETTE[0].src;
  let bestScore = Infinity;
  for (const entry of SQUARE_PALETTE) {
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
