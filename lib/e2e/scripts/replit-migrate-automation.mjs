#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "replit-migrate-output.json");

const EMAIL = process.env.REPLIT_EMAIL ?? "v@vndrly.ai";
const PASSWORD = process.env.REPLIT_PASSWORD ?? "";

function maskUrl(url) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function loginWithGoogle(page) {
  await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  const googleBtn = page.getByRole("button", { name: /google/i }).first();
  if (!(await googleBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error("Google login button not found");
  }

  const [popup] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 15000 }).catch(() => null),
    googleBtn.click(),
  ]);

  const authPage = popup ?? page;
  await authPage.waitForLoadState("domcontentloaded").catch(() => {});
  await authPage.waitForTimeout(2000);

  const emailInput = authPage.locator('input[type="email"]').first();
  if (await emailInput.isVisible({ timeout: 8000 }).catch(() => false)) {
    await emailInput.fill(EMAIL);
    await authPage.getByRole("button", { name: /next/i }).click();
    await authPage.waitForTimeout(3000);
  }

  const passInput = authPage.locator('input[type="password"]').first();
  if (await passInput.isVisible({ timeout: 8000 }).catch(() => false)) {
    await passInput.fill(PASSWORD);
    await authPage.getByRole("button", { name: /next/i }).click();
    await authPage.waitForTimeout(5000);
  }

  await page.waitForTimeout(8000);
  if (popup && !popup.isClosed()) await popup.close().catch(() => {});
}

async function loginWithEmail(page) {
  await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);
    await page.getByRole("button", { name: /log in/i }).first().click();
    await page.waitForTimeout(8000);
  }
}

async function findReplUrl(page) {
  const candidates = [
    "https://replit.com/@vndrly/VNDRLY-ai",
    "https://replit.com/@vndrly/VNDRLY.ai",
    "https://replit.com/@vndrly/vndrly",
    "https://replit.com/@vndrly/VNDRLY",
  ];

  await page.goto("https://replit.com/~", { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const homeText = await page.locator("body").innerText();
  const replLinks = [...homeText.matchAll(/replit\.com\/@[^\s/]+\/[^\s)]+/g)].map((m) => "https://" + m[0]);
  for (const link of replLinks) {
    if (/vndrly/i.test(link)) candidates.unshift(link);
  }

  for (const url of [...new Set(candidates)]) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(5000);
    const text = await page.locator("body").innerText();
    if (!/page not found|contact the owner/i.test(text)) {
      return url;
    }
  }
  return null;
}

async function runMigrationInShell(page) {
  await page.keyboard.press("Control+`").catch(() => {});
  await page.waitForTimeout(1500);
  const cmd =
    "printenv | grep -iE 'DATABASE|PGHOST|NEON|HELIUM' | head -30; echo '---'; bash scripts/replit-one-shot-migrate.sh 2>&1";
  await page.keyboard.type(cmd, { delay: 5 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(90000);
}

async function main() {
  const result = {
    loggedIn: false,
    replUrl: null,
    oldDatabaseUrls: [],
    migrationOutput: "",
    error: null,
  };

  const browser = await chromium.launch({ headless: false, slowMo: 20 });
  const page = await browser.newPage();

  try {
    await loginWithGoogle(page).catch(async (e) => {
      console.warn("Google login failed:", e.message);
      await loginWithEmail(page);
    });

    result.loggedIn = !page.url().includes("/login");
    const replUrl = await findReplUrl(page);
    result.replUrl = replUrl;
    if (!replUrl) throw new Error("Could not find accessible VNDRLY repl after login");

    await page.goto(replUrl, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(8000);

    const shellTab = page.getByText(/^Shell$/).first();
    if (await shellTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await shellTab.click();
      await page.waitForTimeout(2000);
    }

    await runMigrationInShell(page);
    const body = await page.locator("body").innerText();
    result.migrationOutput = body.slice(-12000);
    result.oldDatabaseUrls = [
      ...new Set(
        [...body.matchAll(/postgresql:\/\/[^\s"'<>]+/g)]
          .map((m) => m[0])
          .filter((u) => !u.includes("supabase.co")),
      ),
    ].map(maskUrl);

    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    result.error = String(err);
    await page.screenshot({ path: join(__dirname, "replit-error.png"), fullPage: true }).catch(() => {});
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
