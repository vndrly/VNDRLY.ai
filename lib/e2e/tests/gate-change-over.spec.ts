import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { createVendorActor } from "../helpers/implementation-a";
import { createPartner, createSiteLocation } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

test("gate handoff authenticates, acknowledges, transfers and opens the selected gate history", async ({
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
        "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id) VALUES($1,$2,$3)",
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
      .getByRole("button", { name: "Start my shift", exact: true })
      .click();
    await page
      .getByLabel("Anything the next shift should know?")
      .fill("Inspect the north barrier before admitting heavy loads.");
    await page
      .getByRole("button", { name: "Prepare handoff", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Incoming shift review" }),
    ).toBeVisible();
    await page.getByLabel("Incoming username or email").fill(incoming.username);
    await page
      .getByLabel("Incoming password", { exact: true })
      .fill(incoming.password);
    await page
      .getByRole("button", { name: "Authenticate incoming user" })
      .click();
    await page
      .getByRole("checkbox", { name: /I have reviewed this handoff/ })
      .check();
    await page
      .getByRole("button", { name: "Switch User", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/gate/shift-notes\\?siteId=${site.id}&stationId=${gate}`),
    );
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
