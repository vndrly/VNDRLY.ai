process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import { applyLocalSessionSecret } from "./local-session-secret.mjs";
// This wrapper serves a built API locally; it is not the VPS startup command.
applyLocalSessionSecret();
process.env.PORT ??= "8080";
process.env.BASE_PATH ??= "/";

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.resolve(repoRoot, "artifacts/api-server");

const child = spawn(
  process.execPath,
  ["--enable-source-maps", "./dist/index.mjs"],
  { cwd: apiDir, stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 1));
