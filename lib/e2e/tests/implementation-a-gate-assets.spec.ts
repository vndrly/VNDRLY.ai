import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { loginAsVendor } from "../helpers/auth";
import { createPartner, createSiteLocation } from "../helpers/fixtures";
import {
  createVendorActor,
  createVendorMember,
} from "../helpers/implementation-a";

test("a spoken Texas plate resolves one vehicle, transfers custody, and auto-admits once", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const pool = createPool();
  const stamp = makeStamp();
  const admin = await createVendorActor(pool, "Fleet Sponsor");
  const ordinaryMember = await createVendorMember(pool, admin.vendorId, "Fleet Member");
  const driver = await createVendorMember(pool, admin.vendorId, "Fleet Driver");
  const driverContext = await browser.newContext();
  const memberContext = await browser.newContext();
  try {
    const [person] = (await pool.query(
      "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gatekeeper','Fleet',$3) RETURNING id",
      [admin.vendorId, driver.userId, driver.username],
    )).rows;
    await pool.query("UPDATE user_org_memberships SET vendor_people_id=$1 WHERE user_id=$2", [person.id, driver.userId]);
    const partner = await createPartner(pool, {
      name: `Example Site Owner ${stamp}`,
      contactName: "Example Site Owner",
      contactEmail: `site-${stamp}@example.invalid`,
    });
    const site = await createSiteLocation(pool, {
      partnerId: partner.id,
      name: `Founding Site ${stamp}`,
      address: "100 Example Lease Road, Texas",
      latitude: 30,
      longitude: -97,
      siteCode: `SITE-${stamp.slice(-8).toUpperCase()}`,
      siteRadiusMeters: 100,
    });
    await pool.query(
      "INSERT INTO location_consents (user_id, device_id) VALUES ($1,$2)",
      [driver.userId, `journey-${stamp}`],
    );

    await loginAsVendor(page, admin);
    const createdAsset = await page.request.post(
      "/api/implementation-a/assets",
      {
        data: {
          name: `Fleet truck ABC123 ${stamp}`,
          category: "vehicle",
          legalOwner: "Fleet Sponsor",
          responsibleOwner: { type: "vendor", id: admin.vendorId },
          aliases: [
            {
              kind: "vin",
              value: `1FTEXAMPLE${stamp.replace(/\D/g, "").slice(-6).padStart(6, "0")}`,
            },
            { kind: "plate", jurisdiction: "TX", value: "ABC123" },
          ],
          provisional: false,
          manufacturer: "Example Motors",
          model: "Field Truck",
        },
      },
    );
    expect(createdAsset.status()).toBe(201);
    const asset = await createdAsset.json();

    const memberPage = await memberContext.newPage();
    await loginAsVendor(memberPage, ordinaryMember);
    const forbiddenCheckout = await memberPage.request.post(
      `/api/implementation-a/assets/${asset.id}/checkout`,
      { data: { operationId: randomUUID(), expectedVersion: asset.version, condition: "good", confirmed: true, photos: [] } },
    );
    expect(forbiddenCheckout.status()).toBe(403);

    const driverPage = await driverContext.newPage();
    await loginAsVendor(driverPage, driver);
    const found = await driverPage.request.get(
      "/api/implementation-a/assets/find?kind=plate&jurisdiction=TX&value=ABC123",
    );
    expect(found.status()).toBe(200);
    expect((await found.json()).id).toBe(asset.id);
    const checkout = await driverPage.request.post(
      `/api/implementation-a/assets/${asset.id}/checkout`,
      {
        data: {
          operationId: randomUUID(),
          expectedVersion: asset.version,
          condition: "good",
          confirmed: true,
          note: "Voice-confirmed checkout using Texas plate ABC123",
          photos: [],
        },
      },
    );
    expect(checkout.status()).toBe(200);
    expect(await checkout.json()).toMatchObject({
      status: "applied",
      asset: {
        status: "checked_out",
        holderUserId: driver.userId,
      },
    });

    const started = await driverPage.request.post(
      "/api/implementation-a/trips",
      {
        data: {
          operationId: randomUUID(),
          owner: { type: "vendor", id: driver.vendorId },
          driverUserId: driver.userId,
          vehicleAssetId: asset.id,
          assignmentId: `haul-${stamp}`,
          siteLocationId: site.id,
          destinationSource: "assignment",
          activeShiftId: null,
        },
      },
    );
    expect(started.status()).toBe(201);
    let trip = await started.json();
    const base = Date.now() - 30_000;
    for (const point of [
      { latitude: 30.002, at: base },
      { latitude: 30.0005, at: base + 10_000 },
      { latitude: 30.0004, at: base + 20_000 },
    ]) {
      const updated = await driverPage.request.post(
        `/api/implementation-a/trips/${trip.id}/location`,
        {
          data: {
            expectedVersion: trip.version,
            latitude: point.latitude,
            longitude: -97,
            accuracyMeters: 5,
            speedMps: 3,
            recordedAt: new Date(point.at).toISOString(),
          },
        },
      );
      expect(updated.status()).toBe(201);
      const body = await updated.json();
      trip = body.trip;
    }
    expect(trip.presenceState).toBe("on_site");
    const visits = await pool.query(
      "SELECT id FROM site_visits WHERE site_location_id=$1 AND recorded_by_user_id=$2",
      [site.id, driver.userId],
    );
    expect(visits.rowCount).toBe(1);
  } finally {
    await driverContext.close();
    await memberContext.close();
    await pool.end();
  }
});
