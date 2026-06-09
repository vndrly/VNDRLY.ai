#!/usr/bin/env node
/**
 * Automated GoDaddy VPS discovery — reads Desktop/GoDaddy.env, logs in, saves vps_ip.
 * Does NOT refresh the sign-in page while waiting.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { godaddyEnvPath } from "../../../scripts/secrets-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const LOCAL = path.join(ROOT, ".local");
const PROFILE = path.join(LOCAL, "godaddy-browser-profile");
const OUT = path.join(LOCAL, "godaddy-automation");
const CONFIG_PATH = path.join(LOCAL, "godaddy-vps.json");
const ENV_PATH = godaddyEnvPath();

function parseEnvLines(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2) out[parts[0].toLowerCase()] = parts.slice(1).join(" ");
  }
  return out;
}

function upsertEnvLine(filePath, key, value) {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const prefix = `${key} `;
  let found = false;
  const next = lines.map((line) => {
    if (line.toLowerCase().startsWith(prefix.toLowerCase())) {
      found = true;
      return `${key} ${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key} ${value}`);
  writeFileSync(filePath, next.join("\n").replace(/\n*$/, "") + "\n");
}

function isRealIp(v) {
  if (!v) return false;
  if (/YOUR\.IP|HERE|PLACEHOLDER|X\.X/i.test(v)) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(v.trim());
}

function isRealSecret(v) {
  if (!v) return false;
  return !/YOUR_|PASSWORD|HERE|PLACEHOLDER/i.test(v);
}

function parseIpv4(text) {
  const m = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
  if (!m) return null;
  return m.find((ip) => !ip.startsWith("127.") && !ip.startsWith("192.168."));
}

function isLoggedInUrl(url) {
  return !/sso\.godaddy\.com/i.test(url);
}

const env = parseEnvLines(ENV_PATH);
const email = env.user;
const accountPass = env.pass;

if (isRealIp(env.vps_ip)) {
  console.log(`vps_ip already set: ${env.vps_ip}`);
  process.exit(0);
}

if (!email || !accountPass) {
  throw new Error("GoDaddy.env needs user and pass lines");
}

mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: "chrome",
  viewport: { width: 1280, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = context.pages()[0] || (await context.newPage());

async function snap(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function autoLoginOnce() {
  if (isLoggedInUrl(page.url())) return;

  await page.goto("https://sso.godaddy.com/?app=account&path=%2Fproducts", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(1500);
  if (isLoggedInUrl(page.url())) return;

  const emailInput = page
    .locator(
      'input[type="email"], input[name="username"], input#username, input[autocomplete="username"]',
    )
    .first();
  if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await emailInput.fill(email);
    const cont = page.locator('button:has-text("Continue"), button#submitBtn').first();
    if (await cont.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cont.click({ force: true });
      await page.waitForTimeout(2000);
    }
  }

  const passInput = page.locator('input[type="password"]').first();
  if (await passInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await passInput.fill(accountPass);
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator("#submitBtn, button:has-text('Sign in')").first().click({ force: true });
  }

  // Never navigate again while still on SSO — only poll URL.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (isLoggedInUrl(page.url())) return;
    await page.waitForTimeout(2000);
  }
  throw new Error("GoDaddy login did not complete within 10 minutes.");
}

async function findVpsIp() {
  await page.goto("https://account.godaddy.com/products", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(3000);

  let ip = parseIpv4(await page.locator("body").innerText().catch(() => ""));
  if (ip) return ip;

  const servers = page.locator('a:has-text("Servers"), button:has-text("Servers")').first();
  if (await servers.isVisible({ timeout: 8000 }).catch(() => false)) {
    await servers.click();
    await page.waitForTimeout(4000);
    ip = parseIpv4(await page.locator("body").innerText().catch(() => ""));
    if (ip) return ip;
  }

  const manage = page.locator('a:has-text("Manage"), button:has-text("Manage")').first();
  if (await manage.isVisible({ timeout: 8000 }).catch(() => false)) {
    await manage.click();
    await page.waitForTimeout(4000);
    ip = parseIpv4(await page.locator("body").innerText().catch(() => ""));
    if (ip) return ip;
  }

  await page.goto("https://host.godaddy.com/vps", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(4000);
  return parseIpv4(await page.locator("body").innerText().catch(() => ""));
}

try {
  console.log("Logging into GoDaddy and fetching VPS IP...");
  await autoLoginOnce();
  const ip = await findVpsIp();
  await snap("final");

  if (!ip) {
    await snap("failed");
    throw new Error("Could not read VPS IP from GoDaddy (see .local/godaddy-automation/final.png)");
  }

  const bodyText = await page.locator("body").innerText();
  const cfg = {
    fetchedAt: new Date().toISOString(),
    pageUrl: page.url(),
    ip,
    hostname: null,
    sshUser: "root",
    sshPort: 22,
  };
  const hostMatch = bodyText.match(
    /([a-z0-9][-a-z0-9]*\.secureserver\.net|[a-z0-9][-a-z0-9]*\.godaddysites\.com)/i,
  );
  if (hostMatch) cfg.hostname = hostMatch[1];

  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  upsertEnvLine(ENV_PATH, "vps_ip", ip);
  if (cfg.hostname) upsertEnvLine(ENV_PATH, "vps_host", cfg.hostname);
  if (!isRealSecret(env.ssh_pass) && accountPass) {
    upsertEnvLine(ENV_PATH, "ssh_pass", accountPass);
  }

  console.log(`Saved vps_ip ${ip} to GoDaddy.env`);
} finally {
  await context.close();
}
