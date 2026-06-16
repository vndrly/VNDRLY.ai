#!/usr/bin/env node
/**
 * One-shot Majik bootstrap after `pnpm --filter @workspace/db run push`.
 * Seeds the circle, adds admin members, builds API + Majik web UI.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const apiDir = path.resolve(repoRoot, "artifacts/api-server");

function run(label, cmd, args, cwd) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? "unknown"})`);
  }
}

run(
  "Ensure Majik circle",
  "pnpm",
  ["exec", "tsx", "scripts/ensure-majik-circle.ts"],
  apiDir,
);

run(
  "Ensure Majik admin members",
  "pnpm",
  ["exec", "tsx", "scripts/ensure-majik-members.ts"],
  apiDir,
);

run(
  "Build API server",
  "pnpm",
  ["--filter", "@workspace/api-server", "run", "build"],
  repoRoot,
);

run(
  "Build Majik frontend",
  "pnpm",
  ["--filter", "@workspace/majik-desktop", "run", "build"],
  repoRoot,
);

console.log("\nMajik setup complete (API + web UI).");
console.log("If Rust/cargo is installed, run:");
console.log("  pnpm --filter @workspace/majik-desktop run tauri:build");
