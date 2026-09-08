import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import "../../scripts/dev-local-defaults.mjs";
import {
  assertIsolatedTestDatabaseEnvironment,
  assertLocalE2EBaseUrl,
} from "../../scripts/e2e-isolation.mjs";

const isolation = assertIsolatedTestDatabaseEnvironment(process.env);

const baseURL = assertLocalE2EBaseUrl(process.env.E2E_BASE_URL);

// Resolve a chromium binary so the spec is runnable from the root
// `pnpm test` chain without the caller having to set PLAYWRIGHT_CHROMIUM
// or run `playwright install chromium` first. We prefer (1) the explicit
// override env var, then (2) the system chromium from the Nix
// environment ships with (which matches what dev uses), and finally
// fall back to Playwright's bundled headless-shell.
function resolveChromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  try {
    const command =
      process.platform === "win32"
        ? "where.exe chromium"
        : "command -v chromium";
    const chromium = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (chromium) return chromium;
  } catch {
    // fall through to bundled binary
  }
  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA &&
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.PROGRAMFILES &&
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env["PROGRAMFILES(X86)"] &&
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.LOCALAPPDATA &&
        `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
      process.env.PROGRAMFILES &&
        `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
      process.env["PROGRAMFILES(X86)"] &&
        `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const installedBrowser = candidates.find((candidate) =>
      existsSync(candidate),
    );
    if (installedBrowser) return installedBrowser;
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
  // E2E is allowed to run only under the isolated DB wrapper. Never reuse a
  // pre-existing API on the dedicated port: its database provenance is unknown.
  webServer: [
    {
      command: "pnpm --filter @workspace/api-server run dev:local",
      url: "http://localhost:18080/api/healthz",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: "18080",
        DATABASE_URL: isolation.databaseUrl,
        TEST_DATABASE_URL: isolation.testDatabaseUrl,
        VNDRLY_ISOLATED_TEST_DB: "1",
      },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command:
        "pnpm --dir ../../artifacts/vndrly exec vite --config vite.config.ts --host 0.0.0.0 --strictPort",
      url: "http://localhost:23539/",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: "23539",
        BASE_PATH: "/",
        VITE_API_PROXY_TARGET: "http://localhost:18080",
        // Exercise retained accounting workflows in this isolated test server.
        // Production defaults stay disabled and are covered by release-features tests.
        VITE_ENABLE_TAX_REPORTING: "true",
        VITE_ENABLE_ACCOUNTING: "true",
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
