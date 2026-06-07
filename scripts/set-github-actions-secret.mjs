#!/usr/bin/env node
/**
 * Upload a repository Actions secret via the GitHub REST API.
 *
 * Usage:
 *   node scripts/set-github-actions-secret.mjs SECRET_NAME path/to/value.env
 *
 * Reads the PAT from VNDRLY-GitHub-PAT.env (Desktop). Never commit secret values.
 */
import { readFileSync } from "node:fs";
import sodium from "libsodium-wrappers";

const secretName = process.argv[2];
const valueFile = process.argv[3];
const patFile =
  process.env.GITHUB_PAT_FILE ||
  "C:\\Users\\JohnElerick\\OneDrive - Elerick.com\\Desktop\\VNDRLY-GitHub-PAT.env";
const repo = process.env.GITHUB_REPO || "vndrly/VNDRLY.ai";

if (!secretName || !valueFile) {
  console.error(
    "Usage: node scripts/set-github-actions-secret.mjs SECRET_NAME path/to/value.env",
  );
  process.exit(1);
}

function readEnvValue(filePath) {
  const raw = readFileSync(filePath, "utf8").trim();
  const eq = raw.indexOf("=");
  if (eq !== -1 && !raw.slice(0, eq).includes(" ")) {
    return raw.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return raw;
}

function readPat(filePath) {
  const raw = readFileSync(filePath, "utf8").trim();
  if (raw.startsWith("ghp_") || raw.startsWith("github_pat_")) return raw;
  const eq = raw.indexOf("=");
  if (eq !== -1) return raw.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  return raw;
}

async function githubJson(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  await sodium.ready;
  const token = readPat(patFile);
  const value = readEnvValue(valueFile);
  const [owner, name] = repo.split("/");

  const { key, key_id } = await githubJson(
    `/repos/${owner}/${name}/actions/secrets/public-key`,
    { token },
  );

  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(key, "base64");
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  const encrypted = Buffer.from(encryptedBytes).toString("base64");

  await githubJson(`/repos/${owner}/${name}/actions/secrets/${secretName}`, {
    method: "PUT",
    token,
    body: { encrypted_value: encrypted, key_id },
  });

  console.log(`Set Actions secret ${secretName} on ${repo}.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
