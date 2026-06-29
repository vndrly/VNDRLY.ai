process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import "./dev-local-defaults.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = path.resolve(repoRoot, "artifacts/vndrly-mobile");
const proxyPort = process.env.EXPO_LOCAL_API_PROXY_PORT ?? "8099";
const proxyTarget = process.env.EXPO_LOCAL_API_PROXY_TARGET ?? "https://vndrly.ai";
process.env.EXPO_PUBLIC_DOMAIN = `http://localhost:${proxyPort}`;

const proxy = spawn(
  "node",
  ["./scripts/expo-api-proxy.mjs"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      EXPO_LOCAL_API_PROXY_PORT: proxyPort,
      EXPO_LOCAL_API_PROXY_TARGET: proxyTarget,
    },
  },
);

const child = spawn(
  "pnpm",
  ["exec", "expo", "start", "--localhost"],
  { cwd: mobileDir, stdio: "inherit", shell: true, env: process.env },
);

function stopProxy() {
  if (!proxy.killed) proxy.kill();
}

child.on("exit", (code) => {
  stopProxy();
  process.exit(code ?? 1);
});
proxy.on("exit", (code) => {
  if (code && !child.killed) child.kill();
});
process.on("SIGINT", () => {
  stopProxy();
  child.kill();
  process.exit(130);
});
