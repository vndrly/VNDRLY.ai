#!/usr/bin/env node
/**
 * Copy canonical pill PNGs from Desktop/PillsV1 into attached_assets/pills/.
 * Run: node scripts/sync-pills-v1.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(process.env.USERPROFILE ?? "", "Desktop", "PillsV1");
const OUT = path.join(ROOT, "attached_assets", "pills");

/** PillsV1 source filename -> canonical name in attached_assets/pills/ */
export const PILL_COPY_MAP = {
  "pill_grey.png": "pill_0127_grey.png",
  "pill_light_grey.png": "pill_0068_light_grey.png",
  "pill_light_grey_v2r.png": "pill_0066_light_grey_v2r.png",
  "pill_white.png": "pill_0047_white.png",
  "pill_black.png": "pill_0033_black.png",
  "pill_blue.png": "pill_0034_blue.png",
  "pill_baby_blue.png": "pill_0031_baby_blue.png",
  "pill_navy.png": "pill_0011_navy.png",
  "pill_dark_blue.png": "pill_0039_dark_blue.png",
  "pill_indigo.png": "pill_0006_indigo.png",
  "pill_purple.png": "pill_0017_purple.png",
  "pill_pink.png": "pill_0015_pink.png",
  "pill_hot_pink.png": "pill_0004_hot_pink.png",
  "pill_red.png": "pill_0019_red.png",
  "pill_dark_red.png": "pill_0078_dark_red.png",
  "pill_amber.png": "pill_0027_amber.png",
  "pill_dark_amber.png": "pill_0090_dark_amber.png",
  "pill_orange.png": "pill_0013_orange.png",
  "pill_dark_orange.png": "pill_0081_dark_orange.png",
  "pill_tan.png": "pill_0021_tan.png",
  "pill_green.png": "pill_0074_green.png",
  "pill_dark_green.png": "pill_0040_dark_green.png",
  "pill_lime.png": "pill_0010_lime_green.png",
  "pill_teal.png": "pill_0024_teal.png",
  "pill_light_teal.png": "pill_0009_light_teal.png",
  "pill_coffee.png": "pill_0038_coffee.png",
  "pill_dark_grey.png": "pill_0043_dark_grey.png",
  "pill_vndrly.png": "pill_0030_vndrly.png",
  "pill_baker.png": "pill_0045_baker.png",
  "pill_winchester.png": "pill_0054_winchester.png",
  "pill_gloss_overlay.png": "pill_0091_color_overlay_hover.png",
};

if (!existsSync(SRC)) {
  console.error(`PillsV1 folder not found: ${SRC}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

let ok = 0;
const missing = [];
for (const [destName, srcName] of Object.entries(PILL_COPY_MAP)) {
  const srcPath = path.join(SRC, srcName);
  const destPath = path.join(OUT, destName);
  if (!existsSync(srcPath)) {
    missing.push(srcName);
    continue;
  }
  cpSync(srcPath, destPath);
  ok++;
}

console.log(`pills: ${ok} files synced -> ${OUT}`);
if (missing.length) {
  console.error("missing from PillsV1:", missing.join(", "));
  process.exit(1);
}

/** Remove superseded pill PNGs from attached_assets root (not squares/buttons). */
const ASSETS = path.join(ROOT, "attached_assets");
const KEEP = (name) =>
  /square/i.test(name) ||
  /_Button/i.test(name) ||
  /Layer-5/i.test(name) ||
  /Header|logo|download|Symbol|AskV|back-button|orb/i.test(name);

const deletePatterns = [
  /900x229.*pill/i,
  /NewPillPallet/i,
  /Vndrly_900x229/i,
  // Keep 36px slice assets for status-pill-assets (chart bars); no PillsV1 equivalents yet.
];

let removed = 0;
for (const f of readdirSync(ASSETS)) {
  if (!f.endsWith(".png")) continue;
  const full = path.join(ASSETS, f);
  if (!statSync(full).isFile()) continue;
  if (KEEP(f)) continue;
  if (!deletePatterns.some((re) => re.test(f))) continue;
  rmSync(full, { force: true });
  removed++;
}

// Legacy button-palette pill copies (keep squares/buttons there if any)
const BP = path.join(ASSETS, "button-palette");
if (existsSync(BP)) {
  for (const f of readdirSync(BP)) {
    if (!/pill/i.test(f) || !f.endsWith(".png")) continue;
    rmSync(path.join(BP, f), { force: true });
    removed++;
  }
}

console.log(`removed ${removed} superseded pill PNG(s) from attached_assets`);
