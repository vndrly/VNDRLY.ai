/**
 * Shared SSH config for VPS maintenance scripts (check-live, fix-vps-https, etc.).
 * Reads Desktop/GoDaddy.env or GODADDY_ENV — same layout as godaddy-deploy.mjs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DESKTOP = path.dirname(ROOT);

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
    if (parts.length >= 2) {
      out[parts[0].toLowerCase()] = parts.slice(1).join(" ");
    }
  }
  return out;
}

function isRealIp(v) {
  if (!v) return false;
  if (/YOUR\.IP|HERE|PLACEHOLDER|X\.X/i.test(v)) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(v).trim());
}

function isRealSecret(v) {
  if (!v) return false;
  return !/YOUR_|PASSWORD|HERE|PLACEHOLDER/i.test(String(v));
}

export function loadVpsSshConfig() {
  const gd = parseEnvFile(process.env.GODADDY_ENV || path.join(DESKTOP, "GoDaddy.env"));
  const hostCandidate = gd.vps_ip || gd.host || gd.ip;
  const host = isRealIp(hostCandidate) ? hostCandidate : null;
  const user = gd.ssh_user || gd.user_ssh || "vndrly";
  const passCandidate =
    gd.ssh_pass || gd.ssh_password || gd.vps_pass || gd.pass_ssh || gd.pass;
  const password = isRealSecret(passCandidate) ? passCandidate : null;
  const port = Number(gd.ssh_port || 22);

  if (!host) {
    throw new Error(
      "Missing VPS IP. Add vps_ip to Desktop/GoDaddy.env (or set GODADDY_ENV).",
    );
  }
  if (!password) {
    throw new Error(
      "Missing SSH password. Add ssh_pass to Desktop/GoDaddy.env.",
    );
  }

  return { host, port, username: user, password, readyTimeout: 120000 };
}

export { parseEnvFile, ROOT, DESKTOP };
