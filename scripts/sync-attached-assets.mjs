#!/usr/bin/env node
/**
 * Merge attached_assets from Desktop backups + create import aliases.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "attached_assets");
const BACKUP = path.join(
  process.env.USERPROFILE,
  "OneDrive - Elerick.com",
  "Desktop",
  "vndrly",
  "attached_assets",
);
const PALLET = path.join(
  process.env.USERPROFILE,
  "OneDrive - Elerick.com",
  "Desktop",
  "vndrly image pallet",
);

function copyTree(src, dest) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (statSync(from).isDirectory()) {
      n += copyTree(from, to);
    } else {
      cpSync(from, to);
      n++;
    }
  }
  return n;
}

function alias(destName, ...candidates) {
  const dest = path.join(OUT, destName);
  if (existsSync(dest)) return true;
  for (const c of candidates) {
    const src = path.join(OUT, c);
    if (existsSync(src)) {
      cpSync(src, dest);
      return true;
    }
  }
  return false;
}

mkdirSync(OUT, { recursive: true });
const fromBackup = copyTree(BACKUP, OUT);
const fromPalletRoot = copyTree(PALLET, OUT);
const fromPalletBtn = copyTree(PALLET, path.join(OUT, "button-palette"));

const aliases = [
  alias("vndrlylogo7.png", "vndrlylogo7_1778217520404.png", "VNDRLY-Logo-5.png"),
  alias(
    "512_Vndrly_Logo_2_1777147855089.png",
    "VNDRLY-Logo-5.png",
    "vndrlylogo7_1778217520404.png",
  ),
];

// Re-run button-palette canonical names from whatever landed in attached_assets.
import { spawnSync } from "node:child_process";
spawnSync(process.execPath, [path.join(__dirname, "sync-button-palette.mjs")], {
  stdio: "inherit",
});

const PUBLIC_BG = path.join(ROOT, "artifacts", "vndrly", "public");
const bgPng = path.join(PUBLIC_BG, "vndrly-background.png");
const bgJpg = path.join(PUBLIC_BG, "vndrly-background.jpg");
if (existsSync(bgPng)) {
  cpSync(bgPng, bgJpg);
}

console.log(
  `attached_assets merge: ${fromBackup} from backup, ${fromPalletRoot} from pallet root, ${fromPalletBtn} into button-palette`,
);
console.log(`aliases created: ${aliases.filter(Boolean).length}`);
