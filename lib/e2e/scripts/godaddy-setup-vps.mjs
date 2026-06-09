#!/usr/bin/env node
/**
 * One-time: discover VPS IP via GoDaddy login, update GoDaddy.env, optionally update DNS.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { godaddyEnvPath } from "../../../scripts/secrets-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = godaddyEnvPath();
const FETCH = path.join(__dirname, "godaddy-fetch-vps.mjs");

function upsertEnvLine(filePath, key, value) {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const prefix = `${key} `;
  let found = false;
  const next = lines.map((line) => {
    if (line.toLowerCase().startsWith(prefix.toLowerCase())) {
      found = true;
      return `${key} ${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key} ${value}`);
  writeFileSync(filePath, next.filter((l, i, a) => l.length || i < a.length - 1).join("\n") + "\n");
}

const fetch = spawnSync(process.execPath, [FETCH], {
  cwd: path.dirname(FETCH),
  stdio: "inherit",
});

if (fetch.status !== 0) {
  process.exit(fetch.status ?? 1);
}

const cfg = JSON.parse(
  readFileSync(path.join(ROOT, ".local", "godaddy-vps.json"), "utf8"),
);
if (cfg.ip) upsertEnvLine(ENV_PATH, "vps_ip", cfg.ip);
if (cfg.hostname) upsertEnvLine(ENV_PATH, "vps_host", cfg.hostname);

console.log(`Updated ${ENV_PATH} with vps_ip=${cfg.ip}`);
