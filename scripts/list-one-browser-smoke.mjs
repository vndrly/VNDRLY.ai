import "./load-env-local.mjs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../lib/e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const output = new URL("../artifacts/list-one-verification/", import.meta.url);
await mkdir(output, { recursive: true });
const token = [process.env.VITE_MAPBOX_ACCESS_TOKEN, process.env.MAPBOX_ACCESS_TOKEN, process.env.MAPBOX_API_KEY].find((v) => v?.startsWith("pk."));
if (!token) throw new Error("A public Mapbox token is required for the map smoke test");
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const now = new Date().toISOString();
    const catalogWrites = [];
    const catalogItems = [
      { id: 9101, partnerId: 607, partnerName: "Warwick Energy Group", name: "Warwick Gatekeeping", category: "Gate", selected: true, unitPrice: "25.00", unit: "per_hour", currency: "USD", notes: null },
      { id: 9102, partnerId: 566, partnerName: "Flywheel Energy", name: "Flywheel Gatekeeping", category: "Gate", selected: true, unitPrice: "30.00", unit: "per_hour", currency: "USD", notes: null },
    ];
    const site = { id: 9001, name: "Sample Warwick Site", siteCode: "SITE-SAMPLE", partnerId: 607, latitude: 35.46, longitude: -97.51, siteRadiusMeters: 500, isActive: true };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let body = [];
      if (path === "/api/auth/me") body = { userId: 9000, role: "vendor", displayName: "Sample Office", vendorRole: "office", vendorId: 1054, partnerId: null, availableMemberships: [], preferredLanguage: "en" };
      else if (path === "/api/vendors/1054") body = { id: 1054, name: "MidCon Solutions", brandPrimaryColor: "#19a8b2", brandAccentColor: "#444444" };
      else if (path === "/api/vendors/1054/work-types") {
        if (route.request().method() === "PUT") {
          const payload = route.request().postDataJSON(); catalogWrites.push(payload);
          for (const item of payload.items) Object.assign(catalogItems.find(row => row.id === item.workTypeId), { unitPrice: item.unitPrice });
          body = { vendorId: 1054, added: 0, removed: 0, updated: payload.items.length };
        } else body = { vendorId: 1054, items: catalogItems };
      }
      else if (path === "/api/vendors/1054/work-type-partners") body = { vendorId: 1054, partners: [{ id: 607, name: "Warwick Energy Group" }, { id: 566, name: "Flywheel Energy" }], workTypePartners: catalogItems.map(row => ({ workTypeId: row.id, partnerId: row.partnerId })), partnerWorkTypes: catalogItems.map(row => ({ workTypeId: row.id, partnerId: row.partnerId })) };
      else if (path === "/api/public-config") body = { mapboxAccessToken: token };
      else if (path === "/api/site-locations") body = [site];
      else if (path === "/api/live-locations") body = { locations: [{ employeeId: 9002, employeeName: "Sample Gate Employee", ticketId: 9003, vendorId: 1054, lifecycleState: "en_route", siteName: site.name, siteCode: site.siteCode, siteLatitude: site.latitude, siteLongitude: site.longitude, latitude: 35.455, longitude: -97.52, batteryLevel: 0.8, heading: 45, speedMps: 10, recordedAt: now }] };
      else if (path === "/api/visits/gate/enabled") body = { enabled: true };
      else if (path === "/api/visits/gate/ops") body = { enabled: true, visits: [], staff: [], recordedVisits: [], checkIns: [] };
      else if (path === "/api/gate-report") body = {
        snapshotId: "browser-fixture", generatedAt: now, nextOffset: null,
        filters: { from: now, to: now, siteLocationId: null, partnerId: null, company: "", purpose: "", category: "all", recordKind: "all" },
        totals: { entries: 120, visitorEntries: 120, employeeCheckins: 0, currentOnsiteEntries: 120, uniqueRecordedIdentities: 120, unidentifiedEntries: 0, incompleteEntries: 0, unclassifiedEntries: 120, pendingAdmissionEntries: 0 },
        rows: Array.from({ length: 120 }, (_, index) => ({ id: `visitor:${index + 1}`, kind: "visitor", category: "unclassified", name: `REPORTPERSON${String(index + 1).padStart(3, "0")}`, company: "Sample Company", purpose: "Test visit", siteLocationId: site.id, siteName: site.name, partnerId: site.partnerId, checkInTime: now, checkOutTime: null, currentOnsite: true, incomplete: [] })),
      };
      else if (path === "/api/map/recent-trips") body = { trips: [] };
      else if (path.endsWith("/day-track")) body = { pings: [] };
      else if (path.includes("compliance")) body = { issues: [] };
      else if (path.includes("unread-count")) body = { count: 0 };
      else if (path.includes("onboarding")) body = { completed: true, complete: true, steps: [] };
      if (path.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\n" });
      return route.fulfill({ status: 200, json: body });
    });
    await page.goto("http://127.0.0.1:5181/crew-map", { waitUntil: "domcontentloaded" });
    await page.locator("canvas.mapboxgl-canvas").waitFor({ timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.getByRole("combobox", { name: "Employee filter" }).click();
    await page.getByRole("option", { name: "Sample Gate Employee", exact: true }).click();
    await page.getByTestId("crew-inspector").waitFor();
    await page.screenshot({ path: fileURLToPath(new URL(`crew-${viewport.width}.png`, output)), fullPage: true });
    await page.locator("canvas.mapboxgl-canvas").scrollIntoViewIfNeeded();
    await page.screenshot({ path: fileURLToPath(new URL(`crew-map-${viewport.width}.png`, output)), fullPage: true });
    const map = await page.locator("canvas.mapboxgl-canvas").boundingBox();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    console.log(JSON.stringify({ viewport, map, overflow, errors }));
    if (errors.length || !map || map.width < 100 || map.height < 100 || overflow) throw new Error("Crew map browser check failed");
    await page.goto("http://127.0.0.1:5181/vendor-catalog", { waitUntil: "domcontentloaded" });
    await page.getByTestId("work-type-row-9102").waitFor();
    await page.getByTestId("select-partner-filter").click();
    await page.getByRole("option", { name: "Warwick Energy Group", exact: true }).click();
    await page.getByTestId("work-type-row-9101").waitFor();
    if (await page.getByTestId("work-type-row-9102").count()) throw new Error("Catalog partner filter leaked another partner");
    await page.getByTestId("input-price-9101").fill("27.00");
    const saved = page.waitForResponse(response => response.url().endsWith("/api/vendors/1054/work-types") && response.request().method() === "PUT");
    await page.getByTestId("button-save-work-types").click();
    await saved;
    await page.waitForFunction(() => document.querySelector('[data-testid="button-save-work-types"]')?.disabled === true);
    if (catalogWrites.length !== 1 || catalogWrites[0].partnerId !== 607 || catalogWrites[0].items.some(row => row.workTypeId !== 9101)) throw new Error("Catalog save crossed partner scope");
    await page.getByTestId("select-partner-filter").click();
    await page.getByRole("option", { name: "Flywheel Energy", exact: true }).click();
    if (await page.getByTestId("input-price-9102").inputValue() !== "30.00") throw new Error("Other partner's rate changed");
    await page.screenshot({ path: fileURLToPath(new URL(`catalog-${viewport.width}.png`, output)), fullPage: true });
    await page.goto("http://127.0.0.1:5181/gate-log", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Reports", exact: true }).click();
    await page.locator("#gate-report-from").waitFor();
    await page.locator('[data-testid="gate-report"] button[type="submit"]').click();
    await page.locator("#gate-report-print").waitFor();
    await page.screenshot({ path: fileURLToPath(new URL(`gate-${viewport.width}.png`, output)), fullPage: true });
    const printHtml = await page.evaluate(async () => {
      const { buildGateReportPrintDocument } = await import("/src/lib/gate-report-print.ts");
      return buildGateReportPrintDocument(document.getElementById("gate-report-print"), "Gate Log Report");
    });
    const printPage = await context.newPage();
    await printPage.setContent(printHtml);
    await printPage.emulateMedia({ media: "print" });
    if (await printPage.locator("tbody tr:visible").count() !== 120) throw new Error("Print omitted report rows");
    await printPage.pdf({ path: fileURLToPath(new URL(`gate-print-${viewport.width}.pdf`, output)), printBackground: true, preferCSSPageSize: true });
    await context.close();
  }
} finally {
  await browser.close();
}
