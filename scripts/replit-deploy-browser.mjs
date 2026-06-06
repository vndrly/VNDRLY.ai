#!/usr/bin/env node
/**
 * Browser-based Replit deploy — uses your existing Replit login.
 * No API token required. Stores config in .local/replit-deploy.json (gitignored).
 */
import { chromium } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCAL = path.join(ROOT, ".local");
const PROFILE = path.join(LOCAL, "replit-deploy-profile");
const CONFIG_PATH = path.join(LOCAL, "replit-deploy.json");
const OUT = path.join(LOCAL, "replit-automation");

const EMAIL = process.env.REPLIT_EMAIL?.trim() || "v@vndrly.ai";
const PASSWORD = process.env.REPLIT_PASSWORD?.trim() || "";
const HEALTH_URL =
  process.env.PRODUCTION_HEALTH_URL?.trim() || "https://vndrly.ai/api/healthz";

const REPL_CANDIDATES = [
  process.env.REPLIT_REPL_URL?.trim(),
  "https://replit.com/@vndrly/VNDRLY-ai",
  "https://replit.com/@vndrly/VNDRLY.ai",
  "https://replit.com/@vndrly/vndrly",
  "https://replit.com/@vndrly/VNDRLY",
].filter(Boolean);

mkdirSync(LOCAL, { recursive: true });
mkdirSync(OUT, { recursive: true });

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

async function snap(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  writeFileSync(path.join(OUT, `${name}.html`), await page.content());
}

async function emailLogin(page) {
  await page.goto("https://replit.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(2000);

  if (!page.url().includes("/login")) return true;

  const emailInput = page
    .locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
    .first();
  const passInput = page.locator('input[type="password"]').first();

  if (!(await emailInput.isVisible({ timeout: 8000 }).catch(() => false))) {
    return false;
  }

  await emailInput.fill(EMAIL);
  if (PASSWORD && (await passInput.isVisible({ timeout: 3000 }).catch(() => false))) {
    await passInput.fill(PASSWORD);
    await page
      .locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")')
      .first()
      .click();
    await page.waitForTimeout(8000);
  }

  return !page.url().includes("/login");
}

function extractReplId(html, url) {
  const patterns = [
    /"replId"\s*:\s*"([0-9a-f-]{36})"/i,
    /"id"\s*:\s*"([0-9a-f-]{36})"[^}]*"slug"/i,
    /repls\/([0-9a-f-]{36})/i,
    /data-repl-id="([0-9a-f-]{36})"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  const urlMatch = url.match(/([0-9a-f-]{36})/i);
  return urlMatch?.[1] ?? null;
}

async function openRepl(page, cfg) {
  if (cfg.replUrl) {
    await page.goto(cfg.replUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(5000);
    if (!/page not found|404|sign in to continue/i.test(await page.locator("body").innerText())) {
      return page.url();
    }
  }

  for (const url of REPL_CANDIDATES) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(5000);
    const text = await page.locator("body").innerText();
    if (!/page not found|404|does not exist/i.test(text)) {
      return page.url();
    }
  }

  await page.goto("https://replit.com/~", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  const link = page
    .locator('a[href*="VNDRLY" i], a[href*="vndrly" i]')
    .first();
  if (await link.count()) {
    await link.click();
    await page.waitForTimeout(5000);
    return page.url();
  }

  throw new Error("Could not open VNDRLY Repl — check REPLIT_REPL_URL in .env.local");
}

async function runShellPull(page) {
  await page.keyboard.press("Control+`").catch(() => {});
  await page.waitForTimeout(1500);

  const shellInput = page
    .locator('textarea[aria-label*="Shell" i], .cm-content, [data-testid*="shell"] textarea')
    .last();
  if (await shellInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await shellInput.click();
    await shellInput.fill("git pull origin main\n");
    await page.waitForTimeout(15000);
    return;
  }

  await page.keyboard.type("git pull origin main", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(15000);
}

async function clickPublish(page) {
  const labels = [
    /republish/i,
    /publish/i,
    /deploy/i,
    /release/i,
  ];

  for (const label of labels) {
    const btn = page.getByRole("button", { name: label }).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(3000);
      const confirm = page.getByRole("button", { name: /republish|publish|deploy|confirm/i }).last();
      if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirm.click();
      }
      return true;
    }
  }

  // Search bar fallback (new Replit UI)
  const search = page.locator('[placeholder*="Search" i], input[type="search"]').first();
  if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
    await search.click();
    await search.fill("Publishing");
    await page.waitForTimeout(1000);
    const pub = page.getByText(/publishing/i).first();
    if (await pub.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pub.click();
      await page.waitForTimeout(2000);
      const deployBtn = page.getByRole("button", { name: /republish|publish|deploy/i }).first();
      if (await deployBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await deployBtn.click();
        return true;
      }
    }
  }

  return false;
}

async function waitForHealth() {
  const deadline = Date.now() + 4 * 60 * 1000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return true;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.error(`Health check timed out (${lastErr})`);
  return false;
}

async function main() {
  const mode = process.argv[2] || "deploy";
  const cfg = loadConfig();

  const browser = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.REPLIT_DEPLOY_HEADLESS !== "0",
    viewport: { width: 1440, height: 900 },
    slowMo: 20,
  });

  const page = browser.pages()[0] ?? (await browser.newPage());

  try {
    const loggedIn = await emailLogin(page);
    await snap(page, "01-after-login");

    if (!loggedIn && !PASSWORD) {
      throw new Error(
        "Replit login failed. Add REPLIT_PASSWORD to .env.local (one-time).",
      );
    }

    const replUrl = await openRepl(page, cfg);
    await snap(page, "02-repl");

    const html = await page.content();
    const replId = extractReplId(html, replUrl) ?? cfg.replId ?? null;

    saveConfig({
      ...cfg,
      replUrl,
      replId,
      email: EMAIL,
      updatedAt: new Date().toISOString(),
    });

    if (mode === "setup") {
      console.log(JSON.stringify({ ok: true, replUrl, replId }, null, 2));
      return;
    }

    await runShellPull(page);
    await snap(page, "03-after-pull");

    const published = await clickPublish(page);
    await snap(page, "04-after-publish");

    if (!published) {
      console.warn("Publish button not found — git pull ran; check Replit deploy settings.");
    } else {
      console.log("Republish triggered in Replit.");
    }

    const live = await waitForHealth();
    if (!live) process.exit(1);
    console.log(`Live: ${HEALTH_URL}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
