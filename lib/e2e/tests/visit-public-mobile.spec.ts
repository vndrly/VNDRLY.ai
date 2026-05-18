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

// Mobile-viewport browser tests for the public visitor sign-in page
// (artifacts/vndrly/src/pages/visit-public.tsx, route /visit/:siteCode).
//
// task-69 (visit-public.spec.ts) already drives the happy and
// off-geofence flows at a tall desktop viewport so the long sign-in form
// + Radix Select popper all fit on screen. That's not what real visitors
// see — they hit this page from a phone after scanning a QR poster at
// the gate. This spec re-runs the sign-in / check-in / check-out flow at
// two common phone resolutions and asserts:
//
//   1. The page does not horizontally scroll (every row fits inside the
//      viewport's content width).
//   2. Every primary control on each step is visible without horizontal
//      scrolling.
//   3. The two primary tap targets that are easy to mis-tap on a small
//      screen — the safety acknowledgement row and the host options —
//      are at least the WCAG/Apple HIG-recommended 44 CSS pixels in
//      both dimensions.
//
// Geolocation is mocked at the browser context level so the in-radius
// check-in path always succeeds regardless of where the test machine is.

const VIEWPORTS = [
  { width: 360, height: 640, label: "360x640" },
  { width: 414, height: 896, label: "414x896" },
] as const;

// Apple HIG / WCAG 2.5.5 recommend at least 44 CSS px on the smallest
// dimension for touch targets. We use 44 (instead of Material's 48) to
// match the existing min-h-[44px] tokens in visit-public.tsx.
const MIN_TAP_PX = 44;

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

async function newMobileContext(
  browser: import("@playwright/test").Browser,
  baseURL: string,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    geolocation: { latitude: SITE_LAT, longitude: SITE_LNG, accuracy: 10 },
    permissions: ["geolocation"],
    viewport,
    // A reasonable mobile UA + DPR so the layout exercises the same media
    // queries a real phone would. We don't claim Safari specifically — the
    // app doesn't gate behavior on UA.
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await ctx.grantPermissions(["geolocation"], { origin: baseURL });
  return ctx;
}

async function fillSignInFormSmall(page: Page) {
  // Mirror visit-public.spec.ts's fillSignInForm but, on small screens,
  // scroll each control into view first so Playwright's actionability
  // checks don't trip over the absolutely-positioned page header that
  // covers the top ~240px of the viewport.
  const fields: Array<[string, string]> = [
    ['[data-testid="input-first-name"]', "Jane"],
    ['[data-testid="input-last-name"]', "Visitor"],
    ['[data-testid="input-phone"]', "(555) 555-5555"],
    ['[data-testid="input-email"]', "jane.visitor@example.com"],
    ['[data-testid="input-company"]', "Mobile Test Co"],
    ['[data-testid="input-vehicle-plate"]', "MOBPLATE"],
  ];
  for (const [sel, value] of fields) {
    const el = page.locator(sel);
    await el.scrollIntoViewIfNeeded();
    await el.fill(value);
  }
  const stateTrigger = page.locator('[data-testid="select-vehicle-state"]');
  await stateTrigger.scrollIntoViewIfNeeded();
  // The Radix Select popper portals into <body> and positions itself
  // relative to the trigger. On a short phone viewport, leaving the
  // trigger near the bottom can push the popper off-screen — scroll it
  // to the top of the viewport first so the option list has room below.
  await stateTrigger.evaluate((el) =>
    el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior }),
  );
  await stateTrigger.click();
  // Use keyboard navigation to pick AL — robust against any popper-
  // overflow quirk on tiny viewports, where mouse-clicking a portaled
  // option that renders just outside the visible area is unreliable.
  await page.keyboard.press("Enter");
  const purpose = page.locator('[data-testid="input-purpose"]');
  await purpose.scrollIntoViewIfNeeded();
  await purpose.fill("Mobile e2e visit");
  // The safety row is a clickable button that toggles the underlying
  // Radix Switch — clicking the row is the supported "tappable" surface.
  const safety = page.locator('[data-testid="safety-row"]');
  await safety.scrollIntoViewIfNeeded();
  await safety.click();
  const submit = page.locator('[data-testid="button-guest-signin"]');
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
}

/**
 * Assert that the page's scroll width never exceeds its client width:
 * if the body is wider than the viewport, mobile users have to scroll
 * sideways to fill out the form.
 */
async function expectNoHorizontalScroll(page: Page) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  // Allow 1 CSS px slop for sub-pixel rounding on hi-DPR mobile.
  expect(dims.scrollWidth, "documentElement.scrollWidth").toBeLessThanOrEqual(
    dims.clientWidth + 1,
  );
  expect(dims.bodyScrollWidth, "body.scrollWidth").toBeLessThanOrEqual(
    dims.clientWidth + 1,
  );
}

/**
 * Assert each selector resolves to an element whose horizontal extent
 * stays inside the viewport. We don't require it to be currently in
 * the viewport vertically — a real visitor scrolls to fill the form —
 * just that it doesn't extend past the right edge.
 */
