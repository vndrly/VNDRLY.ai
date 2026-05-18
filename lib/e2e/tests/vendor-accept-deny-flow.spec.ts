import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type pg from "pg";

import { login as sharedLogin, loginAsVendor as sharedLoginAsVendor } from "../helpers/auth";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createPartner,
  createSiteLocation,
  createSiteWorkAssignment,
  createUser,
  createUserOrgMembership,
  createVendor,
  createVendorPerson,
  createWorkType,
  setActiveMembership,
} from "../helpers/fixtures";

// End-to-end browser test for Task #499 (round-trip coverage of the
// Task #494 vendor accept/deny handshake). The unit harness in
// artifacts/api-server/src/routes/tickets-vendor-handshake.test.ts
// already covers the route guards (radius math, authz, status
// preconditions, deny-reason validation) against a mocked DB. What
// only this spec can prove is that the whole round trip is wired
// end-to-end:
//
//   Test #1 — happy path
//     1. Partner creates a partner-self-service ticket via
//        POST /api/tickets (cookies provisioned via /auth/login).
//        We drive this step through the API rather than the partner UI
//        because partner-side ticket creation has no dedicated form on
//        /tickets — partners use the same Create-New-Job affordance
//        that admins/vendors use, and what we actually want to verify
//        here is the **vendor's** view of the resulting invite, not
//        the partner's create dialog.
//     2. Vendor #1 logs in through the UI, navigates to /tickets/:id,
//        and we assert the `vendor-invite-banner` renders with both
//        Accept and Deny actions.
//     3. Vendor clicks Accept; we confirm the DB transitions
//        awaiting_acceptance → initiated.
//     4. Admin drives /check-in (in_progress) and /submit (submitted)
//        via the API to complete the through-line. Doing the last
//        two steps via the API keeps the test focused on the new
//        accept/deny gate without re-exercising the (heavily covered)
//        check-in UI and the (separately covered) line-item Submit UI.
//
//   Test #2 — deny → reinvite → second vendor sees the banner
//     1. Same partner-self-service ticket creation.
//     2. Vendor #1 logs in, opens the deny dialog, fills a reason,
//        submits; we confirm the DB row transitioned to `denied`.
//     3. Partner logs in through the UI, navigates to /tickets/:id,
//        and we assert the `partner-invite-banner` renders with the
//        "find another vendor" CTA. Click it, the
//        `sheet-find-vendor` opens, vendor #2 appears as a row, and
//        we click `button-reinvite-{vendor2.id}`.
//     4. Vendor #2 logs in; the same /tickets/:id URL now shows the
//        vendor-invite-banner addressed to them.
//
// Both tests boot no servers themselves — the playwright config wires
// up the api-server and the vndrly web app. DATABASE_URL must point at
// the same dev database both services use (matches the pattern in
// every other spec in this directory).

const VENDOR_PASSWORD = "e2epass123";
const PARTNER_PASSWORD = "e2epass123";

type Seed = {
  partnerId: number;
  partnerUserId: number;
  partnerUsername: string;
  partnerMembershipId: number;
  vendor1Id: number;
  vendor1UserId: number;
  vendor1Username: string;
  vendor1MembershipId: number;
  vendor1FieldEmployeeId: number;
  vendor2Id: number;
  vendor2UserId: number;
  vendor2Username: string;
  vendor2MembershipId: number;
  vendor2FieldEmployeeId: number;
  workTypeId: number;
  siteId: number;
  ticketIds: number[];
};

let pool: pg.Pool;
let seed: Seed;

async function loginAsPartner(page: Page, username: string): Promise<void> {
  await sharedLogin(page, { username, password: PARTNER_PASSWORD });
}

async function loginAsVendor(page: Page, username: string): Promise<void> {
  await sharedLoginAsVendor(page, { username, password: VENDOR_PASSWORD });
}

/**
 * Seed two vendors, one partner with a self-service-capable user, and a
 * site/work-type combo where both vendors are pre-approved.  Returning
 * the IDs lets each test create a fresh ticket on demand so per-test
 * status mutations don't bleed between tests.
 */
