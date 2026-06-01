/**
 * Deploy vndrly.ai after git push — uses existing Replit account only.
 * Config auto-saved to .local/replit-deploy.json (no manual setup).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import "./load-env-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, ".local/replit-deploy.json");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function runNode(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const replId = process.env.REPL_ID?.trim();
const token = process.env.REPLIT_DEPLOY_TOKEN?.trim();

if (replId && token) {
  const deployUrl = `https://replit.com/api/v1/repls/${encodeURIComponent(replId)}/deploy`;
  console.log("Triggering Replit deploy (API)...");
  const res = await fetch(deployUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`API deploy failed (${res.status}), falling back to browser...`);
  } else {
    const healthUrl =
      process.env.PRODUCTION_HEALTH_URL?.trim() || "https://vndrly.ai/api/healthz";
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const h = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
        if (h.ok) {
          console.log(`Live: ${healthUrl}`);
          process.exit(0);
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

const cfg = loadConfig();
if (!cfg?.replUrl && !process.env.REPLIT_PASSWORD?.trim()) {
  console.log("First deploy: discovering Replit project (browser, one-time)...");
  runNode("replit-deploy-browser.mjs", ["setup"]);
}

console.log("Deploying vndrly.ai via Replit (browser automation)...");
runNode("replit-deploy-browser.mjs", ["deploy"]);
