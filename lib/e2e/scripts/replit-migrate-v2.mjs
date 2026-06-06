#!/usr/bin/env node
/** Playwright Replit login with persistent profile + Google SSO */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, ".replit-profile");
const OUT = join(__dirname, "replit-migrate-output.json");

const EMAIL = process.env.REPLIT_EMAIL ?? "v@vndrly.ai";
const PASSWORD = process.env.REPLIT_PASSWORD ?? "";

async function emailLogin(page) {
  await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  const emailInput = page.locator('input[placeholder*="mail" i], input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await emailInput.fill(EMAIL);
  await passwordInput.fill(PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForTimeout(10000);
  return !page.url().includes("/login");
}

async function googleLogin(context) {
  const page = await context.newPage();
  const emailOk = await emailLogin(page).catch(() => false);
  if (emailOk) return { page, loggedIn: true };

  await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);

  if (!page.url().includes("/login")) {
    return { page, loggedIn: true };
  }

  const googleBtn = page.locator('button:has-text("Google"), a:has-text("Google")').first();
  await googleBtn.waitFor({ state: "visible", timeout: 10000 });

  const popupPromise = context.waitForEvent("page", { timeout: 20000 });
  await googleBtn.click();
  const popup = await popupPromise.catch(() => null);
  const auth = popup ?? page;

  await auth.waitForLoadState("domcontentloaded");
  await auth.waitForTimeout(1500);

  const email = auth.locator('input[type="email"]');
  if (await email.isVisible({ timeout: 10000 }).catch(() => false)) {
    await email.fill(EMAIL);
    await auth.locator("#identifierNext button, button:has-text('Next')").first().click();
    await auth.waitForTimeout(3000);
  }

  const pass = auth.locator('input[type="password"]');
  if (await pass.isVisible({ timeout: 15000 }).catch(() => false)) {
    await pass.fill(PASSWORD);
    await auth.locator("#passwordNext button, button:has-text('Next')").first().click();
    await auth.waitForTimeout(5000);
  }

  // Allow challenge/consent screens
  await page.waitForTimeout(10000);
  await page.goto("https://replit.com/~", { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const loggedIn = !(await page.locator('a:has-text("Log in"), button:has-text("Log in")').first().isVisible().catch(() => false));
  return { page, loggedIn };
}

async function main() {
  mkdirSync(PROFILE, { recursive: true });
  const result = { loggedIn: false, replUrl: null, repls: [], oldDatabaseUrls: [], migrationOutput: "", error: null };

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    slowMo: 30,
    viewport: { width: 1440, height: 900 },
  });

  try {
    const { page, loggedIn } = await googleLogin(context);
    result.loggedIn = loggedIn;
    await page.screenshot({ path: join(__dirname, "replit-home.png"), fullPage: true });

    const body = await page.locator("body").innerText();
    result.repls = [...body.matchAll(/@[\w-]+\/[\w.-]+/g)].map((m) => m[0]).filter((x) => /vndrly/i.test(x));

    const urls = [
      ...result.repls.map((r) => `https://replit.com/${r}`),
      "https://replit.com/@vndrly/VNDRLY-ai",
    ];

    for (const url of [...new Set(urls)]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(6000);
      const t = await page.locator("body").innerText();
      if (!/page not found|contact the owner/i.test(t)) {
        result.replUrl = url;
        break;
      }
    }

    if (!result.replUrl) throw new Error("No accessible VNDRLY repl found");

    await page.keyboard.press("Control+`").catch(() => {});
    await page.waitForTimeout(1000);
    const cmd = "printenv | grep -iE 'DATABASE|PGHOST|NEON|HELIUM' | head -30; echo '---'; bash scripts/replit-one-shot-migrate.sh 2>&1";
    await page.keyboard.type(cmd, { delay: 5 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120000);

    const out = await page.locator("body").innerText();
    result.migrationOutput = out.slice(-15000);
    result.oldDatabaseUrls = [...new Set([...out.matchAll(/postgresql:\/\/[^\s"'<>]+/g)].map((m) => m[0]).filter((u) => !u.includes("supabase.co")))]
      .map((u) => u.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@"));

    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    result.error = String(e);
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(e);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main();
