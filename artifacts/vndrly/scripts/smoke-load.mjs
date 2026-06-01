import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:5173/";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);

const rootHtml = await page.locator("#root").innerHTML();
const hasRoot = rootHtml.length > 20;
const title = await page.title();

console.log("URL:", page.url());
console.log("Title:", title);
console.log("Root children length:", rootHtml.length);
console.log("Root preview:", rootHtml.slice(0, 200).replace(/\s+/g, " "));

if (errors.length) {
  console.error("JS ERRORS:");
  for (const e of errors) console.error(" ", e);
  process.exit(1);
}
if (!hasRoot) {
  console.error("FAIL: #root is empty — app did not mount");
  process.exit(1);
}
console.log("OK: page mounted with no JS errors");
await browser.close();
