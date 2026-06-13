#!/usr/bin/env node
/**
 * Swap the bundled VNDRLY square logo everywhere + refresh platform_settings
 * logos in the DB (so logged-in / public-platform-brand surfaces match).
 *
 * Usage:
 *   node scripts/swap-vndrly-logo.mjs [path-to-square-logo.png]
 *
 * Default source: attached_assets/VNDRLY-Logo-v6.png
 */
import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const defaultSrc = path.join(ROOT, "attached_assets", "VNDRLY-Logo-v6.png");
const src = path.resolve(process.argv[2] ?? defaultSrc);

if (!existsSync(src)) {
  console.error(`Logo not found: ${src}`);
  process.exit(1);
}

const copyTargets = [
  path.join(ROOT, "attached_assets", "VNDRLY-Logo-v6.png"),
  path.join(ROOT, "attached_assets", "vndrlylogo7.png"),
  path.join(ROOT, "attached_assets", "vndrlylogo7_1778217520404.png"),
  path.join(ROOT, "artifacts", "vndrly", "public", "favicon.png"),
  path.join(ROOT, "artifacts", "vndrly", "public", "apple-touch-icon.png"),
  path.join(ROOT, "artifacts", "vndrly", "public", "default.png"),
  path.join(ROOT, "artifacts", "vndrly-mobile", "assets", "images", "vndrly-logo-amber.png"),
  path.join(ROOT, "artifacts", "vndrly-mobile", "assets", "images", "icon.png"),
];

for (const dest of copyTargets) {
  cpSync(src, dest);
}
console.log(`Copied ${path.basename(src)} → ${copyTargets.length} bundled locations`);

const uploadScript = path.join(ROOT, "artifacts", "api-server", "scripts", "swap-platform-logo.ts");
const tsxCli = path.join(ROOT, "artifacts", "api-server", "node_modules", "tsx", "dist", "cli.mjs");
const run = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileUrl(path.join(ROOT, "scripts", "load-env-local.mjs")),
    tsxCli,
    uploadScript,
    src,
  ],
  { stdio: "inherit", cwd: path.join(ROOT, "artifacts", "api-server"), env: { ...process.env, VNDRLY_LOAD_ENV_LOCAL: "1" } },
);

process.exit(run.status ?? 1);

function pathToFileUrl(p) {
  return new URL(`file:///${p.replace(/\\/g, "/")}`).href;
}
