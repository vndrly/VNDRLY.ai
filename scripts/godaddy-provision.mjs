#!/usr/bin/env node
/**
 * Full one-time production setup: fetch VPS IP from GoDaddy, then SSH bootstrap + deploy.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function run(label, scriptPath) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [scriptPath], { cwd: ROOT, stdio: "inherit" });
  return r.status === 0;
}

const fetchers = [
  ["GoDaddy VPS (Chrome profile)", path.join(ROOT, "lib/e2e/scripts/godaddy-fetch-vps-chrome.mjs")],
  ["GoDaddy VPS (login)", path.join(ROOT, "lib/e2e/scripts/godaddy-fetch-vps.mjs")],
];

let ok = false;
for (const [label, script] of fetchers) {
  if (run(label, script)) {
    ok = true;
    break;
  }
}
if (!ok) process.exit(1);

if (!run("Production deploy", path.join(ROOT, "scripts/godaddy-deploy.mjs"))) {
  process.exit(1);
}

console.log("\nProduction setup finished.");
