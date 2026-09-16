import { test, expect } from "@playwright/test";
import type pg from "pg";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createVendor,
  createUser,
  createUserOrgMembership,
  setActiveMembership,
  createPartner,
  createSiteLocation,
  createWorkType,
  createSiteWorkAssignment,
} from "../helpers/fixtures";
import { login, loginAsVendor } from "../helpers/auth";

test.describe("vendor managed subcontractors", () => {
  let pool: pg.Pool, vendorId: number, username: string;
  const stamp = makeStamp();
  const password = "ManagedFixtureOnly-2026";
  const siteName = `Example Gate ${stamp}`;
  test.beforeAll(async () => {
    pool = createPool();
    await pool.query(
      "INSERT INTO platform_settings (id, work_hub_enabled) VALUES (1,true) ON CONFLICT (id) DO UPDATE SET work_hub_enabled=true",
    );
    const vendor = await createVendor(pool, {
      name: `Example Managing Vendor ${stamp}`,
      contactName: "Example Admin",
      contactEmail: `managed-${stamp}@example.invalid`,
    });
    vendorId = vendor.id;
    username = `managed-admin-${stamp}@example.invalid`;
    const user = await createUser(pool, {
      username,
      email: username,
      passwordHash: hashPassword(password),
      role: "vendor",
      displayName: "Example Admin",
    });
    const membership = await createUserOrgMembership(pool, {
      userId: user.id,
      orgType: "vendor",
      vendorId,
      role: "admin",
    });
    await setActiveMembership(pool, {
      userId: user.id,
      membershipId: membership.id,
    });
    const partner = await createPartner(pool, {
      name: `Example Partner ${stamp}`,
      contactName: "Example",
      contactEmail: `partner-${stamp}@example.invalid`,
    });
    const site = await createSiteLocation(pool, {
      partnerId: partner.id,
      name: siteName,
      address: "Synthetic test address",
      latitude: 31,
      longitude: -102,
      siteCode: `MANAGED-${stamp}`,
      siteRadiusMeters: 500,
    });
    const work = await createWorkType(pool, {
      name: `Gate ${stamp}`,
      category: "Gate",
    });
    await createSiteWorkAssignment(pool, {
      siteLocationId: site.id,
      workTypeId: work.id,
      vendorId,
    });
  });
  test.afterAll(async () => {
    await pool?.end();
  });
  test("persists company, invites a worker, edits scoped role and revokes without losing history", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180000);
    await loginAsVendor(page, { username, password });
    await page.goto(`/vendors/${vendorId}`);
    const card = page.getByTestId("vendor-managed-subcontractors-card");
    await expect(card).toBeVisible();
    await card
      .getByLabel("Subcontractor business name")
      .fill(`Example Staffing ${stamp}`);
    await card
      .getByRole("button", { name: "Create subcontractor", exact: true })
      .click();
    await expect(
      card.getByRole("heading", {
        name: `Example Staffing ${stamp}`,
        exact: true,
      }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Add worker", exact: true }).click();
    await card.getByLabel("Worker name").fill("Example Gate Worker");
    await card
      .getByLabel("Worker email")
      .fill(`managed-worker-${stamp}@example.invalid`);
    await card.getByLabel(siteName, { exact: true }).check();
    await card
      .getByRole("button", { name: "Save worker access", exact: true })
      .click();
    await expect(
      card.getByText("Example Gate Worker", { exact: true }),
    ).toBeVisible();
    const activationUrl = new URL(
      await card.getByLabel("Worker activation link").inputValue(),
    );
    const workerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    const workerPage = await workerContext.newPage();
    const invitationStatus = await workerPage.request.get(
      `/api/implementation-a/account-invitations/activate/${activationUrl.searchParams.get("token")}`,
    );
    expect(invitationStatus.status()).toBe(200);
    expect((await invitationStatus.json()).state).toBe("pending");
    await workerPage.goto(`${activationUrl.pathname}${activationUrl.search}`);
    await workerPage
      .getByLabel("Create password", { exact: true })
      .fill(password);
    await workerPage
      .getByLabel("Confirm password", { exact: true })
      .fill(password);
    await workerPage
      .getByLabel("Accept work participation authorization")
      .check();
    await workerPage
      .getByRole("button", { name: "Activate account", exact: true })
      .click();
    await expect(
      workerPage.getByRole("heading", { name: "Your account is ready" }),
    ).toBeVisible();
    await login(workerPage, {
      username: `managed-worker-${stamp}@example.invalid`,
      password,
    });
    const assigned = await workerPage.request.get(
      "/api/visits/gate/assigned-sites",
    );
    expect(assigned.ok()).toBe(true);
    expect(JSON.stringify(await assigned.json())).toContain(siteName);
    await expect(
      workerPage.getByRole("link", { name: "Work Hub", exact: true }).first(),
    ).toBeVisible();
    await workerPage
      .getByRole("link", { name: "Work Hub", exact: true })
      .first()
      .click();
    expect((await workerPage.request.get("/api/work-hub/home")).ok()).toBe(
      true,
    );
    await page.reload();
    await expect(
      card.getByText("Example Gate Worker", { exact: true }),
    ).toBeVisible();
    await card
      .getByRole("button", { name: "Edit access", exact: true })
      .click();
    await card.getByLabel("Operational role").selectOption("gate_supervisor");
    await card
      .getByRole("button", { name: "Save worker access", exact: true })
      .click();
    await expect(card.getByText(/Gate Supervisor/).first()).toBeVisible();
    // Role changes invalidate the prior session; log in for the updated assignment.
    expect(
      (
        await workerPage.request.get("/api/visits/gate/assigned-sites")
      ).status(),
    ).toBe(401);
    await login(workerPage, {
      username: `managed-worker-${stamp}@example.invalid`,
      password,
    });
    await card.screenshot({
      path: testInfo.outputPath("managed-subcontractors.png"),
    });
    await card
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Confirm revoke", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Edit access", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByText("Example Gate Worker", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await workerPage.request.get("/api/visits/gate/assigned-sites")
      ).status(),
    ).toBe(401);
    await workerContext.close();
    const result = await pool.query(
      "SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id WHERE vp.vendor_id=$1 AND u.email=$2",
      [vendorId, `managed-worker-${stamp}@example.invalid`],
    );
    expect(result.rowCount).toBe(0);
  });
});
