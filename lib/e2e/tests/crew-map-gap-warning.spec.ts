import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

// End-to-end browser test for the Crew Map visit-event gap warning.
//
// The Crew Map page (artifacts/vndrly/src/pages/crew-map.tsx) opens an
// EventSource on /api/visits/events and listens for `visit.hello` events.
// When the server tells the client `gap: true` (because Last-Event-ID lags
// the current global seq), the page must:
//   1. show a banner with data-testid="text-visitor-gap-warning"
//      containing "Reconnected to live updates …", and
//   2. fire GET /api/visits to re-sync, then hide the banner once that
//      fetch resolves.
//
// Forcing a real gap from the server is racy in a dev environment (it
// would require disconnecting the SSE in the middle of a publish), so
// this test installs a deterministic stub:
//   - window.EventSource is patched (via context.addInitScript) so any
//     EventSource opened on a URL containing "/api/visits/events" returns
//     a fake that fires a single visit.hello{gap:true} event ~250ms
//     after construction. EventSource constructions on other URLs (e.g.
//     /api/live-locations/events) are passed through to the native
//     implementation so the rest of the page works.
//   - GET /api/visits (the re-sync call from fetchVisitorsOnly) is
//     delayed for ~3s so the banner stays visible long enough to assert.
//     Once the fetch resolves with [], the page clears the banner.
//
// Login uses the seed admin (admin/admin123) — see docs/canonical-credentials.md.

const STUB_SCRIPT = `
(() => {
  const Native = window.EventSource;
  function FakeES(url, opts) {
    this.url = url;
    this.readyState = 1;
    this.withCredentials = !!(opts && opts.withCredentials);
    this._listeners = {};
    const self = this;
    setTimeout(function () {
      const ev = new MessageEvent('visit.hello', {
        data: JSON.stringify({
          type: 'visit.hello',
          currentSeq: 10,
          lastSeenSeq: 3,
          gap: true,
        }),
      });
      const listeners = self._listeners['visit.hello'] || [];
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](ev); } catch (e) { /* ignore */ }
      }
    }, 250);
  }
  FakeES.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeES.prototype.removeEventListener = function (type, fn) {
    const arr = this._listeners[type];
    if (arr) this._listeners[type] = arr.filter(function (x) { return x !== fn; });
  };
  FakeES.prototype.close = function () { this.readyState = 2; };
  const Patched = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('/api/visits/events') !== -1) {
      return new FakeES(url, opts);
    }
    return new Native(url, opts);
  };
  Patched.CONNECTING = 0;
  Patched.OPEN = 1;
  Patched.CLOSED = 2;
  window.EventSource = Patched;
})();
`;

const VISITORS_REFETCH_DELAY_MS = 3000;

// Match the GET /api/visits list endpoint specifically — i.e. the path
// ends after "visits" (or is followed by a query string), not a deeper
// segment like "/api/visits/events" or "/api/visits/123" or
// "/api/visits/me/active". This is the URL fetchVisitorsOnly() hits via
// visitsApi.list() in artifacts/vndrly/src/lib/visits-api.ts.
const VISITS_LIST_PATTERN = /\/api\/visits(?:\?[^/]*)?$/;

test("Crew Map shows the visitor-gap warning on a gap hello and clears it after re-sync", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(STUB_SCRIPT);

  const page = await ctx.newPage();

  // Delay every GET /api/visits list call so the banner remains visible
  // while the re-sync triggered by visit.hello{gap:true} is in flight.
  await page.route(VISITS_LIST_PATTERN, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, VISITORS_REFETCH_DELAY_MS),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await loginAsAdmin(page);

  await page.goto("/crew-map");

  const banner = page.locator('[data-testid="text-visitor-gap-warning"]');

  // 1. Banner appears once the FakeES fires its visit.hello{gap:true}.
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText(/Reconnected to live updates/i);

  // 2. Banner stays visible while the visitors re-fetch is pending.
  //    Sample after ~1s — well before the 3s route delay elapses.
  await page.waitForTimeout(1_000);
  await expect(banner).toBeVisible();

  // 3. Banner disappears after the delayed re-fetch resolves.
  await expect(banner).toHaveCount(0, {
    timeout: VISITORS_REFETCH_DELAY_MS + 5_000,
  });

  await ctx.close();
});
