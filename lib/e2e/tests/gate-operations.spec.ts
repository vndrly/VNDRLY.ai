import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { createVendorActor } from "../helpers/implementation-a";
import { createPartner, createSiteLocation } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

test("Gate Dashboard opens an exact current-shift History query", async ({ page }) => {
  test.setTimeout(120_000);
  const pool = createPool();
  try {
    await pool.query(await readFile(new URL("../../db/drizzle/gate_change_over.sql", import.meta.url), "utf8"));
    const stamp = makeStamp();
    const operator = await createVendorActor(pool, "Gate Operations");
    const partner = await createPartner(pool, { name: `Gate Operations ${stamp}`, contactName: "Fixture", contactEmail: `${stamp}@example.invalid` });
    const site = await createSiteLocation(pool, { partnerId: partner.id, name: `Operations site ${stamp}`, address: "Fixture", latitude: 30, longitude: -100, siteCode: stamp, siteRadiusMeters: 100 });
    const workTypeId = (await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id", [stamp])).rows[0].id;
    const personId = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gate_supervisor','Gate',$3) RETURNING id", [operator.vendorId, operator.userId, operator.username])).rows[0].id;
    await pool.query("UPDATE user_org_memberships SET vendor_people_id=$1 WHERE user_id=$2", [personId, operator.userId]);
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id) VALUES($1,$2,$3)", [site.id, workTypeId, operator.vendorId]);
    const stationId = (await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,$2) RETURNING id", [site.id, `Operations gate ${stamp}`])).rows[0].id;

    await loginAsVendor(page, operator);
    await page.goto(`/gate/change-over?siteId=${site.id}&stationId=${stationId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Start my shift", exact: true }).click();
    await expect(page.getByTestId("dashboard-metric-checkIns")).toBeVisible();
    await page.getByTestId("dashboard-metric-checkIns").click();
    await expect(page).toHaveURL(new RegExp(`gate/history.*siteId=${site.id}.*stationId=${stationId}.*range=current_shift.*recordType=check_ins`));
    await expect(page.getByLabel("History range")).toHaveValue("current_shift");
    await expect(page.getByLabel("Record type")).toHaveValue("check_ins");
  } finally {
    await pool.end();
  }
});
