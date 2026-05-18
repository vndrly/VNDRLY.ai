import { test, expect, type Page } from "@playwright/test";
import type pg from "pg";
import { loginAsAdmin as sharedLoginAsAdmin } from "../helpers/auth";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createPartner,
  createUser,
  createUserOrgMembership,
  createVendor,
  setActiveMembership,
} from "../helpers/fixtures";

// End-to-end browser test for the OrgMembersCard flow on the partner /
// vendor detail pages. Re-runnable from the test suite to guard against
// regressions in:
//
//   - Partner role progression: member -> AP -> member -> remove (AP option visible)
//   - Vendor  role progression: member -> admin -> member -> remove (no AP option)
//   - Field-employee rows: render as a static badge with no role select
//     and no remove button (read-only "via Field" cell).
//   - Self-row: current user's own membership row hides the role select
//     and disables the remove button with the
//     "You can't remove yourself" title.
//
// The Playwright config (`lib/e2e/playwright.config.ts`) auto-starts
// the api-server (:8080) and the vndrly web app (:23539) for this spec
// via `webServer`, with `reuseExistingServer: true` so local dev
// re-uses the running workflows. Both services must point at the same
// DB (`DATABASE_URL`). Per-run fixtures use a timestamp prefix so
// re-runs on a shared dev / CI database don't collide, and afterAll
// cleans up every row this spec inserted (with a stamp-scoped
// fallback delete for any orphan rows left by mid-test failures).

// We deliberately do NOT log in as the demo `admin` account — touching
// that row to set a known password / clear active_membership_id would
// permanently mutate a shared, well-known login (auth/security risk on
// any non-ephemeral DB and would also invalidate live sessions). The
// test instead provisions its own per-run system-admin login (unique
// username + random password) and tears it down in afterAll.
const ADMIN_PASSWORD = "e2e-admin-pwd-123";
const NEW_MEMBER_PASSWORD = "test-password-123";

type Seed = {
  stamp: string;
  partnerId: number;
  vendorId: number;
  adminUserId: number;
  adminUsername: string;
  fieldUserId: number;
  fieldPartnerMembershipId: number;
  // Dedicated partner-admin login used for the self-row guard test so
  // we don't have to attach an org membership to the system admin
  // (which would flip their session role to "partner" and break the
  // vendor-detail tests, since /api/vendors/:id rejects partner roles
  // that aren't related to the vendor).
  selfUserId: number;
  selfUsername: string;
  selfPartnerMembershipId: number;
  // Captured by the partner / vendor flow tests so afterAll can prune
  // the brand-new logins they created via the Add Member dialog.
  createdMemberUserIds: number[];
};

let pool: pg.Pool;
let seed: Seed;

async function loginAsAdmin(page: Page) {
  // This spec provisions its own per-run system-admin login (so it
  // doesn't have to mutate the shared demo `admin` row), so we pass the
  // seeded credentials into the shared helper instead of relying on its
  // default of admin/admin123.
  await sharedLoginAsAdmin(page, {
    username: seed.adminUsername,
    password: ADMIN_PASSWORD,
  });
}

/**
 * Locate the membership row for a user inside a given org by matching
 * the email cell (rendered from `users.username`). Returns the
 * membershipId encoded in the row's data-testid so subsequent
 * assertions can target the role select / remove button by id.
 */
async function findMembershipIdByEmail(
  orgType: "partner" | "vendor",
  orgId: number,
  email: string,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT m.id
       FROM user_org_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_type = $1
        AND ($1 = 'partner' AND m.partner_id = $2 OR $1 = 'vendor' AND m.vendor_id = $2)
        AND lower(u.username) = lower($3)
      ORDER BY m.id DESC
      LIMIT 1`,
    [orgType, orgId, email],
  );
  if (rows.length === 0) {
    throw new Error(
      `No membership found for ${email} in ${orgType}#${orgId}`,
    );
  }
  return rows[0].id;
}

