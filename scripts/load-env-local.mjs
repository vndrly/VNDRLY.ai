/**
 * Loads repo-root `.env.local` into `process.env` for local development.
 * Does not override variables already set in the shell.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(repoRoot, ".env.local");

const forceFromFile = process.env.VNDRLY_LOAD_ENV_LOCAL === "1";

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && (process.env[key] === undefined || forceFromFile)) {
      process.env[key] = value;
    }
  }
}
