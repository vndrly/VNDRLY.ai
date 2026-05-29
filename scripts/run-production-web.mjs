process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
process.env.PORT ??= "4173";
process.env.BASE_PATH ??= "/";
process.env.VITE_API_PROXY_TARGET ??= "http://127.0.0.1:8080";
process.env.NODE_ENV = "production";

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(repoRoot, "artifacts/vndrly");

const child = spawn(
  "pnpm",
  ["exec", "vite", "preview", "--config", "vite.config.ts", "--host", "0.0.0.0", "--port", process.env.PORT],
  { cwd: webDir, stdio: "inherit", env: process.env, shell: true },
);

child.on("exit", (code) => process.exit(code ?? 1));
