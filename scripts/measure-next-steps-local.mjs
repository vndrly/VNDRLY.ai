// Actual changed local signed-in measurement. Existing isolated fixture only; never seeds or resets.
// Non-read API calls blocked after login. Browser-only early-return disables helper hooks.
import { chromium } from "../lib/e2e/node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.NEXT_STEPS_BENCH_URL ?? "http://127.0.0.1:15173";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local loopback preview only");
const fixture = {
  username: process.env.NEXT_STEPS_BENCH_USER,
  password: process.env.NEXT_STEPS_BENCH_PASSWORD,
};
if (!fixture.username || !fixture.password)
  throw Error(
    "Set existing isolated fixture credentials in NEXT_STEPS_BENCH_USER and NEXT_STEPS_BENCH_PASSWORD",
  );
await mkdir(".local/next-steps-performance", { recursive: true });
const results = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (let run = 0; run < 2; run++)
    for (const surface of ["dashboard", "work-hub"])
      for (const mode of run
        ? ["disabled", "enabled"]
        : ["enabled", "disabled"]) {
        console.log("starting " + run + " " + surface + " " + mode);
        const c = await browser.newContext();
        const login = await c.request.post(base + "/api/auth/login", {
          data: { username: fixture.username, password: fixture.password },
        });
        if (!login.ok())
          throw Error("Login " + login.status());
        const user = await login.json();
        await c.route("**/api/**", (r) =>
          ["GET", "HEAD"].includes(r.request().method())
            ? r.continue()
            : r.abort(),
        );
        await c.route("**/src/components/next-steps.tsx*", async (r) => {
          const res = await r.fetch();
          let s = await res.text();
          if (mode === "disabled") {
            const marker = "export function AccountNextSteps({ surface }) {";
            if (!s.includes(marker)) throw Error("Changed module marker");
            s = s.replace(marker, marker + "return null;");
          }
          await r.fulfill({ response: res, body: s });
        });
        const page = await c.newPage(),
          cdp = await c.newCDPSession(page);
        await cdp.send("Network.enable");
        let requests = [],
          initiators = [],
          failed = [],
          errors = [];
        cdp.on("Network.requestWillBeSent", (e) => {
          if (e.request.url.includes("/api/"))
            initiators.push({
              path: new URL(e.request.url).pathname,
              frames: e.initiator.stack?.callFrames.map((f) => ({
                function: f.functionName,
                url: f.url,
                line: f.lineNumber,
              })),
            });
        });
        page.on("pageerror", (e) => errors.push(e.message));
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
        page.on("requestfailed", (r) =>
          failed.push({ path: new URL(r.url()).pathname, method: r.method() }),
        );
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
          initiators = [];
          failed = [];
          errors = [];
          const start = performance.now();
          let surfaceMs, usableMs, helperSettledMs, error, control;
          try {
            if (phase === "cold")
              await page.goto(base + path, {
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
            surfaceMs = Math.round(performance.now() - start);
            // Open the dashboard details dialog; Work Hub uses a navigation trial click.
            // Both establish page-specific actionability without business-data writes.
            control =
              surface === "dashboard"
                ? 'button[aria-label="View Site Locations details"]'
                : 'a[href="/work-hub/tasks"]';
            const usable = (async () => {
              if (surface === "dashboard") {
                await page.locator(control).first().click({ timeout: 15000 });
                await page.getByRole("dialog").waitFor({ state: "visible" });
                await page.keyboard.press("Escape");
              } else
                await page
                  .locator(control)
                  .first()
                  .click({ trial: true, timeout: 15000 });
              await page.evaluate(
                () =>
                  new Promise((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(r)),
                  ),
              );
              usableMs = Math.round(performance.now() - start);
            })();
            const settled = (async () => {
              if (mode === "enabled") {
                await page
                  .locator(
                    '[data-testid="account-next-steps"][data-state="settled"]',
                  )
                  .waitFor({ state: "visible", timeout: 15000 });
                await page.waitForFunction(
                  () =>
                    !document.querySelector(
                      '[data-testid="account-next-steps"][data-state="loading"]',
                    ),
                );
              }
              await page.evaluate(
                () =>
                  new Promise((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(r)),
                  ),
              );
              helperSettledMs = Math.round(performance.now() - start);
            })();
            await Promise.all([usable, settled]);
            await page.waitForTimeout(500);
          } catch (e) {
            error = e.message;
            await page
              .screenshot({
                path: `.local/next-steps-performance/local-failed-${run}-${surface}-${mode}-${phase}.png`,
                fullPage: true,
              })
              .catch(() => {});
          }
          const counts = {};
          for (const r of requests) counts[r.path] = (counts[r.path] ?? 0) + 1;
          const sample = {
            run,
            surface,
            mode,
            phase,
            surfaceMs,
            usableMs,
            helperSettledMs,
            control,
            error,
            identity: {
              user: user.id,
              vendor: user.vendorId,
              membership: user.activeMembershipId,
            },
            requests,
            initiators,
            duplicates: Object.fromEntries(
              Object.entries(counts).filter(([, n]) => n > 1),
            ),
            failed,
            errors,
          };
          results.push(sample);
          console.log(
            JSON.stringify({
              ...sample,
              requests: requests.map((x) => [x.path, x.status]),
              initiators: undefined,
            }),
          );
          await writeFile(
            ".local/next-steps-performance/local-comparison.json",
            JSON.stringify(
              {
                measuredAt: new Date().toISOString(),
                kind: "changed-local-isolated-database",
                results,
              },
              null,
              2,
            ),
          );
        }
        await c.close();
      }
} finally {
  await browser.close();
}
