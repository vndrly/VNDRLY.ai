import { test, expect, type Page } from "@playwright/test";
import type pg from "pg";
import { loginAsVendor as sharedLoginAsVendor } from "../helpers/auth";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createPartner,
  createSiteLocation,
  createSiteWorkAssignment,
  createTicket,
  createUser,
  createUserOrgMembership,
  createVendor,
  createVendorPerson,
  createWorkType,
  setActiveMembership,
} from "../helpers/fixtures";

// End-to-end browser test for Task #522: every vendor-side employee
// picker in the VNDRLY web app must hide deactivated vendor_people
// (`is_active = false`) and surface the canonical "No active field
// employees on your vendor." empty state when the vendor's only field
// employee has been deactivated.
//
// Pickers covered (those with a real rendered widget today):
//   1. Phone-intake foreman dropdown (tickets.tsx)
//   2. Create New Job > Field Employee dropdown (tickets.tsx)
//   3. Schedule Ticket dialog crew checkbox list (schedule-ticket-dialog.tsx)
//   4. Schedule Ticket dialog foreman select (schedule-ticket-dialog.tsx)
//   5. Crew on Site roster picker (crew-time-section.tsx)
//   6. Crew Time check-in picker (crew-time-section.tsx)
//   7. Field Operations Portal sign-in employee dropdown (portal.tsx)
//   8. Ticket detail assign / reassign picker (ticket-detail.tsx) —
//      restored by Task #538. Uses the same shared eligibility hook
//      (`useEligibleVendorFieldEmployeesByVendorId`) as the other six
//      vendor-side pickers, so deactivated vendor_people are excluded
//      by construction.
//
// The test boots no servers — it expects the api-server and the vndrly
// web workflows to be running, and DATABASE_URL to point at the same
// dev database both services use (matches the pattern in
// visit-public.spec.ts).

type Seed = {
  partnerId: number;
  vendorId: number;
  workTypeId: number;
  siteId: number;
  siteCode: string;
  activeFeId: number;
  deactivatedFeId: number;
  ticketId: number;
  vendorUserId: number;
  vendorUsername: string;
  feUserId: number;
  vendorMembershipId: number;
};

const VENDOR_PASSWORD = "e2epass123";

let pool: pg.Pool;
let seed: Seed;

async function loginAsVendor(page: Page, username: string): Promise<void> {
  await sharedLoginAsVendor(page, { username, password: VENDOR_PASSWORD });
}

