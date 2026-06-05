#!/usr/bin/env node
/**
 * Sync button-palette PNGs from Desktop "vndrly image pallet" and attached_assets fallbacks.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "attached_assets", "button-palette");
const ASSETS = path.join(ROOT, "attached_assets");
const DESKTOP_PALLET = path.join(
  process.env.USERPROFILE,
  "OneDrive - Elerick.com",
  "Desktop",
  "vndrly image pallet",
);

/** Exact filename -> fallback basename(s) in attached_assets root */
const FALLBACKS = {
  "900x229_Light-grey_v2r_square.png": [
    "900x229_Light-grey_v2r_square.png",
    "900x229_Light-grey_v2r_Pill_1778256462229.png",
    "900x229_Light-grey_v2r_Pill_1778247577555.png",
    "900x229_Light_Grey_Pill_1777116998094.png",
  ],
  "900x229_grey_square.png": [
    "900x229_grey_square.png",
    "900x229_Grey_Pill_1777067745193.png",
  ],
  "900x229_red_square_v4.png": [
    "900x229_red_square_v4.png",
    "900x229_red_Pill_v2_1777847855327.png",
    "900x229_dark_red_Pill_v2_1778247577558.png",
  ],
  "900x229_Amber_squarel_v3.png": [
    "900x229_Amber_squarel_v3.png",
    "900x229_Amber_squarel_v3_1778219898400.png",
    "900x229_Amber_Pill_v4_1778504507024.png",
  ],
  "900x229_tan_square-v2.png": [
    "900x229_tan_square-v2.png",
    "900x229_tan_square-v4.png",
    "900x229_tan_Pill-v3_1777847122888.png",
  ],
  "900x229_lime_green_square_v3.png": [
    "900x229_lime_green_square_v3.png",
    "900x229_green_Pill_v3_1777847855324.png",
  ],
  "900x229_green_square_v3.png": [
    "900x229_green_square_v3.png",
    "900x229_green_Pill_v3_1777847855324.png",
    "900x229_Green_Pill_1777099484825.png",
  ],
  "900x229_dark_green_square.png": [
    "900x229_dark_green_square.png",
    "900x229_green_Pill_v4_1778247577559.png",
  ],
  "900x229_teal_square.png": [
    "900x229_teal_square.png",
    "900x229_baker_teal_button.png",
  ],
  "900x229_dark_blue_square-v2.png": [
    "900x229_dark_blue_square-v2.png",
    "900x229_blue_Pill_v4_1777847855329.png",
    "NewPillPallet_0001s_0017_900x229_blue_Pill.png",
  ],
  "900x229_purple_square_v2.png": [
    "900x229_purple_square_v2.png",
    "900x229_purple_Pill_v2_1777847855326.png",
  ],
  "900x229_hot-pink_square-v2l.png": [
    "900x229_hot-pink_square-v2l.png",
    "900x229_hot_pink_Pill_1777847855324.png",
  ],
  "900x229_pink_square.png": [
    "900x229_pink_square.png",
    "900x229_pink_Pill_v2_1777847855326.png",
  ],
  "900x229_baker_teal_button.png": ["900x229_baker_teal_button.png"],
  "900x229_tan_square-v4.png": ["900x229_tan_square-v4.png"],
  "900x229_Light-grey_v2r_Pill.png": [
    "900x229_Light-grey_v2r_Pill.png",
    "900x229_Light-grey_v2r_Pill_1778256462229.png",
  ],
  "900x229_blue_Pill_v3.png": [
    "900x229_blue_Pill_v3.png",
    "900x229_blue_Pill_v4_1777847855329.png",
    "NewPillPallet_0001s_0017_900x229_blue_Pill.png",
  ],
  "900x229_green_Pill_v3.png": [
    "900x229_green_Pill_v3.png",
    "900x229_green_Pill_v3_1777847855324.png",
    "NewPillPallet_0001s_0051_900x229_green_Pill_v3.png",
  ],
  "900x229_red_Pill_v2.png": [
    "900x229_red_Pill_v2.png",
    "900x229_red_Pill_v2_1777847855327.png",
  ],
  "900x229_Amber_Pill_v4.png": [
    "900x229_Amber_Pill_v4.png",
    "900x229_Amber_Pill_v4_1778504507024.png",
  ],
  "900x229_baker_teal_Pill.png": [
    "900x229_baker_teal_Pill.png",
    "900x229_baker_teal_button.png",
  ],
  "900x229_tan_Pill-v3.png": ["900x229_tan_Pill-v3.png", "NewPillPallet_0001s_0028_900x229_tan_Pill-v3.png"],
  "900x229_tan_Pill-v4.png": ["900x229_tan_Pill-v4.png"],
  "900x229_white_Pill2.png": [
    "900x229_white_Pill2.png",
    "900x229_white_Pill2_1778850026167.png",
    "900x229_white_Pillv2.png",
  ],
  "900x229_orange_Pill_v2.png": [
    "900x229_orange_Pill_v2.png",
    "NewPillPallet_0001s_0037_900x229_orange_Pill_v2.png",
  ],
  // Rectangular login / portal buttons (flat corners — not pills).
  "900x229_Grey_Button.png": ["900x229_Grey_Button.png", "900x229_Grey_Button_v2.png", "grey-button.png"],
  "900x229_Dark_Grey_Button.png": ["900x229_Dark_Grey_Button.png"],
  "900x229_Amber_Button.png": ["900x229_Amber_Button.png", "amber-button.png"],
  "900x229_Dark_Amber_Button.png": ["900x229_Dark_Amber_Button.png"],
  "900x229_Red_Button.png": ["900x229_Red_Button.png", "red-button.png"],
  "900x229_Dark_Red_Button.png": ["900x229_Dark_Red_Button.png"],
  "900x229_Green_Button.png": ["900x229_Green_Button.png", "green-button.png"],
  "900x229_Dark_Green_Button.png": ["900x229_Dark_Green_Button.png"],
  "900x229_Blue_Button.png": ["900x229_Blue_Button.png", "blue-button.png"],
  "900x229_Dark_Blue_Button.png": ["900x229_Dark_Blue_Button.png"],
  "900x229_Purple_Button.png": ["900x229_Purple_Button.png"],
  "900x229_Orange_Button.png": ["900x229_Orange_Button.png"],
  "900x229_Indego_Button.png": ["900x229_Indego_Button.png"],
  "900x229_nonhover_square.png": ["900x229_nonhover_square.png"],
  "900x229_rollover_square.png": ["900x229_rollover_square.png"],
  "900x229_overlay_square.png": ["900x229_overlay_square.png"],
  "900x229_overlay_squarev2.png": ["900x229_overlay_squarev2.png"],
};

