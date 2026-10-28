import { expect, test } from "@playwright/test";
import { stableCompanyGoUuid } from "../../../artifacts/api-server/scripts/seed-companygo-fleet-workflows";
import { loginAsVendor } from "../helpers/auth";

const accounts = [
  { login: "vendor_admin@fleetgo.com", modules: ["summary", "office", "dispatch", "yard", "driver"] },
  { login: "vendor_office@fleetgo.com", modules: ["summary", "office"] },
  { login: "vendor_fleet_dispatch@fleetgo.com", modules: ["summary", "dispatch"] },
  { login: "vendor_fleet_driver@fleetgo.com", modules: ["summary", "yard", "driver"] },
] as const;

async function signIn(page: import("@playwright/test").Page, login: string) {
  await loginAsVendor(page, { username: login, password: "companygo" });
}

async function sessionScope(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.ok()).toBe(true);
  const session = await response.json();
  return {
    owner: { type: "vendor", id: session.vendorId },
    userId: session.userId,
    membershipId: session.activeMembershipId,
    sessionVersion: session.sv,
  };
}

for (const viewport of [{ name: "phone", width: 390, height: 844 }, { name: "iPad", width: 1024, height: 1366 }]) {
  for (const account of accounts) {
    test(`${viewport.name} ${account.login} completes the real Fleet portal entry and role-scoped API`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
      await page.setViewportSize(viewport);
      await signIn(page, account.login);
      const overview = await page.request.get("/api/fleet/overview?limit=50");
      expect(overview.ok(), `${account.login} overview: ${await overview.text()}`).toBe(true);
      for (const module of account.modules) {
        const response = await page.request.get(`/api/fleet/home?module=${module}`);
        expect(response.ok(), `${account.login} ${module}: ${await response.text()}`).toBe(true);
        const projection = await response.json();
        expect(projection).toMatchObject({ module });
        expect(["ready", "empty", "warning"], `${account.login} ${module}: ${JSON.stringify(projection)}`).toContain(projection.state);
        if (module === "summary") {
          expect(projection.data.companyId).toBeTruthy();
          expect(projection.data.moduleStates).toBeInstanceOf(Array);
        }
      }
      const tickets = await page.request.get("/api/tickets?limit=50");
      expect(tickets.ok()).toBe(true);
      await page.goto(account.login.includes("_office@") ? "/fleet/review" : "/fleet");
      await expect(page.locator("main.fleet-workspace"), pageErrors.join("\n")).toBeVisible();
      await expect(page.getByText("Fleet records could not be loaded. Refresh to try again.")).toHaveCount(0);
    });
  }
}