async function seedFixture(): Promise<Seed> {
  const stamp = makeStamp();
  const siteCode = `E522${stamp.toUpperCase()}`.slice(0, 16);
  const passwordHash = hashPassword(VENDOR_PASSWORD);

  const partner = await createPartner(pool, {
    name: `E522 Partner ${stamp}`,
    contactName: "E522 Contact",
    contactEmail: `e522-partner-${stamp}@example.com`,
  });
  const vendor = await createVendor(pool, {
    name: `E522 Vendor ${stamp}`,
    contactName: "E522 Vendor Contact",
    contactEmail: `e522-vendor-${stamp}@example.com`,
  });
  const workType = await createWorkType(pool, {
    name: `E522 Work Type ${stamp}`,
    category: "general",
  });
  const site = await createSiteLocation(pool, {
    partnerId: partner.id,
    name: `E522 Site ${stamp}`,
    address: "1 Test Way",
    latitude: 40.0,
    longitude: -74.0,
    siteCode,
    siteRadiusMeters: 150,
  });
  // Site/work-type/vendor assignment so phone-intake and Create-New-Job
  // pickers see this vendor as eligible at this site.
  await createSiteWorkAssignment(pool, {
    siteLocationId: site.id,
    workTypeId: workType.id,
    vendorId: vendor.id,
  });

  // Vendor admin user (the operator opening every picker except portal).
  // Username is unique-per-run so re-runs don't collide.
  const vendorUsername = `e522-vendor-admin-${stamp}@example.com`;
  const vendorUser = await createUser(pool, {
    username: vendorUsername,
    email: vendorUsername,
    passwordHash,
    role: "vendor",
    displayName: `E522 Vendor Admin ${stamp}`,
  });
  const vendorMembership = await createUserOrgMembership(pool, {
    userId: vendorUser.id,
    orgType: "vendor",
    vendorId: vendor.id,
    role: "admin",
  });
  // Pin the membership active so the post-login picker is skipped — the
  // user is single-membership anyway, but resolveContext only auto-sets
  // activeMembershipId on first login otherwise.
  await setActiveMembership(pool, {
    userId: vendorUser.id,
    membershipId: vendorMembership.id,
  });

  // Active foreman with a linked user — needed so the schedule dialog's
  // foreman picker (which only lists crew members whose vendor_people
  // row has a userId) can include them.
  const feUsername = `e522-fe-active-${stamp}@example.com`;
  const feUser = await createUser(pool, {
    username: feUsername,
    email: feUsername,
    passwordHash,
    role: "field_employee",
    displayName: `E522 Active Foreman ${stamp}`,
  });
  const activeFe = await createVendorPerson(pool, {
    vendorId: vendor.id,
    vendorRole: "foreman",
    firstName: "E522ActiveForeman",
    lastName: stamp,
    email: feUsername,
    isActive: true,
    userId: feUser.id,
  });

  // Deactivated foreman — must NOT appear in any picker.
  const deactivatedFe = await createVendorPerson(pool, {
    vendorId: vendor.id,
    vendorRole: "foreman",
    firstName: "E522DeactivatedForeman",
    lastName: stamp,
    email: `e522-fe-deactivated-${stamp}@example.com`,
    isActive: false,
  });

  // Ticket assigned to this vendor at this site/work-type, in a status
  // that lets the schedule dialog and crew-time section render their
  // editable controls (canEdit requires status not in approved/cancelled).
  const ticket = await createTicket(pool, {
    siteLocationId: site.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    status: "in_progress",
    intakeChannel: "partner_self_service",
    description: "E522 ticket",
  });

  return {
    partnerId: partner.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    siteId: site.id,
    siteCode,
    activeFeId: activeFe.id,
    deactivatedFeId: deactivatedFe.id,
    ticketId: ticket.id,
    vendorUserId: vendorUser.id,
    vendorUsername,
    feUserId: feUser.id,
    vendorMembershipId: vendorMembership.id,
  };
}

async function cleanup(s: Seed): Promise<void> {
  // FK-safe order. crew_sessions / crew_roster / ticket_schedules /
  // schedule_warnings cascade off tickets, but we delete from tickets
  // explicitly anyway to keep this self-contained even if FK rules
  // change. user_org_memberships cascades off users so the membership
  // row is removed when we drop the user.
  await pool.query(`DELETE FROM tickets WHERE id = $1`, [s.ticketId]);
  await pool.query(
    `DELETE FROM site_work_assignments WHERE site_location_id = $1`,
    [s.siteId],
  );
  await pool.query(`DELETE FROM site_locations WHERE id = $1`, [s.siteId]);
  await pool.query(`DELETE FROM vendor_people WHERE id IN ($1, $2)`, [
    s.activeFeId,
    s.deactivatedFeId,
  ]);
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
    s.vendorUserId,
    s.feUserId,
  ]);
  await pool.query(`DELETE FROM work_types WHERE id = $1`, [s.workTypeId]);
  await pool.query(`DELETE FROM vendors WHERE id = $1`, [s.vendorId]);
  await pool.query(`DELETE FROM partners WHERE id = $1`, [s.partnerId]);
}

