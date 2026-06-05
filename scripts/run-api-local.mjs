process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import "./dev-local-defaults.mjs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.resolve(repoRoot, "artifacts/api-server");

// Local dev runs the compiled dist bundle. Rebuild on every start so
// TypeScript route/allowlist changes (e.g. public login-brand) are
// never served from a stale dist while the web app hot-reloads.
const build = spawnSync("pnpm", ["run", "build"], {
  cwd: apiDir,
  stdio: "inherit",
  shell: true,
  env: process.env,
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const child = spawn(
  "node",
  ["--enable-source-maps", "./dist/index.mjs"],
  { cwd: apiDir, stdio: "inherit", shell: true, env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 1));