test.beforeAll(async () => {
  pool = createPool();

  const stamp = makeStamp();

  // Per-run dedicated system-admin login. Username is namespaced with
  // the run stamp so re-runs don't collide on a shared dev DB. We
  // explicitly do NOT touch the demo `admin` row — mutating a shared,
  // well-known login row would be an auth/security risk on any
  // non-ephemeral DB. The user is torn down in afterAll.
  const adminUsername = `e2e-admin-${stamp}@example.com`;
  const adminUser = await createUser(pool, {
    username: adminUsername,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    role: "admin",
    displayName: `E2E System Admin ${stamp}`,
  });
  const adminUserId = adminUser.id;

  // Per-run partner + vendor fixtures.
  const partner = await createPartner(pool, {
    name: `E2E Members Partner ${stamp}`,
    contactName: "E2E Contact",
    contactEmail: `e2e-members-partner-${stamp}@example.com`,
  });
  const vendor = await createVendor(pool, {
    name: `E2E Members Vendor ${stamp}`,
    contactName: "E2E Contact",
    contactEmail: `e2e-members-vendor-${stamp}@example.com`,
  });

  // Field-employee user + membership against the partner. The UI surfaces
  // these read-only (badge instead of select, "via Field" instead of a
  // remove button) — that's what the field-employee assertions verify.
  const fieldUser = await createUser(pool, {
    username: `e2e-field-${stamp}@example.com`,
    passwordHash: hashPassword("not-used"),
    role: "field_employee",
    displayName: `E2E Field ${stamp}`,
  });
  const fieldMembership = await createUserOrgMembership(pool, {
    userId: fieldUser.id,
    orgType: "partner",
    partnerId: partner.id,
    role: "field_employee",
  });

  // Dedicated partner-admin login for the self-row guard test. We use a
  // separate user (not the system admin) because attaching an admin
  // membership to the system admin would flip their session role to
  // "partner" via deriveSessionRole(), which then rejects the
  // system-admin paths the partner / vendor flow tests rely on.
  const selfUsername = `e2e-self-${stamp}@example.com`;
  const selfPassword = "self-test-password-123";
  const selfUser = await createUser(pool, {
    username: selfUsername,
    passwordHash: hashPassword(selfPassword),
    role: "partner",
    displayName: `E2E Self-Row Admin ${stamp}`,
  });
  const selfMembership = await createUserOrgMembership(pool, {
    userId: selfUser.id,
    orgType: "partner",
    partnerId: partner.id,
    role: "admin",
  });
  await setActiveMembership(pool, {
    userId: selfUser.id,
    membershipId: selfMembership.id,
  });

  seed = {
    stamp,
    partnerId: partner.id,
    vendorId: vendor.id,
    adminUserId,
    adminUsername,
    fieldUserId: fieldUser.id,
    fieldPartnerMembershipId: fieldMembership.id,
    selfUserId: selfUser.id,
    selfUsername,
    selfPartnerMembershipId: selfMembership.id,
    createdMemberUserIds: [],
  };
});

test.afterAll(async () => {
  if (!seed) {
    await pool?.end();
    return;
  }
  // FK-safe cleanup. user_org_memberships has ON DELETE CASCADE from
  // partners and vendors, so deleting the org rows nukes every
  // membership pointing at them — including the seeded field-employee
  // row, the dedicated self-row partner-admin row, and any rows
  // created by the Add Member dialogs during the tests. Then we delete
  // the brand-new login accounts the tests created (tracked by id in
  // createdMemberUserIds), the field-employee user, and the self-row
  // partner-admin user — none of them belong to any other org so it's
  // safe to remove the user rows themselves.
  await pool.query(`DELETE FROM partners WHERE id = $1`, [seed.partnerId]);
  await pool.query(`DELETE FROM vendors WHERE id = $1`, [seed.vendorId]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
    [seed.adminUserId, seed.fieldUserId, seed.selfUserId],
  ]);
  if (seed.createdMemberUserIds.length > 0) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
      seed.createdMemberUserIds,
    ]);
  }
  // Stamp-scoped fallback: if a test aborted before its newly created
  // member-user id made it into createdMemberUserIds, the user row
  // would otherwise leak. Every login the spec creates uses an email
  // shaped `e2e-<role>-<stamp>...@example.com`, so a stamp-scoped
  // LIKE delete reliably catches any orphans without ever touching
  // unrelated user rows on a shared DB.
  await pool.query(
    `DELETE FROM users WHERE username LIKE $1`,
    [`e2e-%${seed.stamp}%@example.com`],
  );
  await pool.end();
});