async function expectFitsHorizontally(page: Page, selectors: string[]) {
  const viewportWidth = page.viewportSize()?.width ?? 0;
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    await expect(el, `${sel} should be attached`).toHaveCount(1);
    const box = await el.boundingBox();
    expect(box, `${sel} should have a layout box`).not.toBeNull();
    if (!box) continue;
    expect(box.x, `${sel}.x`).toBeGreaterThanOrEqual(-1);
    expect(
      box.x + box.width,
      `${sel} right edge vs viewport`,
    ).toBeLessThanOrEqual(viewportWidth + 1);
  }
}

/**
 * Assert each selector resolves to an element whose bounding box is at
 * least MIN_TAP_PX × MIN_TAP_PX in CSS pixels — the recommended minimum
 * tap target on touchscreens.
 */
async function expectMeetsTapTarget(page: Page, selectors: string[]) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    await expect(el, `${sel} should be attached`).toHaveCount(1);
    const box = await el.boundingBox();
    expect(box, `${sel} should have a layout box`).not.toBeNull();
    if (!box) continue;
    expect(box.width, `${sel} width`).toBeGreaterThanOrEqual(MIN_TAP_PX);
    expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(MIN_TAP_PX);
  }
}

test.beforeAll(async () => {
  pool = createPool();

  const stamp = makeStamp();
  const siteCode = `MOB${stamp.toUpperCase()}`.slice(0, 16);

  const partner = await createPartner(pool, {
    name: `Mobile Partner ${stamp}`,
    contactName: "Mobile Contact",
    contactEmail: `mobile-${stamp}@example.com`,
  });
  const vendor = await createVendor(pool, {
    name: `Mobile Vendor ${stamp}`,
    contactName: "Mobile Contact",
    contactEmail: `mobile-vendor-${stamp}@example.com`,
  });
  const workType = await createWorkType(pool, {
    name: `Mobile Work Type ${stamp}`,
    category: "general",
  });
  const site = await createSiteLocation(pool, {
    partnerId: partner.id,
    name: "Mobile Test Site",
    address: "1 Mobile Way",
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

for (const viewport of VIEWPORTS) {
  test(`visit-public is usable at ${viewport.label}`, async ({
    browser,
    baseURL,
  }) => {
    const ctx = await newMobileContext(browser, baseURL!, viewport);
    const page = await ctx.newPage();
    await page.goto(`/visit/${seed.siteCode}`);

    // ---- Step 1: sign-in form ----
    await expect(page.locator('[data-testid="input-first-name"]')).toBeVisible();

    await expectNoHorizontalScroll(page);

    const signinSelectors = [
      '[data-testid="input-first-name"]',
      '[data-testid="input-last-name"]',
      '[data-testid="input-phone"]',
      '[data-testid="input-email"]',
      '[data-testid="input-company"]',
      '[data-testid="input-vehicle-plate"]',
      '[data-testid="select-vehicle-state"]',
      '[data-testid="input-purpose"]',
      '[data-testid="safety-row"]',
      '[data-testid="button-guest-signin"]',
    ];
    await expectFitsHorizontally(page, signinSelectors);

    // The safety acknowledgement row is the primary tap target a user
    // hits to opt in — assert it meets the recommended minimum size.
    await expectMeetsTapTarget(page, ['[data-testid="safety-row"]']);

    // ---- Advance to the host-picker step ----
    await fillSignInFormSmall(page);

    await expect(page.getByText("Who are you visiting?")).toBeVisible();
    await expectNoHorizontalScroll(page);

    const partnerHostRow = `[data-testid="host-option-row-partner:${seed.partnerId}"]`;
    const vendorHostRow = `[data-testid="host-option-row-vendor:${seed.vendorId}"]`;
    const checkInBtn = '[data-testid="button-check-in"]';

    await expectFitsHorizontally(page, [
      partnerHostRow,
      vendorHostRow,
      checkInBtn,
    ]);
    // Both host options must be at least MIN_TAP_PX tall — they're
    // densely stacked and easy to mis-tap with a thumb on a phone.
    await expectMeetsTapTarget(page, [partnerHostRow, vendorHostRow]);

    // ---- Pick a host and check in ----
    await page.locator(vendorHostRow).click();
    await page.locator(checkInBtn).scrollIntoViewIfNeeded();
    await page.locator(checkInBtn).click();

    // ---- Step 3: active visit card ----
    const checkOutBtn = page.locator('[data-testid="button-check-out"]');
    await expect(checkOutBtn).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectFitsHorizontally(page, ['[data-testid="button-check-out"]']);

    // Clean up: check out so the next viewport iteration starts from a
    // clean session (each iteration uses its own browser context, but
    // the underlying site_visits row should still be closed for clarity
    // when inspecting the test database after a run).
    await checkOutBtn.click();
    await expect(
      page.locator('[data-testid="input-first-name"]'),
    ).toBeVisible();

    await ctx.close();
  });
}
