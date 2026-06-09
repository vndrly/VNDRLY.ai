#!/usr/bin/env node
/**
 * Point vndrly.ai A records at the VPS (GoDaddy Domains API).
 * Add to API Keys and Secrets/GoDaddy.env:
 *   api_key YOUR_KEY
 *   api_secret YOUR_SECRET
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, godaddyEnvPath } from "./secrets-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CFG = path.join(ROOT, ".local", "godaddy-vps.json");

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2) out[parts[0].toLowerCase()] = parts.slice(1).join(" ");
  }
  return out;
}

const gd = parseEnvFile(godaddyEnvPath());
const apiKey = gd.api_key || gd.key;
const apiSecret = gd.api_secret || gd.secret;
const ip =
  gd.vps_ip ||
  gd.ip ||
  (existsSync(LOCAL_CFG) ? JSON.parse(readFileSync(LOCAL_CFG, "utf8")).ip : null);

if (!apiKey || !apiSecret) {
  throw new Error("Add api_key and api_secret to API Keys and Secrets/GoDaddy.env (developer.godaddy.com/keys)");
}
if (!ip) throw new Error("Missing vps_ip");

const domain = "vndrly.ai";

const putRes = await fetch(
  `https://api.godaddy.com/v1/domains/${domain}/records/A/@,www`,
  {
    method: "PUT",
    headers: {
      Authorization: `sso-key ${apiKey}:${apiSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      { type: "A", name: "@", data: ip, ttl: 600 },
      { type: "A", name: "www", data: ip, ttl: 600 },
    ]),
  },
);

if (!putRes.ok) {
  throw new Error(`Update DNS failed: ${putRes.status} ${await putRes.text()}`);
}

console.log(`DNS updated: vndrly.ai and www → ${ip}`);
