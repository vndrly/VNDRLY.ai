// Reproduces the 2026-11-09 PRE-CHANGE live helper experiment only.
// Deliberately fails if the deployed minified function markers change.
// Uses existing authenticated reads, blocks non-read API calls after login.
// Output is ignored .local; no credentials, tokens or response bodies are saved.
import { chromium } from "../lib/e2e/node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// Existing account only. Credentials are never logged or written to evidence.
const username = process.env.NEXT_STEPS_BENCH_USER;
const password = process.env.NEXT_STEPS_BENCH_PASSWORD;
if (!username || !password)
  throw Error("Set NEXT_STEPS_BENCH_USER and NEXT_STEPS_BENCH_PASSWORD");
await mkdir(".local/next-steps-performance", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY } }
    : {}),
});
const results = [];
let bundleHash;
try {
  for (let run = 0; run < 2; run++)
    for (const surface of ["dashboard", "work-hub"])
      for (const mode of run
        ? ["disabled", "enabled"]
        : ["enabled", "disabled"]) {
        if (
          results.some(
            (r) =>
              r.run === run &&
              r.surface === surface &&
              r.mode === mode &&
              r.phase === "repeat",
          )
        )
          continue;
        console.log("starting " + run + " " + surface + " " + mode);
        const context = await browser.newContext();
        const login = await context.request.post(
          "https://vndrly.ai/api/auth/login",
          { data: { username, password }, timeout: 30000 },
        );
        if (!login.ok()) throw Error("Login " + login.status());
        const user = await login.json();
        await context.route("**/api/**", (route) =>
          ["GET", "HEAD"].includes(route.request().method())
            ? route.continue()
            : route.abort(),
        );
        await context.route("**/*.js", async (route) => {
          const res = await route.fetch({ timeout: 15000 });
          let source = await res.text();
          if (source.includes("Next Steps source unavailable")) {
            bundleHash = createHash("sha256").update(source).digest("hex");
            const marker = "function I0e({surface:e}){";
            if (!source.includes(marker)) throw Error("Live helper changed");
            source = source.replace(
              marker,
              marker +
                (mode === "disabled"
                  ? "window.__nextSteps={surface:e,settled:true,disabled:true};return null;"
                  : ""),
            );
            if (mode === "enabled") {
              const needle = '}),T=[];if(o&&e==="dashboard")';
              if (!source.includes(needle))
                throw Error("Live query marker changed");
              source = source.replace(
                needle,
                '});window.__nextSteps={surface:e,settled:![p,m,v,w].some(q=>q.isFetching),error:[p,m,v,w].some(q=>q.isError)};const T=[];if(o&&e==="dashboard")',
              );
            }
          }
          await route.fulfill({ response: res, body: source });
        });
        const page = await context.newPage();
        let requests = [],
          blocked = [];
        page.on("requestfailed", (r) => {
          if (r.url().includes("/api/"))
            blocked.push({
              path: new URL(r.url()).pathname,
              method: r.method(),
            });
        });
        page.on("response", async (r) => {
          if (r.url().includes("/api/")) {
            await r.finished().catch(() => {});
            requests.push({
              path: new URL(r.url()).pathname,
              status: r.status(),
              timing: r.request().timing(),
            });
          }
        });
        const path = surface === "dashboard" ? "/" : "/work-hub";
        for (const phase of ["cold", "repeat"]) {
          if (phase === "repeat") {
            await page.evaluate(() => {
              history.pushState({}, "", "/work-hub/tasks");
              dispatchEvent(new PopStateEvent("popstate"));
            });
            await page.waitForTimeout(300);
          }
          requests = [];
          blocked = [];
          await page
            .evaluate(() => {
              delete window.__nextSteps;
            })
            .catch(() => {});
          const start = performance.now();
          let usableMs, helperSettledMs, error;
          try {
            if (phase === "cold")
              await page.goto("https://vndrly.ai" + path, {
                waitUntil: "commit",
                timeout: 30000,
              });
            else
              await page.evaluate((p) => {
                history.pushState({}, "", p);
                dispatchEvent(new PopStateEvent("popstate"));
              }, path);
            await page
              .locator(
                surface === "dashboard"
                  ? '[data-testid="dashboard-page"]'
                  : 'h1:text-is("Work Hub")',
              )
              .waitFor({ state: "visible", timeout: 45000 });
            await page.evaluate(
              () =>
                new Promise((r) =>
                  requestAnimationFrame(() => requestAnimationFrame(r)),
                ),
            );
            usableMs = Math.round(performance.now() - start);
            await page.waitForFunction(
              (s) =>
                window.__nextSteps?.surface === s && window.__nextSteps.settled,
              surface,
              { timeout: 45000 },
            );
            await page.evaluate(
              () =>
                new Promise((r) =>
                  requestAnimationFrame(() => requestAnimationFrame(r)),
                ),
            );
            helperSettledMs = Math.round(performance.now() - start);
            await page.waitForTimeout(500);
          } catch (e) {
            error = e.message;
          }
          const counts = {};
          for (const r of requests) counts[r.path] = (counts[r.path] ?? 0) + 1;
          const sample = {
            run,
            surface,
            mode,
            phase,
            usableMs,
            helperSettledMs,
            error,
            helperState: await page.evaluate(() => window.__nextSteps),
            identity: {
              userId: user.id,
              vendorId: user.vendorId,
              activeMembershipId: user.activeMembershipId,
            },
            requests,
            duplicates: Object.fromEntries(
              Object.entries(counts).filter(([, n]) => n > 1),
            ),
            blocked,
          };
          results.push(sample);
          console.log(
            JSON.stringify({
              ...sample,
              requests: requests.map((x) => ({
                path: x.path,
                status: x.status,
              })),
              blocked: blocked.length,
            }),
          );
          await writeFile(
            ".local/next-steps-performance/live-comparison.json",
            JSON.stringify(
              {
                measuredAt: new Date().toISOString(),
                kind: "pre-change-live-with-browser-only-helper-disable",
                bundleHash,
                usableDefinition:
                  "Surface root visible and two animation frames; does not imply all cards populated",
                results,
              },
              null,
              2,
            ),
          );
        }
        await Promise.race([
          context.close(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
} finally {
  await browser.close();
}
