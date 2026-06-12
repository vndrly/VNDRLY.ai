process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import "./dev-local-defaults.mjs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.resolve(repoRoot, "artifacts/api-server");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildApi() {
  const build = spawnSync("pnpm", ["run", "build"], {
    cwd: apiDir,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

async function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(
      "node",
      ["--enable-source-maps", "./dist/index.mjs"],
      { cwd: apiDir, stdio: "inherit", shell: true, env: process.env },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

// Local dev runs the compiled dist bundle. Rebuild on every start so
// TypeScript route changes are never served from stale dist.
buildApi();

while (true) {
  const code = await runOnce();
  if (code === 0) {
    process.exit(0);
  }
  console.error(`[vndrly-api] Exited with code ${code}; rebuilding and restarting in 3s...`);
  await sleep(3000);
  buildApi();
}
