import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { loginAsVendor } from "../helpers/auth";
import {
  createVendorActor,
  expectNoSecretFields,
} from "../helpers/implementation-a";

test("a vendor creates a paid managed worker while sponsorships stay private and claimable", async ({
  browser,
  page,
}) => {
  const pool = createPool();
  const stamp = makeStamp();
  const sponsor = await createVendorActor(pool, "MidCon Sponsor");
  const claimant = await createVendorActor(pool, "NewTek Claimant");
  const claimantContext = await browser.newContext();
  try {
    await loginAsVendor(page, sponsor);
    const organizationResponse = await page.request.post(
      "/api/implementation-a/managed-organizations",
      {
        data: { name: `NewTek ${stamp}` },
      },
    );
    expect(organizationResponse.status()).toBe(201);
    const organization = await organizationResponse.json();

    const subscriptionResponse = await page.request.post(
      "/api/implementation-a/subscriptions",
      {
        data: {
          email: `newtek-worker-${stamp}@example.invalid`,
          displayName: "NewTek Gatekeeper",
          managedOrganizationId: organization.id,
          authorizationVersion: "work-participation-2026-09",
          plan: "full_worker",
          monthlyPriceCents: 1299,
          renewalAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          previewAccess: false,
          confirmed: true,
        },
      },
    );
    expect(subscriptionResponse.status()).toBe(201);
    const created = await subscriptionResponse.json();
    expect(created.seat).toMatchObject({
      state: "active",
      plan: "full_worker",
      monthlyPriceCents: 1299,
    });
    expect(created.invitation).toMatchObject({ state: "pending" });
    expectNoSecretFields(created);

    const invitationRow = await pool.query<{
      token_hash: string;
      password_hash: string;
      worker_user_id: number;
    }>(
      `SELECT ai.token_hash, u.password_hash, ai.user_id AS worker_user_id
       FROM account_invitations ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.id = $1`,
      [created.invitation.id],
    );
    expect(invitationRow.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitationRow.rows[0].password_hash).not.toContain(
      "ImplementationAFixture",
    );
    const workerUserId = invitationRow.rows[0].worker_user_id;

    const secondPage = await claimantContext.newPage();
    await loginAsVendor(secondPage, claimant);
    const secondOrganizationResponse = await secondPage.request.post(
      "/api/implementation-a/managed-organizations",
      {
        data: { name: `NewTek Alternate Sponsor ${stamp}` },
      },
    );
    expect(secondOrganizationResponse.status()).toBe(201);
    const secondOrganization = await secondOrganizationResponse.json();
    expect(
      (
        await secondPage.request.post(
          `/api/implementation-a/managed-organizations/${secondOrganization.id}/workers`,
          { data: { workerUserId } },
        )
      ).status(),
    ).toBe(201);

    const firstVisible = await page.request.get(
      `/api/implementation-a/sponsorships?workerUserId=${workerUserId}`,
    );
    const secondVisible = await secondPage.request.get(
      `/api/implementation-a/sponsorships?workerUserId=${workerUserId}`,
    );
    expect(firstVisible.status()).toBe(200);
    expect(secondVisible.status()).toBe(200);
    const firstRows = await firstVisible.json();
    const secondRows = await secondVisible.json();
    expect(firstRows).toHaveLength(1);
    expect(secondRows).toHaveLength(1);
    expect(firstRows[0].sponsorVendorId).toBe(sponsor.vendorId);
    expect(secondRows[0].sponsorVendorId).toBe(claimant.vendorId);

    const claim = await secondPage.request.post(
      `/api/implementation-a/managed-organizations/${organization.id}/claim`,
      { data: { representativeUserId: claimant.userId } },
    );
    expect(claim.status()).toBe(200);
    expect((await claim.json()).claimedVendorId).toBe(claimant.vendorId);
    const preserved = await pool.query(
      "SELECT 1 FROM managed_subcontractor_worker_sponsorships WHERE worker_user_id=$1 AND managed_organization_id=$2",
      [workerUserId, organization.id],
    );
    expect(preserved.rowCount).toBe(1);
  } finally {
    await claimantContext.close();
    await pool.end();
  }
});