test("CompanyGo authoritative Fleet history, reusable Details, and compliance are visible through real APIs", async ({ page }) => {
  await signIn(page, "vendor_admin@fleetgo.com");
  const runs: any[] = [];
  let cursor: string | null = null;
  do {
    const response = await page.request.get(`/api/fleet/overview?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    runs.push(...body.runs);
    cursor = body.page?.nextCursor ?? null;
  } while (cursor);
  const history = runs.filter(run => run.title.startsWith("GasGo completed Fleet run day"));
  const schedule = runs.filter(run => run.title.startsWith("GasGo scheduled Fleet run day"));
  expect(new Set(history.map(run => run.schedule.plannedStartAt.slice(0, 10))).size).toBeGreaterThanOrEqual(30);
  expect(new Set(schedule.map(run => run.schedule.plannedStartAt.slice(0, 10))).size).toBeGreaterThanOrEqual(7);
  expect([...history, ...schedule].every(run => run.linkedTicketId && run.resourceAssignment?.snapshot?.detail?.driverUserId === run.driverUserId)).toBe(true);

  const detailsResponse = await page.request.get("/api/fleet/details?limit=50");
  expect(detailsResponse.ok(), await detailsResponse.text()).toBe(true);
  const details = (await detailsResponse.json()).details;
  expect(details).toEqual(expect.arrayContaining([expect.objectContaining({ id: stableCompanyGoUuid("detail:standard"), driverUserId: null })]));

  const complianceResponse = await page.request.get("/api/fleet/compliance-score");
  expect(complianceResponse.ok(), await complianceResponse.text()).toBe(true);
  const compliance = await complianceResponse.json();
  expect(compliance).toMatchObject({ advisoryOnly: true, partnerPreview: { advisoryOnly: true } });
  expect(compliance.history.length).toBeGreaterThan(0);

  await page.goto("/fleet/history");
  await expect(page.getByRole("heading", { name: "Runs (30)" })).toBeVisible();
  await expect(page.getByRole("button", { name: /GasGo completed Fleet run day/ }).first()).toBeVisible();
});

test("CompanyGo Driver completes and persists Yard and custody transitions", async ({ page }) => {
  await signIn(page, "vendor_fleet_driver@fleetgo.com");
  const scope = await sessionScope(page);
  const orderId = stableCompanyGoUuid("yard-order:assigned");
  const startOperation = stableCompanyGoUuid("e2e:yard:start");
  const reportOperation = stableCompanyGoUuid("e2e:yard:report");
  const started = await page.request.post(`/api/fleet/yard-orders/${orderId}/actions`, {
    data: { kind: "start", operationId: startOperation, expectedVersion: 1, scope, orderId },
  });
  expect(started.ok(), await started.text()).toBe(true);
  expect(await started.json()).toMatchObject({ status: "in_progress", version: 2 });
  const reported = await page.request.post(`/api/fleet/yard-orders/${orderId}/actions`, {
    data: { kind: "report", operationId: reportOperation, expectedVersion: 2, scope, orderId, outcome: "ready", notes: "CompanyGo isolated acceptance complete" },
  });
  expect(reported.ok(), await reported.text()).toBe(true);
  expect(await reported.json()).toMatchObject({ status: "reported", outcome: "ready", version: 3 });
  const yardReceipt = await page.request.get(`/api/fleet/yard-orders/operations/${reportOperation}`);
  expect(yardReceipt.ok(), await yardReceipt.text()).toBe(true);
  expect(await yardReceipt.json()).toMatchObject({ operationId: reportOperation, result: { id: orderId, status: "reported" } });

  const custodyPage = await page.request.get("/api/fleet/custody");
  expect(custodyPage.ok(), await custodyPage.text()).toBe(true);
  const custodyRows = (await custodyPage.json()).custody;
  expect(custodyRows.length).toBeGreaterThan(0);
  const current = custodyRows[0];
  const custodyOperation = stableCompanyGoUuid("e2e:custody:return");
  const custody = await page.request.post("/api/fleet/custody/operations", {
    data: {
      operationId: custodyOperation,
      expectedVersion: current.version,
      scope,
      observation: {
        companyId: scope.owner.id,
        assetId: current.observation.assetId,
        state: "returned",
        method: "driver_app",
        observedAt: "2026-10-20T18:00:00.000Z",
        observedByUserId: scope.userId,
        yardId: stableCompanyGoUuid("yard:home"),
        runId: stableCompanyGoUuid("run:active"),
        detailId: null,
        latitude: null,
        longitude: null,
        notes: "CompanyGo isolated custody acceptance",
      },
    },
  });
  expect(custody.ok(), await custody.text()).toBe(true);
  expect(await custody.json()).toMatchObject({ operationId: custodyOperation, version: current.version + 1, observation: { state: "returned" } });
  const custodyReceipt = await page.request.get(`/api/fleet/custody/operations/${custodyOperation}`);
  expect(custodyReceipt.ok(), await custodyReceipt.text()).toBe(true);
  expect(await custodyReceipt.json()).toMatchObject({ operationId: custodyOperation, result: { observation: { state: "returned" } } });
});

test("CompanyGo Dispatch can manage Yard work but cannot report physical custody", async ({ page }) => {
  await signIn(page, "vendor_fleet_dispatch@fleetgo.com");
  const scope = await sessionScope(page);
  const custodyPage = await page.request.get("/api/fleet/custody");
  expect(custodyPage.ok()).toBe(true);
  const current = (await custodyPage.json()).custody[0];
  const denied = await page.request.post("/api/fleet/custody/operations", {
    data: {
      operationId: stableCompanyGoUuid("e2e:dispatch:custody-denied"), expectedVersion: current.version, scope,
      observation: { ...current.observation, id: undefined, observedByUserId: scope.userId, observedAt: "2026-10-20T19:00:00.000Z", method: "manual" },
    },
  });
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "fleet.permission_denied" });
});

test("Compliance module outage stays isolated from current ticket work", async ({ page }) => {
  await signIn(page, "vendor_fleet_driver@fleetgo.com");
  await page.route("**/api/fleet/compliance-score", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "isolated test outage" }) }));
  const home = await page.request.get("/api/fleet/home?module=driver");
  expect(home.ok()).toBe(true);
  const orders = await page.request.get("/api/fleet/yard-orders?limit=20");
  expect(orders.ok()).toBe(true);
  await page.goto("/fleet");
  await expect(page.locator("h1").first()).toBeVisible();
});
