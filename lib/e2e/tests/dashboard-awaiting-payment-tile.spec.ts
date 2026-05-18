import { test, expect, type Page } from "@playwright/test";
import type pg from "pg";
import { login } from "../helpers/auth";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createPartner,
  createSiteLocation,
  createTicket,
  createUser,
  createUserOrgMembership,
  createVendor,
  createWorkType,
  setActiveMembership,
} from "../helpers/fixtures";

// Task #866 — End-to-end browser test for the partner-only "Awaiting
// payment" dashboard tile (artifacts/vndrly/src/pages/dashboard.tsx) and
// its deep-link into the Tickets list filtered to status='approved' AND
// paymentDispersedAt IS NULL (artifacts/api-server/src/routes/tickets.ts
// + artifacts/vndrly/src/pages/tickets.tsx).
//
// The tile is fed by GET /dashboard/awaiting-payment which counts and
// sums approved-but-not-yet-dispersed tickets for the partner's sites
// (artifacts/api-server/src/routes/dashboard.ts). Earlier tasks (#505,
// #497, #583) covered the route, the ISO-week dedupe of the AP weekly
// digest, and the rate-limit boot behaviour with unit tests, but no
// browser test verified that:
//   - the tile actually renders for a partner session,
//   - the count / total / oldest-age values reflect the seeded ticket,
//   - clicking the tile navigates to /tickets?awaitingPayment=true,
//   - the AP toggle on the tickets page is active on first paint
//     (Task #866 added URL→state seeding so the deep-link works without
//     a manual click), so the filtered list is what AP staff actually
//     land on.
//
// Servers: this spec re-uses the dev workflows (api-server on :8080,
// vndrly web on :23539) auto-started by the playwright config, with the
// same DATABASE_URL the api-server is using. Per-run fixtures use a
// timestamp-prefixed stamp so re-runs on a shared dev DB don't collide.

const PARTNER_PASSWORD = "e2e-partner-866-pwd";

// Two line items so the SQL-side SUM is a non-trivial value the assertion
// can pin to a specific dollar figure (200 + 100 = 300.00).
const LINE_ITEM_QTY_A = "2";
const LINE_ITEM_PRICE_A = "100.00";
const LINE_ITEM_QTY_B = "1";
const LINE_ITEM_PRICE_B = "100.00";
const EXPECTED_TOTAL_USD = "$300.00";

// Backdate the approved_at so the "Oldest waiting" pill renders with a
// concrete day count (the dashboard floors `(now - approvedAt) / day` to
// at least 1 day). 5 days is far enough that timezone math can't push
// it back to 4 or forward to 6 across the test window.
const APPROVED_DAYS_AGO = 5;

type Seed = {
  stamp: string;
  partnerId: number;
  vendorId: number;
  workTypeId: number;
  siteId: number;
  partnerUserId: number;
  partnerUsername: string;
  partnerMembershipId: number;
  ticketId: number;
  // A second ticket on the same partner that has already been
  // dispersed. It must NOT appear in the AP-filtered list — that's how
  // we prove the URL deep-link actually engaged the AP filter on the
  // tickets page rather than just opening an unfiltered list that
  // happens to contain our AP-eligible row.
  dispersedTicketId: number;
};

let pool: pg.Pool;
let seed: Seed;