async function seedFixture(): Promise<Seed> {
  const stamp = makeStamp();
  const passwordHash = hashPassword(VENDOR_PASSWORD);

  const partner = await createPartner(pool, {
    name: `E499 Partner ${stamp}`,
    contactName: "E499 Partner Contact",
    contactEmail: `e499-partner-${stamp}@example.com`,
  });
  const vendor1 = await createVendor(pool, {
    name: `E499 Vendor One ${stamp}`,
    contactName: "E499 Vendor One Contact",
    contactEmail: `e499-vendor1-${stamp}@example.com`,
  });
  const vendor2 = await createVendor(pool, {
    name: `E499 Vendor Two ${stamp}`,
    contactName: "E499 Vendor Two Contact",
    contactEmail: `e499-vendor2-${stamp}@example.com`,
  });
  // Geocode both vendors at the same coordinates as the site and give
  // them a generous operating radius. The /tickets/:id/nearby-vendors
  // route filters out any vendor without latitude/longitude/
  // operating_radius_miles set, and only returns those whose published
  // operating radius covers the site distance — without these updates
  // neither vendor would surface in the FindAnotherVendorSheet picker.
  await pool.query(
    `UPDATE vendors
       SET latitude = $1, longitude = $2, operating_radius_miles = $3
     WHERE id = ANY($4)`,
    [40.0, -74.0, 100, [vendor1.id, vendor2.id]],
  );
  const workType = await createWorkType(pool, {
    name: `E499 Work Type ${stamp}`,
    category: "general",
  });
  const site = await createSiteLocation(pool, {
    partnerId: partner.id,
    name: `E499 Site ${stamp}`,
    address: "1 Handshake Way",
    latitude: 40.0,
    longitude: -74.0,
    siteCode: `E499${stamp.toUpperCase()}`.slice(0, 16),
    siteRadiusMeters: 200,
  });
  // Both vendors pre-approved at this site for this work type so the
  // ticket creation path doesn't trip the site_vendor_mismatch /
  // work_type_not_allowed guards, and so the nearby-vendors endpoint
  // surfaces vendor #2 as an "approved" alternative for the reinvite
  // sheet.
  await createSiteWorkAssignment(pool, {
    siteLocationId: site.id,
    workTypeId: workType.id,
    vendorId: vendor1.id,
  });
  await createSiteWorkAssignment(pool, {
    siteLocationId: site.id,
    workTypeId: workType.id,
    vendorId: vendor2.id,
  });

  // Partner user with a single membership pinned active so the
  // post-login org picker is skipped (matches the helper convention
  // used in deactivated-field-employee-pickers.spec.ts).
  const partnerUsername = `e499-partner-${stamp}@example.com`;
  const partnerUser = await createUser(pool, {
    username: partnerUsername,
    email: partnerUsername,
    passwordHash,
    role: "partner",
    displayName: `E499 Partner User ${stamp}`,
  });
  const partnerMembership = await createUserOrgMembership(pool, {
    userId: partnerUser.id,
    orgType: "partner",
    partnerId: partner.id,
    role: "admin",
  });
  await setActiveMembership(pool, {
    userId: partnerUser.id,
    membershipId: partnerMembership.id,
  });

  // Vendor #1 admin login — the recipient of the initial invite.
  const vendor1Username = `e499-vendor1-admin-${stamp}@example.com`;
  const vendor1User = await createUser(pool, {
    username: vendor1Username,
    email: vendor1Username,
    passwordHash,
    role: "vendor",
    displayName: `E499 Vendor One Admin ${stamp}`,
  });
  const vendor1Membership = await createUserOrgMembership(pool, {
    userId: vendor1User.id,
    orgType: "vendor",
    vendorId: vendor1.id,
    role: "admin",
  });
  await setActiveMembership(pool, {
    userId: vendor1User.id,
    membershipId: vendor1Membership.id,
  });
  // Active foreman on vendor #1 so the vendor-side ticket page can
  // render (some pickers depend on at least one active vendor_people
  // row existing on the vendor).
  const vendor1Fe = await createVendorPerson(pool, {
    vendorId: vendor1.id,
    vendorRole: "foreman",
    firstName: `E499V1FE`,
    lastName: stamp,
    email: `e499-vendor1-fe-${stamp}@example.com`,
    isActive: true,
  });

  // Vendor #2 admin login — the recipient after the partner
  // reinvites.  Same single-membership shape as vendor #1.
  const vendor2Username = `e499-vendor2-admin-${stamp}@example.com`;
  const vendor2User = await createUser(pool, {
    username: vendor2Username,
    email: vendor2Username,
    passwordHash,
    role: "vendor",
    displayName: `E499 Vendor Two Admin ${stamp}`,
  });
  const vendor2Membership = await createUserOrgMembership(pool, {
    userId: vendor2User.id,
    orgType: "vendor",
    vendorId: vendor2.id,
    role: "admin",
  });
  await setActiveMembership(pool, {
    userId: vendor2User.id,
    membershipId: vendor2Membership.id,
  });
  const vendor2Fe = await createVendorPerson(pool, {
    vendorId: vendor2.id,
    vendorRole: "foreman",
    firstName: `E499V2FE`,
    lastName: stamp,
    email: `e499-vendor2-fe-${stamp}@example.com`,
    isActive: true,
  });

  return {
    partnerId: partner.id,
    partnerUserId: partnerUser.id,
    partnerUsername,
    partnerMembershipId: partnerMembership.id,
    vendor1Id: vendor1.id,
    vendor1UserId: vendor1User.id,
    vendor1Username,
    vendor1MembershipId: vendor1Membership.id,
    vendor1FieldEmployeeId: vendor1Fe.id,
    vendor2Id: vendor2.id,
    vendor2UserId: vendor2User.id,
    vendor2Username,
    vendor2MembershipId: vendor2Membership.id,
    vendor2FieldEmployeeId: vendor2Fe.id,
    workTypeId: workType.id,
    siteId: site.id,
    ticketIds: [],
  };
}

