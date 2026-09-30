import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (VNDRLY.ai). */
export const ROOT = path.resolve(__dirname, "..");

/** Parent of repo — e.g. C:\Users\john\OneDrive\Documents\DEV */
export const DEV_ROOT = path.dirname(ROOT);

const ONEDRIVE_SECRETS = path.join(
  "C:",
  "Users",
  "john",
  "OneDrive",
  "Documents",
  "DEV",
  "API Keys and Secrets",
);

/**
 * Local secrets folder (not in git). Override with VNDRLY_SECRETS_DIR.
 * Prefers an existing directory among:
 *   1. VNDRLY_SECRETS_DIR
 *   2. <repo-parent>\API Keys and Secrets
 *   3. %USERPROFILE%\DEV\API Keys and Secrets
 *   4. %USERPROFILE%\OneDrive\Documents\DEV\API Keys and Secrets
 *   5. C:\Users\john\OneDrive\Documents\DEV\API Keys and Secrets
 */
export function resolveSecretsDir() {
  if (process.env.VNDRLY_SECRETS_DIR) {
    return process.env.VNDRLY_SECRETS_DIR;
  }
  const home = os.homedir();
  const candidates = [
    path.join(DEV_ROOT, "API Keys and Secrets"),
    path.join(home, "DEV", "API Keys and Secrets"),
    path.join(home, "OneDrive", "Documents", "DEV", "API Keys and Secrets"),
    path.join(home, "Documents", "DEV", "API Keys and Secrets"),
    ONEDRIVE_SECRETS,
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

export const SECRETS_DIR = resolveSecretsDir();

export function godaddyEnvPath() {
  return process.env.GODADDY_ENV || path.join(SECRETS_DIR, "GoDaddy.env");
}

export function supabaseEnvPath() {
  return process.env.SUPABASE_ENV || path.join(SECRETS_DIR, "Supabase.env");
}

export function supabaseDatabaseEnvPath() {
  if (process.env.SUPABASE_DATABASE_ENV) return process.env.SUPABASE_DATABASE_ENV;
  for (const fileName of ["RXYmyPRXY_Supabase.env", "Supabase.env"]) {
    const candidate = path.join(SECRETS_DIR, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(SECRETS_DIR, "RXYmyPRXY_Supabase.env");
}

export function githubPatPath() {
  return (
    process.env.GITHUB_PAT_FILE ||
    path.join(SECRETS_DIR, "VNDRLY-GitHub-PAT.env")
  );
}

export function mapboxEnvPath() {
  return process.env.MAPBOX_ENV || path.join(SECRETS_DIR, "MAPBOX Account.env");
}

export function twilioEnvPath() {
  return process.env.TWILIO_ENV || path.join(SECRETS_DIR, "Twilio_API_Key.env");
}

export function sendGridEnvPath() {
  return process.env.SENDGRID_ENV || path.join(SECRETS_DIR, "SendGrid_API_Key.env");
}

export function massiveEnvPath() {
  return process.env.MASSIVE_ENV || path.join(SECRETS_DIR, "Massive-API-Key.env");
}

export function anthropicEnvPath() {
  return process.env.ANTHROPIC_ENV || path.join(SECRETS_DIR, "ANTHROPIC_API_KEY.env");
}

/**
 * OpenAI server credential file. Override with OPENAI_ENV on any machine.
 * The extra user-level DEV location supports VNDRLY's current Windows setup
 * without copying the key into the repository.
 */
export function openAiEnvPath() {
  if (process.env.OPENAI_ENV) return process.env.OPENAI_ENV;

  const home = os.homedir();
  const directories = [
    SECRETS_DIR,
    path.join(home, "DEV", "API Keys and Secrets"),
  ];
  const fileNames = ["OpenAI API Key v2.env", "OpenAI API Key.env"];

  for (const directory of directories) {
    for (const fileName of fileNames) {
      const candidate = path.join(directory, fileName);
      if (existsSync(candidate)) return candidate;
    }
  }

  return path.join(SECRETS_DIR, fileNames[0]);
}
