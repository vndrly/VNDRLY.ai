import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (VNDRLY.ai). */
export const ROOT = path.resolve(__dirname, "..");

/** Parent of repo — e.g. C:\Users\JohnElerick\DEV */
export const DEV_ROOT = path.dirname(ROOT);

/**
 * Local secrets folder (not in git). Override with VNDRLY_SECRETS_DIR.
 * Default: DEV\API Keys and Secrets next to the repo.
 */
export const SECRETS_DIR =
  process.env.VNDRLY_SECRETS_DIR ||
  path.join(DEV_ROOT, "API Keys and Secrets");

export function godaddyEnvPath() {
  return process.env.GODADDY_ENV || path.join(SECRETS_DIR, "GoDaddy.env");
}

export function supabaseEnvPath() {
  return process.env.SUPABASE_ENV || path.join(SECRETS_DIR, "Supabase.env");
}

export function githubPatPath() {
  return (
    process.env.GITHUB_PAT_FILE ||
    path.join(SECRETS_DIR, "VNDRLY-GitHub-PAT.env")
  );
}