function findIn(dir, name) {
  const direct = path.join(dir, name);
  if (existsSync(direct)) return direct;
  return null;
}

function fileMd5(filePath) {
  return createHash("md5").update(readFileSync(filePath)).digest("hex");
}

/** MD5 of every *Pill* PNG in attached_assets — used to reject pill fallbacks for square targets. */
function buildPillHashes() {
  const hashes = new Set();
  for (const f of readdirSync(ASSETS)) {
    if (!f.endsWith(".png") || !/pill/i.test(f)) continue;
    hashes.add(fileMd5(path.join(ASSETS, f)));
  }
  return hashes;
}

function resolveSquareSource(targetName, pillHashes) {
  const base = targetName.replace(/\.png$/i, "");
  const dirs = [DESKTOP_PALLET, ASSETS].filter((d) => existsSync(d));
  const candidates = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".png")) continue;
      const stem = f.replace(/\.png$/i, "");
      if (stem === base || stem.startsWith(`${base}_`)) {
        candidates.push(path.join(dir, f));
      }
    }
  }
  // Prefer real square art: largest file whose hash is not a known pill duplicate.
  const real = candidates
    .filter((p) => !pillHashes.has(fileMd5(p)))
    .sort((a, b) => statSync(b).size - statSync(a).size);
  if (real.length) return real[0];
  // Last resort: exact canonical name only (never pill-named fallbacks).
  for (const dir of dirs) {
    const exact = findIn(dir, targetName);
    if (exact && !pillHashes.has(fileMd5(exact))) return exact;
  }
  return null;
}

function resolveSource(targetName, pillHashes) {
  if (/square/i.test(targetName)) {
    const square = resolveSquareSource(targetName, pillHashes);
    if (square) return square;
  }
  if (existsSync(DESKTOP_PALLET)) {
    const fromPallet = findIn(DESKTOP_PALLET, targetName);
    if (fromPallet) return fromPallet;
    const lower = targetName.toLowerCase();
    for (const f of readdirSync(DESKTOP_PALLET)) {
      if (f.toLowerCase() === lower) return path.join(DESKTOP_PALLET, f);
    }
  }
  for (const candidate of FALLBACKS[targetName] ?? [targetName]) {
    if (/square/i.test(targetName) && /pill/i.test(candidate)) continue;
    const hit = findIn(ASSETS, candidate);
    if (hit) return hit;
  }
  return null;
}

mkdirSync(OUT, { recursive: true });

const pillHashes = buildPillHashes();
let ok = 0;
const missing = [];
for (const target of Object.keys(FALLBACKS)) {
  const src = resolveSource(target, pillHashes);
  const dest = path.join(OUT, target);
  if (!src) {
    missing.push(target);
    continue;
  }
  cpSync(src, dest);
  ok++;
}

console.log(`button-palette: ${ok} files synced -> ${OUT}`);
if (missing.length) {
  console.log("still missing:", missing.join(", "));
  process.exitCode = 1;
}