test.beforeAll(async () => {
  pool = createPool();

  const stamp = makeStamp();
  const siteCode = `E866${stamp.toUpperCase()}`.slice(0, 16);

  const partner = await createPartner(pool, {
    name: `E866 Partner ${stamp}`,
    contactName: "E866 Contact",
    contactEmail: `e866-partner-${stamp}@example.com`,
  });
  const vendor = await createVendor(pool, {
    name: `E866 Vendor ${stamp}`,
    contactName: "E866 Vendor Contact",
    contactEmail: `e866-vendor-${stamp}@example.com`,
  });
  const workType = await createWorkType(pool, {
    name: `E866 Work Type ${stamp}`,
    category: "general",
  });
  const site = await createSiteLocation(pool, {
    partnerId: partner.id,
    name: `E866 Site ${stamp}`,
    address: "1 AP Way",
    latitude: 40.0,
    longitude: -74.0,
    siteCode,
    siteRadiusMeters: 150,
  });

  // Per-run partner login + membership. We deliberately do NOT log in
  // as a canonical demo partner (mach / exxon) — those are shared,
  // well-known logins and the tile / filter values would race against
  // any other ticket activity already present in their dashboards.
  // A scoped per-run partner sees exactly one ticket: the AP-eligible
  // one we seed below.
  const partnerUsername = `e866-partner-${stamp}@example.com`;
  const partnerUser = await createUser(pool, {
    username: partnerUsername,
    passwordHash: hashPassword(PARTNER_PASSWORD),
    role: "partner",
    displayName: `E866 Partner Admin ${stamp}`,
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

  // The AP-eligible ticket: status='approved' AND payment_dispersed_at
  // IS NULL. createTicket(...) sets the description / intake_channel
  // up-front; we backfill approved_at + line items with explicit SQL
  // because those columns are not part of the shared helper signature.
  const ticket = await createTicket(pool, {
    siteLocationId: site.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    status: "approved",
    intakeChannel: "partner_self_service",
    description: `E866 AP-eligible ticket ${stamp}`,
  });
  await pool.query(
    `UPDATE tickets SET approved_at = now() - ($1 || ' days')::interval WHERE id = $2`,
    [APPROVED_DAYS_AGO, ticket.id],
  );
  await pool.query(
    `INSERT INTO ticket_line_items (ticket_id, type, description, quantity, unit_price)
     VALUES ($1, 'labor', 'E866 line A', $2, $3),
            ($1, 'labor', 'E866 line B', $4, $5)`,
    [
      ticket.id,
      LINE_ITEM_QTY_A,
      LINE_ITEM_PRICE_A,
      LINE_ITEM_QTY_B,
      LINE_ITEM_PRICE_B,
    ],
  );

  // Negative-control ticket: same partner, status='funds_dispersed'
  // with a non-null payment_dispersed_at. Both the dashboard tile
  // roll-up and the /tickets?awaitingPayment=true filter must skip it.
  const dispersed = await createTicket(pool, {
    siteLocationId: site.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    status: "funds_dispersed",
    intakeChannel: "partner_self_service",
    description: `E866 already-paid ticket ${stamp}`,
  });
  await pool.query(
    `UPDATE tickets
        SET approved_at = now() - interval '7 days',
            payment_dispersed_at = now() - interval '1 day'
      WHERE id = $1`,
    [dispersed.id],
  );

  seed = {
    stamp,
    partnerId: partner.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    siteId: site.id,
    partnerUserId: partnerUser.id,
    partnerUsername,
    partnerMembershipId: partnerMembership.id,
    ticketId: ticket.id,
    dispersedTicketId: dispersed.id,
  };
});

test.afterAll(async () => {
  if (!seed) {
    await pool?.end();
    return;
  }
  // FK-safe cleanup. ticket_line_items has ON DELETE CASCADE from tickets,
  // user_org_memberships has ON DELETE CASCADE from partners, and tickets
  // FK back to site_locations + work_types + vendors so we delete in the
  // child→parent order.
  await pool.query(`DELETE FROM tickets WHERE id = ANY($1::int[])`, [
    [seed.ticketId, seed.dispersedTicketId],
  ]);
  await pool.query(`DELETE FROM site_locations WHERE id = $1`, [seed.siteId]);
  await pool.query(`DELETE FROM work_types WHERE id = $1`, [seed.workTypeId]);
  await pool.query(`DELETE FROM vendors WHERE id = $1`, [seed.vendorId]);
  await pool.query(`DELETE FROM partners WHERE id = $1`, [seed.partnerId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [seed.partnerUserId]);
  await pool.end();
});

async function loginAsPartner(page: Page): Promise<void> {
  await login(page, {
    username: seed.partnerUsername,
    password: PARTNER_PASSWORD,
  });
}

test("partner dashboard tile shows AP roll-up and deep-links into the filtered queue", async ({
  page,
}) => {
  await loginAsPartner(page);

  // Land on the dashboard. The shared login helper waits for the SPA to
  // navigate away from /login; the partner role's default landing page
  // is "/" which renders dashboard.tsx.
  await page.goto("/");

  const tile = page.locator('[data-testid="card-awaiting-payment"]');
  await expect(tile).toBeVisible();

  // Count, total, and oldest-age all derive from the single seeded
  // ticket. Pinning each one separately is what catches regressions in
  // the SQL roll-up (count vs sum vs min(approvedAt)) and in the
  // i18n keys that render them.
  await expect(
    page.locator('[data-testid="text-awaiting-payment-count"]'),
  ).toHaveText("1");
  await expect(
    page.locator('[data-testid="text-awaiting-payment-total"]'),
  ).toHaveText(EXPECTED_TOTAL_USD);
  await expect(
    page.locator('[data-testid="text-awaiting-payment-oldest"]'),
  ).toContainText(`${APPROVED_DAYS_AGO} days`);

  // The empty-state copy must NOT be rendered while we have a row.
  await expect(
    page.locator('[data-testid="text-awaiting-payment-empty"]'),
  ).toHaveCount(0);

  // Click the tile → navigation to /tickets?awaitingPayment=true.
  await page.locator('[data-testid="link-dashboard-awaiting-payment"]').click();
  await page.waitForURL(/\/tickets\?awaitingPayment=true/);

  // Task #866 — the tickets page reads ?awaitingPayment=true on mount
  // and seeds its toggle on, so the filter is applied without a manual
  // click. The partner-only AP toggle must be rendered, and the
  // resulting list must include the AP-eligible ticket while excluding
  // the negative-control already-dispersed ticket. The exclusion is the
  // strongest signal that the URL state actually engaged the AP filter
  // — without the filter, an unfiltered partner list would show both.
  await expect(
    page.locator('[data-testid="toggle-awaiting-payment"]'),
  ).toBeVisible();
  await expect(
    page.locator(`[data-testid="row-ticket-${seed.ticketId}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`[data-testid="row-ticket-${seed.dispersedTicketId}"]`),
  ).toHaveCount(0);
});
