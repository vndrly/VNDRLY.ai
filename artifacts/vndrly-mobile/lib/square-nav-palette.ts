import type { ImageSourcePropType } from "react-native";

const idleSquare = require("../assets/button-palette/900x229_Light-grey_v2r_square.png");
const greySquare = require("../assets/button-palette/900x229_grey_square.png");
const redSquare = require("../assets/button-palette/900x229_red_square_v4.png");
const amberSquare = require("../assets/button-palette/900x229_Amber_squarel_v3.png");
const tanSquare = require("../assets/button-palette/900x229_tan_square-v2.png");
const limeSquare = require("../assets/button-palette/900x229_lime_green_square_v3.png");
const greenSquare = require("../assets/button-palette/900x229_green_square_v3.png");
const darkGreenSquare = require("../assets/button-palette/900x229_dark_green_square.png");
const tealSquare = require("../assets/button-palette/900x229_teal_square.png");
const blueSquare = require("../assets/button-palette/900x229_dark_blue_square-v2.png");
const purpleSquare = require("../assets/button-palette/900x229_purple_square_v2.png");
const hotPinkSquare = require("../assets/button-palette/900x229_hot-pink_square-v2l.png");
const pinkSquare = require("../assets/button-palette/900x229_pink_square.png");
const bakerTealSquare = require("../assets/button-palette/900x229_baker_teal_button.png");
const winchesterTanSquare = require("../assets/button-palette/900x229_tan_square-v4.png");
const flywheelBlueSquare = require("../assets/button-palette/900x229_flywheel_blue_square-v2.png");
const midconBlueSquare = require("../assets/button-palette/900x229_midcon_blue_square-v2.png");

export const IDLE_SQUARE_NAV_SOURCE: ImageSourcePropType = idleSquare;

type PaletteEntry = {
  hex: string;
  source: ImageSourcePropType;
};

const palette: PaletteEntry[] = [
  { hex: "#D80B0B", source: redSquare },
  { hex: "#F39C1A", source: amberSquare },
  { hex: "#B89C3A", source: tanSquare },
  { hex: "#6EB13B", source: limeSquare },
  { hex: "#149F3D", source: greenSquare },
  { hex: "#1F7A47", source: darkGreenSquare },
  { hex: "#4A8FAF", source: tealSquare },
  { hex: "#00ADB5", source: bakerTealSquare },
  { hex: "#1E5BD0", source: blueSquare },
  { hex: "#6B1FB8", source: purpleSquare },
  { hex: "#D62598", source: hotPinkSquare },
  { hex: "#DB1E5C", source: pinkSquare },
];

function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  const cleaned = hex?.trim().replace(/^#/, "") ?? "";
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((character) => character + character)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function distance(a: [number, number, number], b: [number, number, number]) {
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  return red * red + green * green + blue * blue;
}

export function pickSquareNavSource(
  brandColor: string | null | undefined,
  brandName?: string | null,
): ImageSourcePropType {
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("baker")) return bakerTealSquare;
  if (name.includes("winchester")) return winchesterTanSquare;
  if (name.includes("flywheel")) return flywheelBlueSquare;
  if (name.includes("midcon")) return midconBlueSquare;

  const target = hexToRgb(brandColor);
  if (!target) return amberSquare;
  if (Math.max(...target) - Math.min(...target) < 20) return greySquare;

  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const rgb = hexToRgb(entry.hex);
    if (!rgb) continue;
    const nextDistance = distance(target, rgb);
    if (nextDistance < bestDistance) {
      best = entry;
      bestDistance = nextDistance;
    }
  }
  return best.source;
}