test("partner members flow: add → AP → member → remove (AP option visible)", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto(`/partners/${seed.partnerId}`);

  const card = page.locator('[data-testid="card-partner-members"]');
  await expect(card).toBeVisible();

  // Open Add Member.
  await page.locator('[data-testid="button-add-partner-member"]').click();
  const dialogEmail = page.locator('[data-testid="input-partner-member-email"]');
  await expect(dialogEmail).toBeVisible();

  // The role <Select> on the partner form must surface the AP option.
  // Vendor doesn't have one, see the vendor test below for the
  // negative assertion.
  await page.locator('[data-testid="select-partner-member-role"]').click();
  await expect(
    page.locator('[data-testid="select-partner-member-role-ap"]'),
  ).toBeVisible();
  // Close the popover (we'll add as plain member; the per-row select
  // exercises the AP transition next).
  await page.keyboard.press("Escape");

  const memberEmail = `e2e-member-partner-${seed.stamp}@example.com`;
  await dialogEmail.fill(memberEmail);
  await page
    .locator('[data-testid="input-partner-member-display-name"]')
    .fill(`E2E Member Partner ${seed.stamp}`);
  await page
    .locator('[data-testid="input-partner-member-password"]')
    .fill(NEW_MEMBER_PASSWORD);
  await page.locator('[data-testid="button-submit-partner-member"]').click();

  // Toast confirms creation, dialog closes.
  await expect(
    page.getByText(/New login created and attached/i).first(),
  ).toBeVisible();
  await expect(dialogEmail).toHaveCount(0);

  // Find the new membership id via the DB — the card rerenders from a
  // refetch and we want a stable handle to the row's data-testid.
  const membershipId = await findMembershipIdByEmail(
    "partner",
    seed.partnerId,
    memberEmail,
  );
  const memberRow = page.locator(
    `[data-testid="row-partner-member-${membershipId}"]`,
  );
  await expect(memberRow).toBeVisible();
  await expect(memberRow).toContainText(memberEmail);

  // Track the underlying user so afterAll can clean it up.
  const { rows: userIdRow } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(username) = lower($1)`,
    [memberEmail],
  );
  seed.createdMemberUserIds.push(userIdRow[0].id);

  // member -> AP via the per-row select.
  await page
    .locator(`[data-testid="select-partner-member-role-${membershipId}"]`)
    .click();
  await page
    .locator(
      `[data-testid="select-partner-member-role-${membershipId}-ap"]`,
    )
    .click();
  await expect(page.getByText(/Role updated/i).first()).toBeVisible();
  // Verify persistence at the DB level so the assertion does not race
  // a stale UI cache.
  const apCheck = await pool.query<{ role: string }>(
    `SELECT role FROM user_org_memberships WHERE id = $1`,
    [membershipId],
  );
  expect(apCheck.rows[0].role).toBe("ap");

  // Wait for the previous "Role updated" toast to dismiss so the next
  // assertion below can't race-match it before the AP→member request
  // has finished. Sonner stacks toasts in DOM order, so .first() can
  // otherwise satisfy itself against the still-visible old one.
  await expect(page.getByText(/Role updated/i)).toHaveCount(0);

  // AP -> member via the per-row select.
  await page
    .locator(`[data-testid="select-partner-member-role-${membershipId}"]`)
    .click();
  await page.getByRole("option", { name: "Member", exact: true }).click();
  await expect(page.getByText(/Role updated/i).first()).toBeVisible();
  const memberCheck = await pool.query<{ role: string }>(
    `SELECT role FROM user_org_memberships WHERE id = $1`,
    [membershipId],
  );
  expect(memberCheck.rows[0].role).toBe("member");

  // Remove the membership through the destructive confirm dialog.
  await page
    .locator(`[data-testid="button-remove-partner-member-${membershipId}"]`)
    .click();
  await page
    .locator(
      `[data-testid="button-confirm-remove-partner-member-${membershipId}"]`,
    )
    .click();
  await expect(page.getByText(/Member removed/i).first()).toBeVisible();
  await expect(memberRow).toHaveCount(0);
  const removed = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM user_org_memberships WHERE id = $1`,
    [membershipId],
  );
  expect(removed.rows[0].count).toBe("0");
});