test.describe.serial("Task #522 — vendor-side pickers exclude deactivated field employees", () => {
  test.beforeAll(async () => {
    pool = createPool();
    seed = await seedFixture();
  });

  test.afterAll(async () => {
    if (seed) {
      try {
        await cleanup(seed);
      } catch (e) {
        // Best-effort cleanup — surface but don't fail the run.
        console.error("E522 cleanup failed:", e);
      }
    }
    await pool?.end();
  });

  // ── Picker 1: Phone-intake foreman ─────────────────────────────────
  test("phone-intake foreman picker excludes the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto("/tickets");

    await page.locator('[data-testid="button-phone-intake"]').click();
    // The foreman picker only renders when caller_type == field_employee.
    await page.locator('[data-testid="radio-caller-field-employee"]').click();
    // Pick the seeded site so the dialog can resolve work-types (not
    // strictly required to render the foreman picker but mirrors the
    // real flow and keeps the dialog consistent across runs).
    await page.locator('[data-testid="select-phone-site"]').click();
    await page
      .getByRole("option", { name: new RegExp(`E522 Site `) })
      .first()
      .click();

    await page.locator('[data-testid="select-phone-foreman"]').click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    // Close the dropdown for cleanliness.
    await page.keyboard.press("Escape");
  });

  // ── Picker 2: Create New Job > Field Employee ──────────────────────
  test("Create New Job field-employee picker excludes the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto("/tickets");

    await page.locator('[data-testid="button-start-new-ticket"]').click();
    await page.locator('[data-testid="select-field-employee"]').click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // ── Pickers 3 + 4: Schedule Ticket dialog crew + foreman ───────────
  test("Schedule Ticket dialog crew and foreman pickers exclude the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto(`/tickets/${seed.ticketId}`);

    await page
      .locator('[data-testid="button-schedule-ticket"]')
      .click();

    // Crew checklist: active employee renders, deactivated does not.
    const activeCrewCheckbox = page.locator(
      `[data-testid="checkbox-crew-${seed.activeFeId}"]`,
    );
    await expect(activeCrewCheckbox).toBeVisible();
    await expect(
      page.locator(`[data-testid="checkbox-crew-${seed.deactivatedFeId}"]`),
    ).toHaveCount(0);

    // Pick the active employee so the foreman picker has a real candidate
    // (the foreman select only lists crew members with a linked userId).
    await activeCrewCheckbox.check();

    await page.locator('[data-testid="select-foreman"]').click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // ── Picker 5: Crew on Site roster picker ───────────────────────────
  test("Crew on Site roster picker excludes the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto(`/tickets/${seed.ticketId}`);

    // Open the "Add crew member" dialog from the Crew on Site section.
    await page.locator('[data-testid="button-add-crew-roster"]').first().click();
    await page.locator('[data-testid="select-roster-employee"]').click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // ── Picker 6: Crew Time check-in picker ────────────────────────────
  test("Crew Time check-in picker excludes the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto(`/tickets/${seed.ticketId}`);

    // The "Check in crew member" trigger has no testid; locate by
    // accessible name (English locale).
    await page
      .getByRole("button", { name: /check in crew member/i })
      .first()
      .click();

    // The check-in select trigger has no testid either, but it lives
    // inside the only open dialog with role "dialog".
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").first().click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // ── Picker 8: Ticket detail assign / reassign ──────────────────────
  test("Ticket detail assign/reassign picker excludes the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto(`/tickets/${seed.ticketId}`);
    // The page mounts in `isEditing=true` for vendor viewers — the picker
    // is rendered immediately.
    await page.locator('[data-testid="select-edit-field-employee"]').click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // ── Picker 7: Field Operations Portal sign-in dropdown ─────────────
  test("Field Operations Portal employee picker excludes the deactivated employee", async ({
    page,
  }) => {
    await loginAsVendor(page, seed.vendorUsername);
    await page.goto(`/portal/${seed.siteCode}`);
    await page.locator('[data-testid="select-portal-vendor"]').click();
    await page
      .getByRole("option", { name: new RegExp(`E522 Vendor `) })
      .first()
      .click();

    await page.locator('[data-testid="select-portal-employee"]').click();
    await expect(page.getByRole("option", { name: /E522ActiveForeman/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /E522DeactivatedForeman/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // ── Empty-state suite: deactivate the only active employee, then
  //    every picker must surface the canonical empty message. ───────
  test.describe.serial("only-deactivated empty state", () => {
    test.beforeAll(async () => {
      // Flip the active foreman to is_active=false so the vendor has
      // zero eligible field employees from the API's perspective.
      await pool.query(
        `UPDATE vendor_people SET is_active = false WHERE id = $1`,
        [seed.activeFeId],
      );
    });

    test("phone-intake foreman picker shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto("/tickets");
      await page.locator('[data-testid="button-phone-intake"]').click();
      await page.locator('[data-testid="radio-caller-field-employee"]').click();
      await page.locator('[data-testid="select-phone-site"]').click();
      await page
        .getByRole("option", { name: new RegExp(`E522 Site `) })
        .first()
        .click();
      await page.locator('[data-testid="select-phone-foreman"]').click();
      const empty = page.locator('[data-testid="empty-phone-foreman-list"]');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveText(/No active field employees on your vendor\./);
      await page.keyboard.press("Escape");
    });

    test("Create New Job field-employee picker shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto("/tickets");
      await page.locator('[data-testid="button-start-new-ticket"]').click();
      await page.locator('[data-testid="select-field-employee"]').click();
      const empty = page.locator('[data-testid="empty-field-employee-list"]');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveText(/No active field employees on your vendor\./);
      await page.keyboard.press("Escape");
    });

    test("Schedule Ticket dialog crew section shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto(`/tickets/${seed.ticketId}`);
      await page.locator('[data-testid="button-schedule-ticket"]').click();

      // The crew section uses the `scheduleTicket.noEmployees` i18n key,
      // which resolves to the canonical "No active field employees on
      // your vendor." text. There is no testid on the empty <div>, so
      // assert by text, scoped to the open Schedule dialog.
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText(/No active field employees on your vendor\./).first(),
      ).toBeVisible();

      // No checkbox-crew-* should render at all.
      await expect(
        dialog.locator('[data-testid^="checkbox-crew-"]'),
      ).toHaveCount(0);

      // Foreman select only carries the "no foreman" sentinel — no real
      // employees are listed — because crewWithUsers is empty.
      await dialog.locator('[data-testid="select-foreman"]').click();
      await expect(
        page.getByRole("option", { name: /E522ActiveForeman/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("option", { name: /E522DeactivatedForeman/ }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
    });

    test("Crew on Site roster picker shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto(`/tickets/${seed.ticketId}`);

      // When eligibleForRoster is empty the AddCrewPill button is
      // disabled, so the dialog won't open by clicking it. Force the
      // dialog open is impractical from outside; instead assert the
      // disabled affordance — the "no eligible employees" condition
      // the pill encodes is the user-visible empty state.
      const addPill = page.locator('[data-testid="button-add-crew-roster"]').first();
      await expect(addPill).toBeDisabled();
    });

    test("Crew Time check-in picker shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto(`/tickets/${seed.ticketId}`);
      await page
        .getByRole("button", { name: /check in crew member/i })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox").first().click();
      const empty = page.locator('[data-testid="empty-checkin-employee-list"]');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveText(/No active field employees on your vendor\./);
      await page.keyboard.press("Escape");
    });

    test("Ticket detail assign/reassign picker shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto(`/tickets/${seed.ticketId}`);
      await page.locator('[data-testid="select-edit-field-employee"]').click();
      const empty = page.locator('[data-testid="empty-edit-field-employee-list"]');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveText(/No active field employees on your vendor\./);
      await page.keyboard.press("Escape");
    });

    test("Field Operations Portal employee picker shows the empty state", async ({
      page,
    }) => {
      await loginAsVendor(page, seed.vendorUsername);
      await page.goto(`/portal/${seed.siteCode}`);
      await page.locator('[data-testid="select-portal-vendor"]').click();
      await page
        .getByRole("option", { name: new RegExp(`E522 Vendor `) })
        .first()
        .click();
      await page.locator('[data-testid="select-portal-employee"]').click();
      const empty = page.locator('[data-testid="empty-portal-employee-list"]');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveText(/No active field employees on your vendor\./);
      await page.keyboard.press("Escape");
    });
  });
});