/**
 * Spin up a standalone APIRequestContext, log in as the given user,
 * and return it. We use these for partner-side POST /api/tickets and
 * the admin-side check-in / submit calls so the spec doesn't have to
 * detour through UI flows that are already covered elsewhere. The
 * caller MUST `dispose()` it when done.
 */
async function createAuthedRequest(
  baseURL: string,
  username: string,
  password: string,
): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login", {
    data: { username, password },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "<unreadable>");
    await ctx.dispose();
    throw new Error(
      `Login as ${username} failed: ${res.status()} ${res.statusText()} ${body}`,
    );
  }
  return ctx;
}

/**
 * Create a partner-self-service ticket as the partner user. Returns
 * the new ticket id and registers it with the seed for cleanup.
 */
async function createPartnerSelfServiceTicket(
  baseURL: string,
  desc: string,
): Promise<number> {
  const partnerCtx = await createAuthedRequest(
    baseURL,
    seed.partnerUsername,
    PARTNER_PASSWORD,
  );
  try {
    const res = await partnerCtx.post("/api/tickets", {
      data: {
        siteLocationId: seed.siteId,
        vendorId: seed.vendor1Id,
        workTypeId: seed.workTypeId,
        description: desc,
        // Partner role => intake_channel resolves to partner_self_service
        // by default; no need to set it explicitly. computeInitialStatus
        // then lands the ticket on `awaiting_acceptance`.
      },
    });
    if (!res.ok()) {
      const body = await res.text().catch(() => "<unreadable>");
      throw new Error(
        `POST /api/tickets failed: ${res.status()} ${res.statusText()} ${body}`,
      );
    }
    const json = (await res.json()) as { id: number; status: string };
    if (json.status !== "awaiting_acceptance") {
      throw new Error(
        `Expected new ticket to land on awaiting_acceptance; got ${json.status}`,
      );
    }
    seed.ticketIds.push(json.id);
    return json.id;
  } finally {
    await partnerCtx.dispose();
  }
}