test("vendor members flow: add → admin → member → remove (no AP option)", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto(`/vendors/${seed.vendorId}`);

  const card = page.locator('[data-testid="card-vendor-members"]');
  await expect(card).toBeVisible();

  // Open Add Member dialog and confirm the AP option is NOT offered.
  await page.locator('[data-testid="button-add-vendor-member"]').click();
  const dialogEmail = page.locator('[data-testid="input-vendor-member-email"]');
  await expect(dialogEmail).toBeVisible();
  await page.locator('[data-testid="select-vendor-member-role"]').click();
  // The dialog's AP testid is partner-only; vendors must not surface it.
  await expect(
    page.locator('[data-testid="select-partner-member-role-ap"]'),
  ).toHaveCount(0);
  // Inspect the visible options for the vendor select. Member + Admin
  // only — anything else is a regression.
  await expect(
    page.getByRole("option", { name: "Member", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Admin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /Accounts Payable/i }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  const memberEmail = `e2e-member-vendor-${seed.stamp}@example.com`;
  await dialogEmail.fill(memberEmail);
  await page
    .locator('[data-testid="input-vendor-member-display-name"]')
    .fill(`E2E Member Vendor ${seed.stamp}`);
  await page
    .locator('[data-testid="input-vendor-member-password"]')
    .fill(NEW_MEMBER_PASSWORD);
  await page.locator('[data-testid="button-submit-vendor-member"]').click();

  await expect(
    page.getByText(/New login created and attached/i).first(),
  ).toBeVisible();
  await expect(dialogEmail).toHaveCount(0);

  const membershipId = await findMembershipIdByEmail(
    "vendor",
    seed.vendorId,
    memberEmail,
  );
  const memberRow = page.locator(
    `[data-testid="row-vendor-member-${membershipId}"]`,
  );
  await expect(memberRow).toBeVisible();
  const { rows: userIdRow } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(username) = lower($1)`,
    [memberEmail],
  );
  seed.createdMemberUserIds.push(userIdRow[0].id);

  // The per-row role select must also omit the AP option.
  await page
    .locator(`[data-testid="select-vendor-member-role-${membershipId}"]`)
    .click();
  await expect(
    page.locator(
      `[data-testid="select-vendor-member-role-${membershipId}-ap"]`,
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: /Accounts Payable/i }),
  ).toHaveCount(0);

  // member -> admin
  await page.getByRole("option", { name: "Admin", exact: true }).click();
  await expect(page.getByText(/Role updated/i).first()).toBeVisible();
  const adminCheck = await pool.query<{ role: string }>(
    `SELECT role FROM user_org_memberships WHERE id = $1`,
    [membershipId],
  );
  expect(adminCheck.rows[0].role).toBe("admin");

  // Wait for the previous toast to dismiss so the next assertion below
  // does not race-match it before the admin→member request finishes.
  await expect(page.getByText(/Role updated/i)).toHaveCount(0);

  // admin -> member
  await page
    .locator(`[data-testid="select-vendor-member-role-${membershipId}"]`)
    .click();
  await page.getByRole("option", { name: "Member", exact: true }).click();
  await expect(page.getByText(/Role updated/i).first()).toBeVisible();
  const backCheck = await pool.query<{ role: string }>(
    `SELECT role FROM user_org_memberships WHERE id = $1`,
    [membershipId],
  );
  expect(backCheck.rows[0].role).toBe("member");

  // Remove
  await page
    .locator(`[data-testid="button-remove-vendor-member-${membershipId}"]`)
    .click();
  await page
    .locator(
      `[data-testid="button-confirm-remove-vendor-member-${membershipId}"]`,
    )
    .click();
  await expect(page.getByText(/Member removed/i).first()).toBeVisible();
  await expect(memberRow).toHaveCount(0);
  const removed = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM user_org_memberships WHERE id = $1`,
    [membershipId],
  );
  expect(removed.rows[0].count).toBe("0");
});

test("field-employee row renders as a static badge with no role select / no remove button", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto(`/partners/${seed.partnerId}`);

  const fieldRow = page.locator(
    `[data-testid="row-partner-member-${seed.fieldPartnerMembershipId}"]`,
  );
  await expect(fieldRow).toBeVisible();

  // Read-only badge is rendered, role select is NOT.
  const badge = page.locator(
    `[data-testid="badge-partner-member-role-${seed.fieldPartnerMembershipId}"]`,
  );
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(/Field/);
  await expect(
    page.locator(
      `[data-testid="select-partner-member-role-${seed.fieldPartnerMembershipId}"]`,
    ),
  ).toHaveCount(0);

  // The right-most cell is a "via Field" muted label, NOT a remove button.
  await expect(fieldRow).toContainText("via Field");
  await expect(
    page.locator(
      `[data-testid="button-remove-partner-member-${seed.fieldPartnerMembershipId}"]`,
    ),
  ).toHaveCount(0);
});

test("self-row: badge instead of role select, remove button disabled with the 'You can't remove yourself' title", async ({
  page,
}) => {
  // Login as the dedicated partner-admin user (not the system admin) so
  // the user's own membership row appears in the table — that's the
  // only path the UI's `isSelf` branch can be exercised through.
  await sharedLoginAsAdmin(page, {
    username: seed.selfUsername,
    password: "self-test-password-123",
  });

  await page.goto(`/partners/${seed.partnerId}`);

  const selfRow = page.locator(
    `[data-testid="row-partner-member-${seed.selfPartnerMembershipId}"]`,
  );
  await expect(selfRow).toBeVisible();

  // The role cell renders the static badge — no role select for self.
  const badge = page.locator(
    `[data-testid="badge-partner-member-role-${seed.selfPartnerMembershipId}"]`,
  );
  await expect(badge).toBeVisible();
  await expect(
    page.locator(
      `[data-testid="select-partner-member-role-${seed.selfPartnerMembershipId}"]`,
    ),
  ).toHaveCount(0);

  // Remove button is rendered (so admins know the slot exists) but
  // disabled with the explanatory title attribute that the UI uses to
  // surface the "you can't remove yourself" guard.
  const removeBtn = page.locator(
    `[data-testid="button-remove-partner-member-${seed.selfPartnerMembershipId}"]`,
  );
  await expect(removeBtn).toBeVisible();
  await expect(removeBtn).toBeDisabled();
  await expect(removeBtn).toHaveAttribute(
    "title",
    "You can't remove yourself",
  );
});
