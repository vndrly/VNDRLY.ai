import { test, expect } from "@playwright/test";
import type pg from "pg";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import { createPartner, createUser, createUserOrgMembership, createVendor, setActiveMembership } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

test("partner priority saves from a mini-card and stays out of Next Steps after reload", async ({ page }, testInfo) => {
  const pool: pg.Pool = createPool();
  const stamp = makeStamp();
  const username = `priority-${stamp}@example.invalid`;
  const password = "PriorityFixtureOnly-2026";
  try {
    const vendor = await createVendor(pool, { name: `Example Priority ${stamp}`, contactName: "Casey Example", contactEmail: username });
    const partner = await createPartner(pool, { name: "Example Priority Partner", contactName: "Jordan Example", contactEmail: `partner-${stamp}@example.invalid` });
    const user = await createUser(pool, { username, email: username, passwordHash: hashPassword(password), role: "vendor", displayName: "Casey Example" });
    const membership = await createUserOrgMembership(pool, { userId: user.id, vendorId: vendor.id, orgType: "vendor", role: "admin" });
    await setActiveMembership(pool, { userId: user.id, membershipId: membership.id });
    await pool.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')", [partner.id, vendor.id]);
    await loginAsVendor(page, { username, password });
    await page.getByRole("button", { name: /Next Steps, \d+ available/ }).first().click();
    const panel = page.getByTestId("next-steps-panel");
    await panel.getByText("Company partner priority", { exact: true }).click();
    await panel.getByRole("spinbutton", { name: "Example Priority Partner" }).fill("1");
    const save = panel.getByRole("button", { name: "Save Partner Priority", exact: true });
    await expect(save).toHaveClass(/vendor-mini-card-button/);
    await expect(save).toHaveCSS("border-radius", "8px");
    await page.screenshot({ path: testInfo.outputPath("priority-before-save.png") });
    await save.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Company partner priority", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "Next Steps", exact: true })).toBeFocused();
    const saved = (await pool.query("SELECT next_steps_partner_order,next_steps_partner_order_saved_at FROM vendors WHERE id=$1", [vendor.id])).rows[0];
    expect(saved.next_steps_partner_order).toEqual([partner.id]);
    expect(saved.next_steps_partner_order_saved_at).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("priority-after-save.png") });
    await page.reload();
    await page.getByRole("button", { name: /Next Steps, \d+ available/ }).first().click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Company partner priority", { exact: true })).toHaveCount(0);
  } finally {
    await pool.end();
  }
});
