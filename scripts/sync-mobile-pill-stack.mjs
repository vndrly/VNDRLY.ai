#!/usr/bin/env node
/**
 * Copy canonical PillsV1 palette from attached_assets/pills/ into
 * artifacts/vndrly-mobile/assets/pill-stack/ (mobile LayeredPillButton names).
 *
 * Run after: node scripts/sync-pills-v1.mjs
 * Usage:     node scripts/sync-mobile-pill-stack.mjs
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "attached_assets", "pills");
const OUT = path.join(ROOT, "artifacts", "vndrly-mobile", "assets", "pill-stack");

/** mobile pill-stack filename -> canonical name in attached_assets/pills/ */
export const MOBILE_PILL_COPY_MAP = {
  "light-grey.png": "pill_light_grey_v2r.png",
  "base-grey.png": "pill_grey.png",
  "mid-dark-grey.png": "pill_dark_grey.png",
  "mid-blue.png": "pill_blue.png",
  "mid-baby-blue.png": "pill_baby_blue.png",
  "mid-navy.png": "pill_navy.png",
  "mid-green.png": "pill_lime.png",
  "mid-green-v3.png": "pill_green.png",
  "mid-dark-green.png": "pill_dark_green.png",
  "mid-red.png": "pill_red.png",
  "mid-red-v2.png": "pill_red.png",
  "mid-dark-red.png": "pill_dark_red.png",
  "mid-orange.png": "pill_amber.png",
  "mid-tan.png": "pill_tan.png",
  "mid-tan-v2.png": "pill_tan.png",
  "mid-tan-v3.png": "pill_winchester.png",
  "mid-teal.png": "pill_baker.png",
  "mid-purple.png": "pill_purple.png",
  "mid-indigo.png": "pill_indigo.png",
  "mid-hot-pink.png": "pill_hot_pink.png",
  "mid-pink.png": "pill_pink.png",
  "blue-hot.png": "pill_blue_in_progress.png",
  "orange-hot.png": "pill_amber_pending-review_v2.png",
  "highlight.png": "pill_gloss_overlay.png",
};

if (!existsSync(SRC)) {
  console.error(`Canonical pills folder not found: ${SRC}`);
  console.error("Run: node scripts/sync-pills-v1.mjs");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

let ok = 0;
const missing = [];
for (const [destName, srcName] of Object.entries(MOBILE_PILL_COPY_MAP)) {
  const srcPath = path.join(SRC, srcName);
  const destPath = path.join(OUT, destName);
  if (!existsSync(srcPath)) {
    missing.push(srcName);
    continue;
  }
  cpSync(srcPath, destPath);
  ok++;
}

console.log(`mobile pill-stack: ${ok} files synced -> ${OUT}`);
if (missing.length) {
  console.error("missing from attached_assets/pills:", missing.join(", "));
  process.exit(1);
}
