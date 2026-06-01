import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:5173/";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  if (/Failed to load resource.*\(401|404\)/.test(text)) return;
  if (/toggle-pill|baker-pill|pick-toggle|Failed to fetch dynamically imported module|does not provide an export/i.test(text)) {
    errors.push(`console: ${text}`);
  }
});

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);

const rootHtml = await page.locator("#root").innerHTML();
const hasRoot = rootHtml.length > 20;

console.log("URL:", page.url());
console.log("Root children length:", rootHtml.length);

if (errors.length) {
  console.error("JS ERRORS:");
  for (const e of errors) console.error(" ", e);
  process.exit(1);
}
if (!hasRoot) {
  console.error("FAIL: #root is empty");
  process.exit(1);
}
console.log("OK: page mounted with no JS errors");
await browser.close();
