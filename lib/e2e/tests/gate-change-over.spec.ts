import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { createVendorActor } from "../helpers/implementation-a";
import { createPartner, createSiteLocation } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

test("gate watch survives sign-out and transfers only after the incoming account reviews and assumes it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pool = createPool();
  try {
    await pool.query(
      await readFile(
        new URL("../../db/drizzle/gate_change_over.sql", import.meta.url),
        "utf8",
      ),
    );
    const stamp = makeStamp();
    const outgoing = await createVendorActor(pool, "Outgoing Gate");
    const incoming = await createVendorActor(pool, "Incoming Gate");
    const partner = await createPartner(pool, {
      name: `Handoff ${stamp}`,
      contactName: "Fixture",
      contactEmail: `${stamp}@example.invalid`,
    });
    const site = await createSiteLocation(pool, {
      partnerId: partner.id,
      name: `Handoff site ${stamp}`,
      address: "Fixture",
      latitude: 30,
      longitude: -100,
      siteCode: stamp,
      siteRadiusMeters: 100,
    });
    const work = (
      await pool.query(
        "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
        [stamp],
      )
    ).rows[0].id;
    for (const actor of [outgoing, incoming]) {
      const person = (
        await pool.query(
          "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gatekeeper','Gate',$3) RETURNING id",
          [actor.vendorId, actor.userId, actor.username],
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE user_org_memberships SET vendor_people_id=$1 WHERE user_id=$2",
        [person, actor.userId],
      );
      await pool.query(
        "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",
        [site.id, work, actor.vendorId],
      );
    }
    const gate = (
      await pool.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,'Second gate') RETURNING id",
        [site.id],
      )
    ).rows[0].id;
    await loginAsVendor(page, outgoing);
    await page.goto(`/gate/change-over?siteId=${site.id}&stationId=${gate}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Assume Watch", exact: true })
      .last().click();
    await expect(page.getByRole("button", {name:"Handover Watch",exact:true})).toBeVisible();
    await page
      .getByRole("textbox", { name: "Anything the next shift should know?", exact: true })
      .fill("Inspect the north barrier before admitting heavy loads.");
    await page
      .getByRole("button", { name: "Prepare handoff", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Incoming shift review" }),
    ).toBeVisible();

    const logout=await page.request.post('/api/auth/logout');
    expect(logout.ok()).toBe(true);
    expect((await pool.query("SELECT operator_id FROM gate_shifts WHERE station_id=$1 AND ended_at IS NULL",[gate])).rows).toEqual([{operator_id:outgoing.userId}]);
    await loginAsVendor(page,incoming);
    await page.goto(`/gate/change-over?siteId=${site.id}&stationId=${gate}`,{waitUntil:'domcontentloaded'});
    expect((await pool.query("SELECT operator_id FROM gate_shifts WHERE station_id=$1 AND ended_at IS NULL",[gate])).rows).toEqual([{operator_id:outgoing.userId}]);
    await page.getByRole('checkbox',{name:/I have reviewed this handoff/}).check();
    await page.locator('#watch-review').getByRole('button',{name:'Assume Watch',exact:true}).click();
    await expect(page.getByRole('button',{name:'Handover Watch',exact:true})).toBeVisible();
    expect((await pool.query("SELECT session_version FROM users WHERE id=ANY($1::int[]) ORDER BY id",[[outgoing.userId,incoming.userId]])).rows.map(row=>row.session_version)).toEqual([1,1]);
    expect((await pool.query("SELECT count(*)::int AS count FROM assistant_action_audit WHERE target_type='workday' AND user_id=ANY($1::int[])",[[outgoing.userId,incoming.userId]])).rows[0].count).toBe(0);
    await page.goto(`/gate/shift-notes?siteId=${site.id}&stationId=${gate}`,{waitUntil:'domcontentloaded'});
    await expect(
      page.getByRole("heading", { name: "Shift Notes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Inspect the north barrier before admitting heavy loads.",
        { exact: true },
      ),
    ).toBeVisible();
    const active = (
      await pool.query(
        "SELECT operator_id FROM gate_shifts WHERE station_id=$1 AND ended_at IS NULL",
        [gate],
      )
    ).rows;
    expect(active).toEqual([{ operator_id: incoming.userId }]);
  } finally {
    await pool.end();
  }
});
