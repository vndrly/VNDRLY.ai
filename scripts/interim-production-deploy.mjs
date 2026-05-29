#!/usr/bin/env node
/**
 * Interim production deploy: GitHub-ready build + local API/web + persistent public tunnel.
 * No GoDaddy login required.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_PORT,
  WEB_PORT,
  startProduction,
  startTunnelDetached,
  stopProduction,
  saveProductionState,
} from "./production-processes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCAL = path.join(ROOT, ".local");

mkdirSync(LOCAL, { recursive: true });

function run(label, cmd, args, opts = {}) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status ?? 1})`);
  }
}

async function waitForHealth(url, attempts = 45) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  stopProduction();

  run("Build API", "pnpm", ["--filter", "@workspace/api-server", "run", "build"]);
  run("Build web", "pnpm", ["--filter", "@workspace/vndrly", "run", "build"], {
    env: { ...process.env, BASE_PATH: "/", NODE_ENV: "production" },
  });

  const { apiPid, webPid } = startProduction();
  console.log(`  API pid ${apiPid}`);
  console.log(`  Web pid ${webPid}`);

  await new Promise((r) => setTimeout(r, 8000));

  const ok = await waitForHealth(`http://127.0.0.1:${API_PORT}/api/healthz`);
  if (!ok) {
    const log = existsSync(path.join(LOCAL, "api-production.log"))
      ? readFileSync(path.join(LOCAL, "api-production.log"), "utf8").slice(-3000)
      : "(empty log)";
    throw new Error(`API health check failed.\n${log}`);
  }

  const webOk = await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`, 15);
  if (!webOk) {
    throw new Error("Web preview failed on localhost");
  }

  console.log("\n→ Public tunnel");
  const tunnel = await startTunnelDetached();
  saveProductionState([apiPid, webPid, tunnel.pid]);

  const publicHealth = await waitForHealth(`${tunnel.url}/api/healthz`, 40);
  if (!publicHealth) {
    console.warn(`Public URL slow to warm up — check ${tunnel.url} in a minute`);
  }

  console.log("");
  console.log("Live on the internet.");
  console.log(`  Local:  http://127.0.0.1:${WEB_PORT}`);
  console.log(`  Public: ${tunnel.url}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
