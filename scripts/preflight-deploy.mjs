#!/usr/bin/env node
/**
 * Reports what is ready vs blocked for vndrly.ai deploy (no secrets printed).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, godaddyEnvPath } from "./secrets-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function ok(v) {
  return v ? "OK" : "MISSING";
}

const localEnv = parseEnvFile(path.join(ROOT, ".env.local"));
const gd = parseEnvFile(godaddyEnvPath());
const localVps = existsSync(path.join(ROOT, ".local", "godaddy-vps.json"))
  ? JSON.parse(readFileSync(path.join(ROOT, ".local", "godaddy-vps.json"), "utf8"))
  : {};

const serviceKey =
  localEnv.supabase_service_role_key || localEnv.supabase_service_key || "";
const vpsIp = gd.vps_ip || localVps.ip || "";
const realVps = vpsIp && !/YOUR\.IP|HERE|PLACEHOLDER/i.test(vpsIp);
const realSsh = Boolean(gd.ssh_pass && !/YOUR_|PASSWORD|HERE|PLACEHOLDER/i.test(gd.ssh_pass));

console.log("=== VNDRLY deploy preflight ===\n");
console.log("GitHub main:", "(run: git fetch origin && git log -1 --oneline origin/main)");
console.log("DATABASE_URL:", ok(localEnv.database_url));
console.log("SUPABASE_URL:", ok(localEnv.supabase_url));
console.log("SUPABASE_SERVICE_ROLE_KEY:", serviceKey && !/YOUR_/i.test(serviceKey) ? "OK" : "MISSING (uploads use disk on server without this)");
console.log("SESSION_SECRET:", ok(localEnv.session_secret));
console.log("VPS IP (GoDaddy.env or .local/godaddy-vps.json):", realVps ? vpsIp : `MISSING (DNS suggests 34.111.179.208 — set vps_ip in API Keys and Secrets/GoDaddy.env)`);
console.log("SSH password:", realSsh ? "OK" : "MISSING");
console.log("\nBlocked until you add:");
const blockers = [];
if (!serviceKey || /YOUR_/i.test(serviceKey)) {
  blockers.push("- SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Settings → API → service_role)");
}
if (!realVps) {
  blockers.push("- vps_ip in API Keys and Secrets/GoDaddy.env (or run: pnpm run setup:vps)");
}
if (!realSsh) {
  blockers.push("- ssh_pass in API Keys and Secrets/GoDaddy.env");
}
if (blockers.length === 0) {
  console.log("  (none — run: node scripts/godaddy-deploy.mjs)");
} else {
  for (const b of blockers) console.log(b);
}
