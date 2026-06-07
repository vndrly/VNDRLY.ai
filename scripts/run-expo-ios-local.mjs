process.env.VNDRLY_LOAD_ENV_LOCAL = "1";
import "./load-env-local.mjs";
import "./dev-local-defaults.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = path.resolve(repoRoot, "artifacts/vndrly-mobile");

const device = process.argv.find((a) => a.startsWith("--device="))?.slice("--device=".length);

const expoArgs = ["exec", "expo", "run:ios"];
if (device) expoArgs.push("--device", device);

console.log(`EXPO_PUBLIC_DOMAIN=${process.env.EXPO_PUBLIC_DOMAIN ?? "(unset)"}`);

const child = spawn("pnpm", expoArgs, {
  cwd: mobileDir,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
