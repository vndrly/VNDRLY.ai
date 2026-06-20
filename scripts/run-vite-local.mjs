process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import "./dev-local-defaults.mjs";
// API uses PORT=8080 from .env.local; Vite dev server stays on 5173.
process.env.PORT = "5173";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(repoRoot, "artifacts/vndrly");
const DEV_WEB_HEALTHZ = "http://127.0.0.1:5173/api/healthz";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDevWebHealthy() {
  return new Promise((resolve) => {
    const req = http.get(DEV_WEB_HEALTHZ, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "vite", "--config", "vite.config.ts", "--host", "0.0.0.0", "--strictPort"],
      { cwd: webDir, stdio: "inherit", shell: true },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  // Never spawn a second Vite when :5173 is already healthy — that is what
  // pushed dev to :5174/:5175 and broke Edge/Chrome tabs on localhost:5173.
  if (await isDevWebHealthy()) {
    console.log(
      "[vndrly-web] Dev web already healthy at http://localhost:5173/ — not starting a duplicate.",
    );
    return;
  }

  while (true) {
    const code = await runOnce();
    if (code === 0) {
      return;
    }
    console.error(`[vndrly-web] Vite exited with code ${code}; restarting in 3s...`);
    await sleep(3000);
    if (await isDevWebHealthy()) {
      console.log(
        "[vndrly-web] Another process is now serving http://localhost:5173/ — exiting.",
      );
      return;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[vndrly-web] Fatal:", err);
    process.exit(1);
  });
