#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCAL = path.join(ROOT, ".local");
const STATE = path.join(LOCAL, "production.json");
const LIVE_URL = path.join(LOCAL, "live-url.txt");
const TUNNEL_LOG = path.join(LOCAL, "tunnel.log");
export const WEB_PORT = 4173;
export const API_PORT = 8080;

mkdirSync(LOCAL, { recursive: true });

function killPort(port) {
  if (process.platform !== "win32") return;
  const r = spawnSync("netstat", ["-ano"], { encoding: "utf8", shell: true });
  if (r.status !== 0) return;
  const pids = new Set();
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.includes(`:${port}`)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (pid > 0) pids.add(pid);
  }
  for (const pid of pids) {
    spawnSync("taskkill", ["/PID", String(pid), "/F"], { shell: true, stdio: "ignore" });
  }
}

function killCloudflared() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/IM", "cloudflared.exe", "/F"], { shell: true, stdio: "ignore" });
  }
}

export function cloudflaredPath() {
  const local = path.join(LOCAL, "cloudflared.exe");
  if (existsSync(local)) return local;
  const found = spawnSync("where", ["cloudflared"], { encoding: "utf8", shell: true });
  if (found.status === 0) return found.stdout.split(/\r?\n/)[0].trim();
  return null;
}

export async function ensureCloudflared() {
  const existing = cloudflaredPath();
  if (existing) return existing;
  const url =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
  const dest = path.join(LOCAL, "cloudflared.exe");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`cloudflared download failed: ${r.status}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

function readTunnelUrlFromLog() {
  if (!existsSync(TUNNEL_LOG)) return null;
  const m = readFileSync(TUNNEL_LOG, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}

export async function startTunnelDetached() {
  const bin = await ensureCloudflared();
  writeFileSync(TUNNEL_LOG, "");

  const out = openSync(TUNNEL_LOG, "a");
  const child = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${WEB_PORT}`], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const url = readTunnelUrlFromLog();
    if (url) {
      writeFileSync(LIVE_URL, url + "\n");
      return { url, pid: child.pid };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for public tunnel URL (see .local/tunnel.log)");
}

export function stopProduction() {
  if (existsSync(STATE)) {
    try {
      const state = JSON.parse(readFileSync(STATE, "utf8"));
      for (const pid of state.pids || []) {
        try {
          process.kill(pid);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(STATE);
    } catch {
      /* ignore */
    }
  }
  killCloudflared();
  killPort(API_PORT);
  killPort(WEB_PORT);
}

export function startProduction() {
  stopProduction();

  const apiLog = path.join(LOCAL, "api-production.log");
  const webLog = path.join(LOCAL, "web-production.log");
  writeFileSync(apiLog, "");
  writeFileSync(webLog, "");

  const api = spawn(process.execPath, [path.join(ROOT, "scripts/run-production-api.mjs")], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", openSync(apiLog, "a"), openSync(apiLog, "a")],
    env: { ...process.env, PORT: String(API_PORT) },
  });
  api.unref();

  const web = spawn(process.execPath, [path.join(ROOT, "scripts/run-production-web.mjs")], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", openSync(webLog, "a"), openSync(webLog, "a")],
    env: {
      ...process.env,
      PORT: String(WEB_PORT),
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
    },
  });
  web.unref();

  return { apiPid: api.pid, webPid: web.pid };
}

export function saveProductionState(pids) {
  writeFileSync(
    STATE,
    JSON.stringify(
      {
        pids,
        apiPort: API_PORT,
        webPort: WEB_PORT,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
