#!/usr/bin/env node
/**
 * Use your real Chrome profile (existing GoDaddy login) to read VPS IP.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const LOCAL = path.join(ROOT, ".local");
const OUT = path.join(LOCAL, "godaddy-automation");
const CONFIG_PATH = path.join(LOCAL, "godaddy-vps.json");
const ENV_PATH =
  process.env.GODADDY_ENV?.trim() ||
  path.join(path.dirname(ROOT), "GoDaddy.env");

const CHROME_USER_DATA = path.join(
  process.env.LOCALAPPDATA || "",
  "Google",
  "Chrome",
  "User Data",
);

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

const env = parseEnvLines(ENV_PATH);
if (isRealIp(env.vps_ip)) {
  console.log(`vps_ip already set: ${env.vps_ip}`);
  process.exit(0);
}

if (!existsSync(CHROME_USER_DATA)) {
  throw new Error("Chrome user data not found");
}

mkdirSync(OUT, { recursive: true });

console.log("Using your Chrome profile (close Chrome first if this errors)...");

const context = await chromium.launchPersistentContext(CHROME_USER_DATA, {
  channel: "chrome",
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ["--profile-directory=Default"],
});
const page = context.pages()[0] || (await context.newPage());

async function findVpsIp() {
  for (const url of [
    "https://host.godaddy.com/vps",
    "https://account.godaddy.com/products",
    "https://myh.godaddy.com/",
  ]) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(4000);
    if (/sso\.godaddy\.com/i.test(page.url())) continue;

    let ip = parseIpv4(await page.locator("body").innerText().catch(() => ""));
    if (ip) return ip;

    const servers = page.locator('a:has-text("Servers"), button:has-text("Servers")').first();
    if (await servers.isVisible({ timeout: 5000 }).catch(() => false)) {
      await servers.click();
      await page.waitForTimeout(4000);
      ip = parseIpv4(await page.locator("body").innerText().catch(() => ""));
      if (ip) return ip;
    }

    const manage = page.locator('a:has-text("Manage"), button:has-text("Manage")').first();
    if (await manage.isVisible({ timeout: 5000 }).catch(() => false)) {
      await manage.click();
      await page.waitForTimeout(4000);
      ip = parseIpv4(await page.locator("body").innerText().catch(() => ""));
      if (ip) return ip;
    }
  }
  return null;
}

try {
  const ip = await findVpsIp();
  await page.screenshot({ path: path.join(OUT, "chrome-profile.png"), fullPage: true });

  if (!ip) {
    throw new Error("Could not read VPS IP using Chrome profile");
  }

  writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), ip, pageUrl: page.url() }, null, 2),
  );
  upsertEnvLine(ENV_PATH, "vps_ip", ip);
  if (!isRealSecret(env.ssh_pass) && env.pass) {
    upsertEnvLine(ENV_PATH, "ssh_pass", env.pass);
  }
  console.log(`Saved vps_ip ${ip}`);
} finally {
  await context.close();
}
