/**
 * Loads repo-root `.env.local` into `process.env` for local development.
 * Does not override variables already set in the shell.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapboxEnvPath,
  openAiEnvPath,
  sendGridEnvPath,
  supabaseEnvPath,
  twilioEnvPath,
} from "./secrets-path.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(repoRoot, ".env.local");

const forceFromFile = process.env.VNDRLY_LOAD_ENV_LOCAL === "1";

function parseEnvFile(filePath) {
  const out = {};
  // Fresh local validation must never import machine-owned production secrets
  // or override the wrapper's database target, including through child imports.
  if (process.env.VNDRLY_TEST_DB_MODE === "fresh-local") return out;
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function setEnv(key, value) {
  if (key && value && (process.env[key] === undefined || forceFromFile)) {
    process.env[key] = value;
  }
}

for (const [key, value] of Object.entries(parseEnvFile(envPath))) {
  setEnv(key, value);
}

function envFileValue(env, key) {
  const matchingKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return matchingKey ? env[matchingKey] : "";
}

const openAiEnv = parseEnvFile(openAiEnvPath());
setEnv("OPENAI_API_KEY", envFileValue(openAiEnv, "OPENAI_API_KEY"));

const supabaseEnv = parseEnvFile(supabaseEnvPath());
setEnv("SUPABASE_URL", envFileValue(supabaseEnv, "SUPABASE_URL"));
setEnv("SUPABASE_SECRET_KEY", envFileValue(supabaseEnv, "SUPABASE_SECRET_KEY"));
setEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  envFileValue(supabaseEnv, "SUPABASE_SERVICE_ROLE_KEY"),
);

const mapboxEnv = parseEnvFile(mapboxEnvPath());
const mapboxAccessToken =
  mapboxEnv.MAPBOX_ACCESS_TOKEN ||
  mapboxEnv.MAPBOX_API_KEY ||
  mapboxEnv.api ||
  "";
setEnv("MAPBOX_ACCESS_TOKEN", mapboxAccessToken);
setEnv("VITE_MAPBOX_ACCESS_TOKEN", mapboxAccessToken);
setEnv("EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN", mapboxAccessToken);

const twilioEnv = parseEnvFile(twilioEnvPath());
for (const key of [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY",
  "TWILIO_API_SECRET",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_SENDER_REGISTRATION_STATUS",
  "TWILIO_A2P_STATUS",
  "TWILIO_TOLL_FREE_VERIFICATION_STATUS",
  "TWILIO_SMOKE_TO",
]) {
  setEnv(key, twilioEnv[key] || "");
}

const sendGridEnv = parseEnvFile(sendGridEnvPath());
for (const key of [
  "SENDGRID_API_KEY",
  "SENDGRID_FROM_EMAIL",
  "SENDGRID_FROM_NAME",
  "SENDGRID_SANDBOX_MODE",
  "SENDGRID_DOMAIN_AUTHENTICATED",
]) {
  setEnv(key, sendGridEnv[key] || "");
}
setEnv("SENDGRID_REPLY_TO", sendGridEnv.SENDGRID_REPLY_TO || "support@vndrly.ai");
