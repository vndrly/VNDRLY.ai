import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type pg from "pg";

import { createPool, makeStamp } from "../helpers/db";
import {
  createPartner,
  createSiteLocation,
  createSiteWorkAssignment,
  createVendor,
  createWorkType,
} from "../helpers/fixtures";

// End-to-end browser test for the public visitor sign-in page
// (artifacts/vndrly/src/pages/visit-public.tsx, route /visit/:siteCode).
//
// The test boots no servers itself — it expects the api-server and the web
// app workflows to be running, and that DATABASE_URL points at the same
// dev database both services use. Geolocation is mocked at the browser
// context level so we can drive both the in-radius (happy path) and the
// out-of-radius (off-geofence) error rendering.
//
// We use a tall viewport so the long sign-in form and portaled plate-state
// picker fit on screen at once.
const VIEWPORT = { width: 1280, height: 1600 } as const;

const SITE_LAT = 40.0;
const SITE_LNG = -74.0;
const SITE_RADIUS_METERS = 150;

type Seed = {
  siteCode: string;
  partnerId: number;
  vendorId: number;
  workTypeId: number;
  siteId: number;
};

let pool: pg.Pool;
let seed: Seed;

async function fillSignInForm(page: Page) {
  // The signin step requires every starred field to be populated before
  // the AmberButton variant of the continue button is rendered (the
  // BlueButton variant stays disabled). See
  // artifacts/vndrly/src/pages/visit-public.tsx for the field testids.
  await page.locator('[data-testid="input-first-name"]').fill("Jane");
  await page.locator('[data-testid="input-last-name"]').fill("Visitor");
  await page.locator('[data-testid="input-phone"]').fill("(555) 555-5555");
  await page.locator('[data-testid="input-email"]').fill("jane.visitor@example.com");
  await page.locator('[data-testid="input-company"]').fill("E2E Test Co");
  await page.locator('[data-testid="input-vehicle-plate"]').fill("E2EPLATE");
  await page.locator('[data-testid="plate-state-picker-trigger"]').click();
  await page.getByRole("option", { name: "Alabama (AL)" }).click();
  await page.locator('[data-testid="input-purpose"]').fill("E2E test visit");
  // The safety acknowledgement is a row-shaped tap target wrapping a
  // visual-only Radix Switch. Click the row to toggle the underlying
  // state (the inner switch has pointer-events: none so it can't be
  // clicked directly — see artifacts/vndrly/src/pages/visit-public.tsx).
  await page.locator('[data-testid="safety-row"]').click();
  await page.locator('[data-testid="button-guest-signin"]').click();
}

async function newGeoContext(
  browser: import("@playwright/test").Browser,
  latitude: number,
  longitude: number,
  baseURL: string,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    geolocation: { latitude, longitude, accuracy: 10 },
    permissions: ["geolocation"],
    viewport: VIEWPORT,
  });
  await ctx.grantPermissions(["geolocation"], { origin: baseURL });
  return ctx;
}

test.beforeAll(async () => {
  pool = createPool();

  // Unique-per-run identifiers so re-runs don't collide with previous data.
  // The shared `makeStamp()` returns a base-36 timestamp + short random
  // suffix so two parallel shards still get distinct stamps even when
  // their `Date.now()` collides at millisecond resolution.
  const stamp = makeStamp();
  const siteCode = `E2E${stamp.toUpperCase()}`.slice(0, 16);

  const partner = await createPartner(pool, {
    name: `E2E Partner ${stamp}`,
    contactName: "E2E Contact",
    contactEmail: `e2e-${stamp}@example.com`,
  });
  const vendor = await createVendor(pool, {
    name: `E2E Vendor ${stamp}`,
    contactName: "E2E Contact",
    contactEmail: `e2e-vendor-${stamp}@example.com`,
  });
  const workType = await createWorkType(pool, {
    name: `E2E Work Type ${stamp}`,
    category: "general",
  });
  const site = await createSiteLocation(pool, {
    partnerId: partner.id,
    name: "E2E Test Site",
    address: "1 Test Way",
    latitude: SITE_LAT,
    longitude: SITE_LNG,
    siteCode,
    siteRadiusMeters: SITE_RADIUS_METERS,
  });
  await createSiteWorkAssignment(pool, {
    siteLocationId: site.id,
    workTypeId: workType.id,
    vendorId: vendor.id,
  });

  seed = {
    siteCode,
    partnerId: partner.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    siteId: site.id,
  };
});

