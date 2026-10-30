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
      isGateContractor: true,
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
    await page.goto("/field-employees");
    const card = page.getByTestId("managed-subcontractor-employees-section");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /^Vendor Managed/ }).click();
    await card.getByRole("button", { name: "Add Contractor", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Company name", { exact: true }).fill(`Example Staffing ${stamp}`);
    const companyCreated = page.waitForResponse(response => response.url().endsWith(`/api/vendors/${vendorId}/managed-subcontractors`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Add Contractor", exact: true }).click();
    const company = await (await companyCreated).json();
    await expect(card).toContainText(`Example Staffing ${stamp}`);
    await card.getByRole("button", { name: "Add Contract Employee", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Employee name", { exact: true }).fill("Example Gate Worker");
    await dialog.getByLabel("Email (optional)", { exact: true }).fill(`managed-worker-${stamp}@example.invalid`);
    await dialog.getByLabel("Send an enrollment invitation", { exact: true }).check();
    await dialog.getByLabel(siteName, { exact: true }).check();
    const workerCreated = page.waitForResponse(response => response.url().endsWith(`/api/vendors/${vendorId}/managed-subcontractors/${company.id}/workers`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Add Contract Employee", exact: true }).click();
    const worker = await (await workerCreated).json();
    await card.getByRole("button", { name: new RegExp(`Example Staffing ${stamp}`) }).click();
    await expect(card.getByText("Example Gate Worker", { exact: true })).toBeVisible();
    const activationUrl = new URL(worker.activationUrl);
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
      workerPage.getByRole("link", { name: "Go to Work Hub", exact: true }).first(),
    ).toBeVisible();
    await workerPage
      .getByRole("link", { name: "Go to Work Hub", exact: true })
      .first()
      .click();
    expect((await workerPage.request.get("/api/work-hub/home")).ok()).toBe(
      true,
    );
    await page.reload();
    await card.getByRole("button", { name: /^Vendor Managed/ }).click();
    await card.getByRole("button", { name: new RegExp(`Example Staffing ${stamp}`) }).click();
    await expect(
      card.getByText("Example Gate Worker", { exact: true }),
    ).toBeVisible();
    await card.getByText("Example Gate Worker", { exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Assigned role", { exact: true }).selectOption("gate_supervisor");
    await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(card.getByText("Gate Supervisor", { exact: true })).toBeVisible();
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
    const revoked = await page.request.patch(`/api/vendors/${vendorId}/managed-subcontractors/${company.id}/workers/${worker.id}`, { data: { status: "terminated" } });
    expect(revoked.ok()).toBeTruthy();
    await page.reload();
    await card.getByRole("button", { name: /^Vendor Managed/ }).click();
    await card.getByRole("button", { name: new RegExp(`Example Staffing ${stamp}`) }).click();
    await expect(card.getByText("Example Gate Worker", { exact: true })).toHaveCount(0);
    expect((await pool.query("select status from managed_subcontractor_worker_sponsorships where id=$1", [worker.id])).rows[0].status).toBe("terminated");
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
