import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.E2E_BASE_URL ?? "http://localhost:23539";

// Resolve a chromium binary so the spec is runnable from the root
// `pnpm test` chain without the caller having to set PLAYWRIGHT_CHROMIUM
// or run `playwright install chromium` first. We prefer (1) the explicit
// override env var, then (2) the system chromium from the Nix
// environment ships with (which matches what dev uses), and finally
// fall back to Playwright's bundled headless-shell.
function resolveChromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  try {
    const which = execSync("which chromium", { encoding: "utf8" }).trim();
    if (which) return which;
  } catch {
    // fall through to bundled binary
  }
  return undefined;
}

const chromiumPath = resolveChromiumPath();

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Boot the api-server and the vndrly web app automatically so the
  // spec is self-contained and works from `pnpm test` even when the
  // dev workflows aren't already running. `reuseExistingServer: true`
  // keeps local dev fast: if the workflows are already up on these
  // ports, Playwright reuses them instead of spawning duplicates.
  webServer: [
    {
      command: "pnpm --filter @workspace/api-server run dev",
      url: "http://localhost:8080/api/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { PORT: "8080" },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @workspace/vndrly run dev",
      url: "http://localhost:23539/",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        PORT: "23539",
        BASE_PATH: "/",
        VITE_API_PROXY_TARGET: "http://localhost:8080",
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Prefer the system Chromium (matches the dev environment's Nix
        // package) over Playwright's bundled headless-shell, which can be
        // missing native deps in some sandboxes. Set PLAYWRIGHT_CHROMIUM
        // to override.
        launchOptions: {
          executablePath: chromiumPath,
        },
      },
    },
  ],
});