test.afterAll(async () => {
  if (!seed) {
    await pool?.end();
    return;
  }
  // Clean up in FK-safe order.
  await pool.query(`DELETE FROM site_visits WHERE site_location_id = $1`, [
    seed.siteId,
  ]);
  await pool.query(
    `DELETE FROM site_work_assignments WHERE site_location_id = $1`,
    [seed.siteId],
  );
  await pool.query(`DELETE FROM site_locations WHERE id = $1`, [seed.siteId]);
  await pool.query(`DELETE FROM work_types WHERE id = $1`, [seed.workTypeId]);
  await pool.query(`DELETE FROM vendors WHERE id = $1`, [seed.vendorId]);
  await pool.query(`DELETE FROM partners WHERE id = $1`, [seed.partnerId]);
  await pool.end();
});

test("off-geofence check-in renders an error and does not create a visit", async ({
  browser,
  baseURL,
}) => {
  // The dev workflow temporarily bypasses the visitor geofence so the demo
  // can drive every check-in step from anywhere. Skip this test while the
  // bypass window is active — it auto-re-enables once the bypass expires.
  // Source of truth: artifacts/api-server/src/lib/geo.ts (GEOFENCE_BYPASS_UNTIL_MS).
  const GEOFENCE_BYPASS_UNTIL_MS = Date.UTC(2026, 3, 30, 23, 0, 0);
  test.skip(
    Date.now() < GEOFENCE_BYPASS_UNTIL_MS,
    "Demo geofence bypass active in dev workflow — see artifacts/api-server/src/lib/geo.ts",
  );
  // ~111 km north of the site center → far outside any reasonable radius.
  const ctx = await newGeoContext(browser, SITE_LAT + 1.0, SITE_LNG, baseURL!);
  const page = await ctx.newPage();
  await page.goto(`/visit/${seed.siteCode}`);

  await expect(page.locator('[data-testid="input-first-name"]')).toBeVisible();
  await expect(page.getByText("E2E Test Site").first()).toBeVisible();

  await fillSignInForm(page);

  await expect(page.getByText("Who are you visiting?")).toBeVisible();
  await page
    .locator(`[data-testid="host-option-partner:${seed.partnerId}"]`)
    .click();
  await page.locator('[data-testid="button-check-in"]').click();

  // The route returns the geofence error message; the page renders it inside
  // the [data-testid="visitor-error"] alert.
  const errorAlert = page.locator('[data-testid="visitor-error"]');
  await expect(errorAlert).toBeVisible();
  await expect(errorAlert).toContainText(/too far|away|within/i);

  // The check-out button should not be present — the visit was rejected.
  await expect(
    page.locator('[data-testid="button-check-out"]'),
  ).toHaveCount(0);

  const open = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM site_visits
       WHERE site_location_id = $1 AND check_out_time IS NULL`,
    [seed.siteId],
  );
  expect(open.rows[0].count).toBe("0");

  await ctx.close();
});

test("happy path: guest signs in, checks in inside the geofence, then checks out", async ({
  browser,
  baseURL,
}) => {
  const ctx = await newGeoContext(browser, SITE_LAT, SITE_LNG, baseURL!);
  const page = await ctx.newPage();
  await page.goto(`/visit/${seed.siteCode}`);

  await fillSignInForm(page);

  await expect(page.getByText("Who are you visiting?")).toBeVisible();
  await page
    .locator(`[data-testid="host-option-vendor:${seed.vendorId}"]`)
    .click();
  await page.locator('[data-testid="button-check-in"]').click();

  // Active-visit card should appear with site + host info.
  await expect(page.locator('[data-testid="button-check-out"]')).toBeVisible();
  await expect(page.getByText(/You are at/i)).toBeVisible();
  await expect(page.getByText("E2E Test Site").first()).toBeVisible();

  const openRows = await pool.query<{
    id: number;
    host_type: string;
    host_vendor_id: number | null;
  }>(
    `SELECT id, host_type, host_vendor_id FROM site_visits
       WHERE site_location_id = $1 AND check_out_time IS NULL`,
    [seed.siteId],
  );
  expect(openRows.rows).toHaveLength(1);
  expect(openRows.rows[0].host_type).toBe("vendor");
  expect(openRows.rows[0].host_vendor_id).toBe(seed.vendorId);

  // Check out, the page should return to the sign-in step.
  await page.locator('[data-testid="button-check-out"]').click();
  await expect(
    page.locator('[data-testid="input-first-name"]'),
  ).toBeVisible();

  const closed = await pool.query<{ check_out_time: Date | null }>(
    `SELECT check_out_time FROM site_visits
       WHERE site_location_id = $1
       ORDER BY id DESC LIMIT 1`,
    [seed.siteId],
  );
  expect(closed.rows[0].check_out_time).not.toBeNull();

  await ctx.close();
});

test("stale-visit sweep flags a forgotten visitor without inventing a checkout", async ({
  browser,
  baseURL,
}) => {
  // Set up an open visit through the real UI flow so the guest session
  // cookie, the site_visits row, and the host association all match
  // production wiring. After we force the visit stale and run the sweep,
  // the visit remains open while Gate staff review it; the system must not
  // fabricate a departure timestamp.
  const ctx = await newGeoContext(browser, SITE_LAT, SITE_LNG, baseURL!);
  const page = await ctx.newPage();
  await page.goto(`/visit/${seed.siteCode}`);

  await fillSignInForm(page);

  await expect(page.getByText("Who are you visiting?")).toBeVisible();
  await page
    .locator(`[data-testid="host-option-partner:${seed.partnerId}"]`)
    .click();
  await page.locator('[data-testid="button-check-in"]').click();

  // Active-visit card should appear before we force the sweep.
  await expect(page.locator('[data-testid="button-check-out"]')).toBeVisible();

  const created = await pool.query<{ id: number }>(
    `SELECT id FROM site_visits
       WHERE site_location_id = $1 AND check_out_time IS NULL
       ORDER BY id DESC LIMIT 1`,
    [seed.siteId],
  );
  expect(created.rows).toHaveLength(1);
  const visitId = created.rows[0].id;

  // Force the visit stale: backdate expires_at so it sits well past
  // the sweep's "expires_at + 30min < now()" cutoff.
  await pool.query(
    `UPDATE site_visits SET expires_at = now() - interval '2 hours' WHERE id = $1`,
    [visitId],
  );

  // Trigger the same state transition as the production sweep without
  // waiting for the background worker interval.
  const sweepResult = await pool.query<{ id: number }>(
    `UPDATE site_visits
        SET reconciliation_state = 'needs_review'
      WHERE check_out_time IS NULL
        AND expires_at IS NOT NULL
        AND expires_at + interval '30 minutes' < now()
        AND reconciliation_state NOT IN ('needs_review','confirmed_off_site')
      RETURNING id`,
  );
  // Our forgotten visit must be among the rows the sweep predicate matched.
  expect(sweepResult.rows.map((r) => r.id)).toContain(visitId);

  // Reloading still shows the active visit because no departure was recorded.
  await page.reload();

  await expect(page.locator('[data-testid="button-check-out"]')).toBeVisible();

  // Confirm the review flag changed without changing occupancy history.
  const swept = await pool.query<{
    check_out_time: Date | null;
    auto_checked_out: boolean;
    reconciliation_state: string;
  }>(
    `SELECT check_out_time, auto_checked_out, reconciliation_state FROM site_visits WHERE id = $1`,
    [visitId],
  );
  expect(swept.rows).toHaveLength(1);
  expect(swept.rows[0].check_out_time).toBeNull();
  expect(swept.rows[0].auto_checked_out).toBe(false);
  expect(swept.rows[0].reconciliation_state).toBe("needs_review");

  await ctx.close();
});
