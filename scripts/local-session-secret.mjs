import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** A checkout-owned key: never accept a signing key from the parent or .env. */
export function localSessionSecret() {
  const directory = new URL("../.local/", import.meta.url);
  const file = new URL("dev-session-secret", directory);
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const key = readFileSync(file, "utf8");
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid local session key; preview startup stopped.");
  return key;
}

export function applyLocalSessionSecret() {
  // The isolated test wrapper and signed test fixtures share this known inert
  // value. Test flags alone must never preserve an unknown inherited secret.
  const isolatedFixture = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1" && process.env.SESSION_SECRET === "test-secret";
  if (!isolatedFixture) process.env.SESSION_SECRET = localSessionSecret();
  // Never pass a signing key through Vite or Expo's public environment.
  for (const name of Object.keys(process.env)) {
    if (/^(VITE_|EXPO_PUBLIC_).*SESSION.*SECRET/i.test(name)) delete process.env[name];
  }
}
