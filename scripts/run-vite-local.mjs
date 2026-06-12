process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import "./dev-local-defaults.mjs";
// API uses PORT=8080 from .env.local; Vite dev server stays on 5173.
process.env.PORT = "5173";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(repoRoot, "artifacts/vndrly");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "vite", "--config", "vite.config.ts", "--host", "0.0.0.0"],
      { cwd: webDir, stdio: "inherit", shell: true },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

// Restart automatically if Vite exits unexpectedly.
while (true) {
  const code = await runOnce();
  if (code === 0) {
    process.exit(0);
  }
  console.error(`[vndrly-web] Vite exited with code ${code}; restarting in 3s...`);
  await sleep(3000);
}
