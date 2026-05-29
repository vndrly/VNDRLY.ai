#!/usr/bin/env node
/**
 * Routes deploy after git push: GoDaddy VPS when configured, else interim live deploy.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DESKTOP = path.dirname(ROOT);
const LOCAL_CFG = path.join(ROOT, ".local", "godaddy-vps.json");

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) {
      out[t.slice(0, eq).trim().toLowerCase()] = t.slice(eq + 1).trim();
      continue;
    }
    const parts = t.split(/\s+/);
    if (parts.length >= 2) out[parts[0].toLowerCase()] = parts.slice(1).join(" ");
  }
  return out;
}

function isRealIp(v) {
  if (!v) return false;
  if (/YOUR\.IP|HERE|PLACEHOLDER|X\.X/i.test(String(v))) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(v).trim());
}

function isRealSecret(v) {
  if (!v) return false;
  return !/YOUR_|PASSWORD|HERE|PLACEHOLDER/i.test(String(v));
}

function godaddyReady() {
  if (process.env.VNDRLY_DEPLOY_TARGET === "interim") return false;
  if (process.env.VNDRLY_DEPLOY_TARGET === "godaddy") return true;

  const gd = parseEnvFile(process.env.GODADDY_ENV || path.join(DESKTOP, "GoDaddy.env"));
  const local = existsSync(LOCAL_CFG)
    ? JSON.parse(readFileSync(LOCAL_CFG, "utf8"))
    : {};
  const host = gd.vps_ip || gd.host || gd.ip || local.ip;
  const pass =
    gd.ssh_pass || gd.ssh_password || gd.vps_pass || gd.pass_ssh || gd.pass;
  return isRealIp(host) && isRealSecret(pass);
}

function run(scriptName) {
  const script = path.join(ROOT, "scripts", scriptName);
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, stdio: "inherit" });
  process.exit(r.status ?? 1);
}

if (godaddyReady()) {
  console.log("Deploy target: GoDaddy VPS (vndrly.ai)");
  run("godaddy-deploy.mjs");
} else {
  console.log("Deploy target: interim (GitHub + live tunnel — GoDaddy paused)");
  run("interim-production-deploy.mjs");
}
