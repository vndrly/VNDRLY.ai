// Read-only rendered-page comparison. Requires an existing account; never seeds data.
import { chromium } from "../lib/e2e/node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.TRAINING_BENCH_URL ?? "http://localhost:5173";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && base !== "https://vndrly.ai") throw Error("Benchmark requires localhost or the explicitly authorized VNDRLY site");
const username = process.env.TRAINING_BENCH_USER;
const password = process.env.TRAINING_BENCH_PASSWORD;
if (!username || !password) throw Error("Provide TRAINING_BENCH_USER and TRAINING_BENCH_PASSWORD");
const methods = (process.env.TRAINING_BENCH_METHODS ?? "baseline,server,render,cache").split(",");
const repeats = Number(process.env.TRAINING_BENCH_REPEATS ?? 3);
const output = process.env.TRAINING_BENCH_OUTPUT ?? ".local/training-population";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true, timeout: 20_000 });
const results = [];
const ready = () => {
  const personal = document.querySelector('[data-progress-personal-state="ready"]');
  if (!document.querySelector('[data-progress-personal-state]')) {
    const card = document.querySelector('.hub-certificates');
    return !!card && !!card.querySelector('[aria-label="Overall training completion"]') &&
      !!card.querySelector('[aria-label="Company safety score"]') &&
      [...card.querySelectorAll('summary')].some(row => row.textContent.includes('Team Training') && /\d+%/.test(row.textContent));
  }
  return !!personal && !!document.querySelector('[data-progress-overall-state="ready"]') &&
    (personal.getAttribute("data-progress-team-required") !== "true" || !!document.querySelector('[data-progress-team-state="ready"]'));
};
try {
  for (let run = 0; run < repeats; run++) for (const method of [...methods.slice(run % methods.length), ...methods.slice(0, run % methods.length)]) {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-vndrly-performance-profile": "1" } });
    const login = await context.request.post(`${base}/api/auth/login`, { data: { username, password }, timeout: 30_000 });
    if (!login.ok()) throw Error(`Existing account login failed: ${login.status()}`);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const phase of ["cold", "warm"]) {
      if (phase === "warm") {
        // Real in-app route changes retain QueryClient; a reload would not.
        await page.evaluate(() => { history.pushState({}, "", "/work-hub/tasks" + location.search); dispatchEvent(new PopStateEvent("popstate")); });
        await page.waitForTimeout(150);
      }
      const requests = [], payloads = {};
      const onResponse = async response => {
        const url = response.url();
        if (!/\/api\/(auth\/me|work-hub\/repository\/(progress|team-progress|safety-summary))($|\?)/.test(url)) return;
        const request = response.request();
        await response.finished();
        const timing = request.timing();
        requests.push({ path: new URL(url).pathname, status: response.status(), startMs: timing.startTime, responseEndMs: timing.responseEnd, timing, serverTiming: response.headers()['server-timing'] });
        if (response.ok() && /repository\//.test(url)) payloads[new URL(url).pathname] = await response.json().catch(() => null);
      };
      page.on("response", onResponse);
      const start = performance.now();
      try {
        if (phase === "cold") await page.goto(`${base}/work-hub${method === "default" ? "" : `?progressBenchmark=1&progressMethod=${method}`}`, { waitUntil: "commit", timeout: 30_000 });
        else await page.evaluate(() => { history.pushState({}, "", "/work-hub" + location.search); dispatchEvent(new PopStateEvent("popstate")); });
        await page.waitForFunction(ready, undefined, { timeout: 60_000 });
        // Wait through two paint opportunities, not merely receipt of JSON.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const ms = Math.round(performance.now() - start);
        const card = page.locator(".hub-certificates");
        const text = await card.innerText();
        const html = await card.innerHTML();
        await card.screenshot({ path: `${output}/${method}-${run}-${phase}.png`, timeout: 10_000 });
        const hashes = Object.fromEntries(Object.entries(payloads).map(([k,v]) => [k, createHash("sha256").update(JSON.stringify(v)).digest("hex")]));
        results.push({ method, run, phase, ms, text, payloadHashes: hashes, requests, errors: [...errors] });
        await writeFile(`${output}/${method}-${run}-${phase}.html`, html);
        console.log(JSON.stringify({ method, run, phase, ms, errors: errors.length }));
      } catch (e) {
        results.push({ method, run, phase, failed: e.message, requests, errors: [...errors] });
        console.log(JSON.stringify({ method, run, phase, failed: e.message }));
        await page.screenshot({ path: `${output}/${method}-${run}-${phase}-failed.png` }).catch(() => {});
      } finally { page.off("response", onResponse); }
      await writeFile(`${output}/results.json`, JSON.stringify({ measuredAt: new Date().toISOString(), base, results }, null, 2));
    }
    await context.close();
  }
} finally { await browser.close(); }
