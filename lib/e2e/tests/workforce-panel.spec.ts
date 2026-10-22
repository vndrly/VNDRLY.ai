import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { createVendorActor, createVendorMember } from "../helpers/implementation-a";
import { createPartner, createSiteLocation } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

// Fictional records only, on the wrapper-owned fresh loopback database.
test("Workforce profiles, availability and real offers preserve the employee acceptance boundary", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const pool = createPool();
  try {
    const stamp = makeStamp();
    const admin = await createVendorActor(pool, "Workforce Example");
    await pool.query("UPDATE vendors SET operations_categories=ARRAY['gate']::text[] WHERE id=$1", [admin.vendorId]);
    const partner = await createPartner(pool, { name: `Staffing ${stamp}`, contactName: "Synthetic", contactEmail: `${stamp}@example.invalid` });
    const site = await createSiteLocation(pool, { partnerId: partner.id, name: "Example North Gate", address: "Synthetic", latitude: 30, longitude: -100, siteCode: stamp, siteRadiusMeters: 100 });
    await pool.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')", [partner.id, admin.vendorId]);
    const type = (await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id", [stamp])).rows[0].id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)", [site.id, type, admin.vendorId]);
    const station = (await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Example gate') RETURNING id", [site.id])).rows[0].id;
    const employees = [];
    for (const [name, onCall] of [["Alex Example", true], ["Sam Example", false]] as const) {
      const actor = await createVendorMember(pool, admin.vendorId, name);
      const person = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,last_name,email,is_active) VALUES($1,$2,'gatekeeper',$3,'', $4,true) RETURNING id", [admin.vendorId, actor.userId, name, actor.username])).rows[0].id;
      await pool.query("UPDATE user_org_memberships SET vendor_people_id=$1,role='field_employee' WHERE user_id=$2 AND vendor_id=$3", [person, actor.userId, admin.vendorId]);
      await pool.query("INSERT INTO vendor_person_operational_roles(vendor_people_id,role,is_active) VALUES($1,'gatekeeper',true)", [person]);
      await pool.query("INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id,is_active) VALUES($1,$2,true)", [person, site.id]);
      await pool.query("INSERT INTO work_hub_device_preferences(user_id,owner_org_type,owner_org_id,native_operations) VALUES($1,'vendor',$2,$3::jsonb)", [actor.userId, admin.vendorId, JSON.stringify({ onCallActive: onCall })]);
      employees.push(actor);
    }
    const startsAt = new Date(Date.now() + 3 * 86400000), endsAt = new Date(startsAt.getTime() + 8 * 3600000);
    const shift = (await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,qualification_codes,site_location_id,gate_station_id,required_staff_count,created_by_id) VALUES('vendor',$1,'Example North Gate shift',$2,$3,'America/Chicago',ARRAY[]::text[],$4,$5,1,$6) RETURNING id", [admin.vendorId, startsAt, endsAt, site.id, station, admin.userId])).rows[0].id;
    await pool.query("INSERT INTO workforce_coverage_records(shift_id,gate_station_id,vacancy_origin,required_count,assigned_count,actual_count,coverage_kind,state) VALUES($1,$2,'gate_schedule',1,0,0,'gate','uncovered')", [shift, station]);
    for (const employee of employees) await pool.query("INSERT INTO work_hub_availability(owner_org_type,owner_org_id,user_id,starts_at,ends_at,available) VALUES('vendor',$1,$2,$3,$4,true)", [admin.vendorId, employee.userId, startsAt, endsAt]);

    await loginAsVendor(page, admin);
    await page.goto("/work-hub");
    const workforce = page.getByRole("region", { name: "Workforce", exact: true });
    await workforce.getByRole("button", { name: /On Call.*1 on call.*1 unavailable/ }).click();
    await expect(workforce.getByRole("button", { name: /Alex Example/ })).toBeVisible();
    await workforce.getByRole("button", { name: "Unavailable · 1", exact: true }).click();
    await workforce.getByRole("button", { name: /Sam Example/ }).click();
    const profile = page.getByRole("dialog");
    await expect(profile.getByRole("link", { name: "Open employee profile" })).toBeVisible();
    await expect(profile.getByRole("button", { name: "Message employee" })).toBeVisible();
    await profile.getByRole("button", { name: "Close", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("workforce-availability.png"), fullPage: true });
    await workforce.getByRole("button", { name: /Coverage Gaps.*1 open/ }).click();
    await workforce.getByText("Example North Gate shift", { exact: true }).click();
    const candidate = workforce.locator(".workforce-offer").filter({ hasText: "Alex Example" });
    await candidate.getByRole("button", { name: "Offer Shift", exact: true }).click();
    await expect(candidate.getByText("Offered · Pending", { exact: true })).toBeVisible();
    expect((await pool.query("SELECT count(*)::int AS n FROM work_hub_shift_assignments WHERE shift_id=$1", [shift])).rows[0].n).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("workforce-offer-pending.png"), fullPage: true });

    await page.request.post("/api/auth/logout");
    await loginAsVendor(page, employees[0]);
    await page.goto("/work-hub");
    await page.getByRole("button", { name: /My Shift Offers.*1/ }).click();
    await page.getByRole("region", { name: "My Shift Offers", exact: true }).getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByText("Offer accepted. Assignment saved.", { exact: true })).toBeVisible();
    expect((await pool.query("SELECT user_id,status FROM work_hub_shift_assignments WHERE shift_id=$1", [shift])).rows).toEqual([{ user_id: employees[0].userId, status: "accepted" }]);
    expect((await pool.query("SELECT assigned_count,actual_count,state FROM workforce_coverage_records WHERE shift_id=$1", [shift])).rows[0]).toEqual({ assigned_count: 1, actual_count: 0, state: "uncovered" });
  } finally { await pool.end(); }
});