async function ticketStatus(ticketId: number): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM tickets WHERE id = $1`,
    [ticketId],
  );
  if (rows.length === 0) throw new Error(`Ticket ${ticketId} not found`);
  return rows[0].status;
}

async function ticketVendorId(ticketId: number): Promise<number> {
  const { rows } = await pool.query<{ vendor_id: number }>(
    `SELECT vendor_id FROM tickets WHERE id = $1`,
    [ticketId],
  );
  if (rows.length === 0) throw new Error(`Ticket ${ticketId} not found`);
  return rows[0].vendor_id;
}

test.describe.serial("Task #499 — vendor accept/deny round-trip", () => {
  test.beforeAll(async () => {
    pool = createPool();
    seed = await seedFixture();
  });

  test.afterAll(async () => {
    if (!seed) {
      await pool?.end();
      return;
    }
    try {
      // FK-safe cleanup. Most ticket-child tables cascade
      // (ticket_check_ins, ticket_status_history, ticket_line_items,
      // ticket_unlocks, ticket_crew, ticket_notifications,
      // ticket_note_logs, ticket_scheduled_notifications,
      // invoice_ticket_links). The two that do NOT cascade are
      // gps_logs and ticket_assignment_rates — the partner ticket
      // creation + admin check-in path writes a gps_logs row, so we
      // drop those manually before the parent ticket rows.
      if (seed.ticketIds.length) {
        await pool.query(`DELETE FROM gps_logs WHERE ticket_id = ANY($1)`, [
          seed.ticketIds,
        ]);
        await pool.query(
          `DELETE FROM ticket_assignment_rates WHERE ticket_id = ANY($1)`,
          [seed.ticketIds],
        );
        await pool.query(`DELETE FROM tickets WHERE id = ANY($1)`, [
          seed.ticketIds,
        ]);
      }
      await pool.query(
        `DELETE FROM site_work_assignments WHERE site_location_id = $1`,
        [seed.siteId],
      );
      await pool.query(`DELETE FROM site_locations WHERE id = $1`, [
        seed.siteId,
      ]);
      await pool.query(`DELETE FROM vendor_people WHERE id IN ($1, $2)`, [
        seed.vendor1FieldEmployeeId,
        seed.vendor2FieldEmployeeId,
      ]);
      await pool.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [
        seed.partnerUserId,
        seed.vendor1UserId,
        seed.vendor2UserId,
      ]);
      await pool.query(`DELETE FROM work_types WHERE id = $1`, [
        seed.workTypeId,
      ]);
      await pool.query(`DELETE FROM vendors WHERE id IN ($1, $2)`, [
        seed.vendor1Id,
        seed.vendor2Id,
      ]);
      await pool.query(`DELETE FROM partners WHERE id = $1`, [seed.partnerId]);
    } catch (e) {
      console.error("E499 cleanup failed:", e);
    }
    await pool?.end();
  });

  test("happy path: partner→awaiting_acceptance→vendor accepts→check-in→submit", async ({
    page,
    baseURL,
  }) => {
    const ticketId = await createPartnerSelfServiceTicket(
      baseURL!,
      "E499 happy-path ticket",
    );

    // Sanity: the route landed the ticket on awaiting_acceptance,
    // pinned to vendor #1.
    expect(await ticketStatus(ticketId)).toBe("awaiting_acceptance");
    expect(await ticketVendorId(ticketId)).toBe(seed.vendor1Id);

    // Vendor #1 logs in through the UI and navigates to the ticket.
    await loginAsVendor(page, seed.vendor1Username);
    await page.goto(`/tickets/${ticketId}`);

    // The vendor invite banner renders with both actions wired up.
    const banner = page.locator('[data-testid="vendor-invite-banner"]');
    await expect(banner).toBeVisible();
    await expect(
      banner.locator('[data-testid="button-accept-invite"]'),
    ).toBeVisible();
    await expect(
      banner.locator('[data-testid="button-deny-invite"]'),
    ).toBeVisible();

    // The partner-side banner is suppressed for vendor viewers — the
    // two banners are mutually exclusive by role.
    await expect(
      page.locator('[data-testid="partner-invite-banner"]'),
    ).toHaveCount(0);

    // Click Accept; the banner should disappear once the mutation
    // resolves (the ticket is no longer awaiting_acceptance).
    await banner.locator('[data-testid="button-accept-invite"]').click();
    await expect(banner).toHaveCount(0, { timeout: 15_000 });

    // Server side: the ticket transitioned to `initiated`.
    expect(await ticketStatus(ticketId)).toBe("initiated");

    // Drive check-in and submit through the admin API.  We do these
    // via the API instead of the UI on purpose:
    //   * /check-in: the vendor has no UI to drive their own
    //     check-in (that lives on the field-employee mobile screen).
    //     This spec exists to verify the new accept gate is wired
    //     through to the existing in-flight lifecycle, not to
    //     re-prove the mobile arrival flow.
    //   * /submit: the vendor's web "Submit" button is gated on
    //     having line items with grandTotal > 0; that's covered by
    //     the line-items specs and is orthogonal to the handshake.
    //
    // Together these two API calls demonstrate that the ticket can
    // walk all the way from awaiting_acceptance → initiated →
    // in_progress → submitted now that the accept gate is cleared,
    // which is what `Task #494` ensureAccepted() guards.
    const adminCtx = await createAuthedRequest(baseURL!, "admin", "admin123");
    try {
      const checkInRes = await adminCtx.post(
        `/api/tickets/${ticketId}/check-in`,
        { data: { latitude: 40.0, longitude: -74.0 } },
      );
      expect(
        checkInRes.ok(),
        `check-in failed: ${checkInRes.status()} ${await checkInRes.text().catch(() => "")}`,
      ).toBeTruthy();
      expect(await ticketStatus(ticketId)).toBe("in_progress");

      const submitRes = await adminCtx.post(`/api/tickets/${ticketId}/submit`);
      expect(
        submitRes.ok(),
        `submit failed: ${submitRes.status()} ${await submitRes.text().catch(() => "")}`,
      ).toBeTruthy();
      expect(await ticketStatus(ticketId)).toBe("submitted");
    } finally {
      await adminCtx.dispose();
    }
  });

  test("deny → partner reinvites → second vendor sees the banner", async ({
    page,
    baseURL,
  }) => {
    const ticketId = await createPartnerSelfServiceTicket(
      baseURL!,
      "E499 deny-reinvite ticket",
    );
    expect(await ticketStatus(ticketId)).toBe("awaiting_acceptance");
    expect(await ticketVendorId(ticketId)).toBe(seed.vendor1Id);

    // ── Step 1: Vendor #1 denies via the UI. ────────────────────────
    await loginAsVendor(page, seed.vendor1Username);
    await page.goto(`/tickets/${ticketId}`);

    const vendorBanner = page.locator('[data-testid="vendor-invite-banner"]');
    await expect(vendorBanner).toBeVisible();
    await vendorBanner.locator('[data-testid="button-deny-invite"]').click();

    // The deny dialog opens with the reason textarea.
    const denyReason = page.locator('[data-testid="input-deny-reason"]');
    await expect(denyReason).toBeVisible();
    await denyReason.fill("E499 e2e: not available, please reinvite");
    await page.locator('[data-testid="button-submit-deny"]').click();

    // Banner disappears once the deny mutation resolves.
    await expect(vendorBanner).toHaveCount(0, { timeout: 15_000 });
    expect(await ticketStatus(ticketId)).toBe("denied");

    // ── Step 2: Partner opens the "find another vendor" picker. ─────
    // Re-use the same page — Playwright's auth helper drops us at
    // /login when the cookie is replaced, so we explicitly clear the
    // browser context to make the partner login deterministic.
    await page.context().clearCookies();
    await loginAsPartner(page, seed.partnerUsername);
    await page.goto(`/tickets/${ticketId}`);

    const partnerBanner = page.locator('[data-testid="partner-invite-banner"]');
    await expect(partnerBanner).toBeVisible();
    // The vendor banner is suppressed for partner viewers.
    await expect(
      page.locator('[data-testid="vendor-invite-banner"]'),
    ).toHaveCount(0);

    await partnerBanner.locator('[data-testid="button-find-vendor"]').click();
    const sheet = page.locator('[data-testid="sheet-find-vendor"]');
    await expect(sheet).toBeVisible();

    // Vendor #2 must surface in the approved list (we seeded a
    // site_work_assignments row for it). We don't assert on its
    // distance — both vendors share the same site coords for fixture
    // simplicity, so the picker treats them as equally close.
    const vendor2Row = sheet.locator(
      `[data-testid="row-nearby-vendor-${seed.vendor2Id}"]`,
    );
    await expect(vendor2Row).toBeVisible();

    // Reinvite vendor #2.
    await sheet
      .locator(`[data-testid="button-reinvite-${seed.vendor2Id}"]`)
      .click();

    // The sheet auto-closes once the reinvite mutation resolves and
    // the partner banner re-renders against the new (awaiting_acceptance)
    // status pinned to vendor #2.
    await expect(sheet).toHaveCount(0, { timeout: 15_000 });
    expect(await ticketStatus(ticketId)).toBe("awaiting_acceptance");
    expect(await ticketVendorId(ticketId)).toBe(seed.vendor2Id);

    // ── Step 3: Vendor #2 sees the banner addressed to them. ────────
    await page.context().clearCookies();
    await loginAsVendor(page, seed.vendor2Username);
    await page.goto(`/tickets/${ticketId}`);

    const vendor2Banner = page.locator('[data-testid="vendor-invite-banner"]');
    await expect(vendor2Banner).toBeVisible();
    await expect(
      vendor2Banner.locator('[data-testid="button-accept-invite"]'),
    ).toBeVisible();
    await expect(
      vendor2Banner.locator('[data-testid="button-deny-invite"]'),
    ).toBeVisible();
  });
});
