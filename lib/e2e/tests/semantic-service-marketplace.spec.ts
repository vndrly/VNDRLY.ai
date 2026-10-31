import { createHash } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
import type pg from "pg";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../scripts/fresh-test-database.mjs";
import { assertLocalE2EBaseUrl } from "../../../scripts/e2e-isolation.mjs";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import { login } from "../helpers/auth";
import {
  createPartner,
  createVendor,
  createUser,
  createUserOrgMembership,
  setActiveMembership,
  createWorkType,
  createSiteLocation,
} from "../helpers/fixtures";

// Fail before opening any pool. This suite must run through verify-release.yml's
// fresh-local wrapper, never an inherited development/production connection.
assertFreshLocalTestDatabaseEnvironment(process.env);
const baseURL = assertLocalE2EBaseUrl(process.env.E2E_BASE_URL);

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

const password = "MarketplaceFixture-2026!";
const root = "/api/service-marketplace";
type Actor = {
  id: number;
  username: string;
  password: string;
  userId: number;
  name: string;
};
async function actor(
  pool: pg.Pool,
  side: "partner" | "vendor",
  name: string,
): Promise<Actor> {
  const username = `marketplace-${makeStamp()}@example.invalid`;
  const org = await (side === "partner" ? createPartner : createVendor)(pool, {
    name,
    contactName: "Synthetic fixture",
    contactEmail: username,
  });
  const user = await createUser(pool, {
    username,
    email: username,
    passwordHash: hashPassword(password),
    role: side,
    displayName: name,
  });
  const membership = await createUserOrgMembership(pool, {
    userId: user.id,
    orgType: side,
    [side === "partner" ? "partnerId" : "vendorId"]: org.id,
    role: "admin",
  });
  await setActiveMembership(pool, {
    userId: user.id,
    membershipId: membership.id,
  });
  await pool.query(
    "INSERT INTO capability_flags (owner_org_type,owner_org_id,flag_name,enabled) VALUES ($1,$2,'semantic_service_marketplace',true)",
    [side, org.id],
  );
  return { ...org, username, password, userId: user.id, name };
}

// Reviewed high-confidence saved mappings are deterministic fixtures. No external
// model is called by a release gate. Classifier quality is evaluated separately.
async function mapping(
  pool: pg.Pool,
  service: number,
  type: "partner_work_type" | "vendor_capability",
  id: number,
  name: string,
) {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        type,
        id,
        name,
        null,
        type === "partner_work_type" ? "Security" : null,
      ]),
    )
    .digest("hex");
  await pool.query(
    `INSERT INTO service_mappings
    (subject_type,subject_id,work_type_id,vendor_capability_id,canonical_service_id,status,confidence,explanation,evidence,model_version,mapping_version)
    VALUES ($1,$2,$3,$4,$5,'active',0.99,'Controlled entry, visitor logs and vehicle verification',$6,'reviewed-e2e:v1',1)`,
    [
      type,
      id,
      type === "partner_work_type" ? id : null,
      type === "vendor_capability" ? id : null,
      service,
      { serviceMatching: { subjectFingerprint: fingerprint } },
    ],
  );
}
async function fixture(pool: pg.Pool, browser: Browser) {
  const stamp = makeStamp();
  const flywheel = await actor(pool, "partner", `Flywheel ${stamp}`);
  const warwick = await actor(pool, "partner", `Warwick ${stamp}`);
  const midcon = await actor(pool, "vendor", `MidCon ${stamp}`);
  const competitor = await actor(pool, "vendor", `Competitor-private-${stamp}`);
  const gatekeeping = await createWorkType(pool, {
    partnerId: flywheel.id,
    name: "Gatekeeping",
    category: "Security",
  });
  const perimeter = await createWorkType(pool, {
    partnerId: warwick.id,
    name: "Perimeter Security",
    category: "Security",
  });
  await pool.query(
    "UPDATE work_types SET estimated_price=9876543.21 WHERE id=$1",
    [gatekeeping.id],
  );
  await pool.query(
    "INSERT INTO partner_notes (partner_id,content) VALUES ($1,$2)",
    [flywheel.id, `PARTNER-PRIVATE-${stamp}`],
  );
  const service = (
    await pool.query(
      "INSERT INTO canonical_services (code,name,category,definition) VALUES ($1,'Gate and perimeter security','Security','Controlled entry and visitor verification') RETURNING id",
      [`e2e-gate-${stamp}`],
    )
  ).rows[0].id as number;
  await mapping(
    pool,
    service,
    "partner_work_type",
    gatekeeping.id,
    "Gatekeeping",
  );
  await mapping(
    pool,
    service,
    "partner_work_type",
    perimeter.id,
    "Perimeter Security",
  );
  const near = await createSiteLocation(pool, {
    partnerId: flywheel.id,
    name: `Near ${stamp}`,
    address: "Synthetic OK site",
    latitude: 35.5,
    longitude: -97,
    siteCode: `near-${stamp}`,
    siteRadiusMeters: 500,
  });
  const far = await createSiteLocation(pool, {
    partnerId: flywheel.id,
    name: `Far ${stamp}`,
    address: "Synthetic remote site",
    latitude: 50,
    longitude: -97,
    siteCode: `far-${stamp}`,
    siteRadiusMeters: 500,
  });
  const warwickSite = await createSiteLocation(pool, {
    partnerId: warwick.id,
    name: `Warwick site ${stamp}`,
    address: "Synthetic OK site",
    latitude: 35.5,
    longitude: -97,
    siteCode: `warwick-${stamp}`,
    siteRadiusMeters: 500,
  });
  const partnerPage = await browser.newPage({ baseURL });
  await pool.query("UPDATE site_locations SET afe=$1 WHERE id=ANY($2::int[])", [`E2E-AFE-${stamp}`, [near.id, far.id]]);
  const vendorPage = await browser.newPage({ baseURL });
  await login(partnerPage, flywheel);
  await login(vendorPage, midcon);
  const caps: number[] = [];
  for (const vendor of [midcon, competitor]) {
    await pool.query(
      `UPDATE vendors SET physical_address='Synthetic verified base',latitude=35,longitude=-97,geocoded_at=now(),
      federal_tax_id='00-0000000',coi_document_url='fixture',insurance_expiration_date='2099-01-01',
      wc_document_url='fixture',wc_expiration_date='2099-01-01',gl_document_url='fixture',gl_expiration_date='2099-01-01',
      auto_liability_document_url='fixture',auto_liability_expiration_date='2099-01-01',w9_document_url='fixture' WHERE id=$1`,
      [vendor.id],
    );
    const cap = (
      await pool.query(
        "INSERT INTO vendor_capabilities (vendor_id,name,capacity) VALUES ($1,'Gate Services',2) RETURNING id",
        [vendor.id],
      )
    ).rows[0].id as number;
    await mapping(pool, service, "vendor_capability", cap, "Gate Services");
    caps.push(cap);
    if (vendor === midcon) {
      const area = await vendorPage.request.put(
        `${root}/vendors/${vendor.id}/service-areas`,
        { data: { radiusMiles: 500 } },
      );
      expect(area.status()).toBe(200);
      expect(await area.json()).toMatchObject({ radiusMiles: "500.000" });
    } else {
      await pool.query(
        "INSERT INTO vendor_service_areas (vendor_id,address,latitude,longitude,radius_miles,coordinate_provenance,verified_at) VALUES ($1,'Synthetic verified base',35,-97,500,'fixture',now())",
        [vendor.id],
      );
    }
  }
  const rate = await vendorPage.request.put(
    `${root}/vendors/${midcon.id}/partner-rates`,
    {
      data: {
        vendorCapabilityId: caps[0],
        workTypeId: gatekeeping.id,
        unitPrice: 75,
        unit: "hour",
        capacity: 2,
      },
    },
  );
  expect(rate.status()).toBe(200);
  const flywheelRate = await rate.json();
  const otherRate = await vendorPage.request.put(
    `${root}/vendors/${midcon.id}/partner-rates`,
    {
      data: {
        vendorCapabilityId: caps[0],
        workTypeId: perimeter.id,
        unitPrice: 125,
        unit: "hour",
        notes: `WARWICK-PRIVATE-${stamp}`,
        capacity: 2,
      },
    },
  );
  expect(otherRate.status()).toBe(200);
  await pool.query(
    "INSERT INTO vendor_partner_service_offers (vendor_capability_id,partner_id,work_type_id,unit_price,unit,capacity,notes) VALUES ($1,$2,$3,85,'hour',2,$4)",
    [caps[1], flywheel.id, gatekeeping.id, `COMPETITOR-NOTE-${stamp}`],
  );
  return {
    stamp,
    flywheel,
    warwick,
    midcon,
    competitor,
    gatekeeping,
    perimeter,
    near,
    far,
    warwickSite,
    service,
    capability: caps[0],
    flywheelRate,
    partnerPage,
    vendorPage,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function draft(f: Fixture, site = f.near.id) {
  return {
    partnerId: f.flywheel.id,
    vendorId: f.midcon.id,
    workTypeId: f.gatekeeping.id,
    vendorCapabilityId: f.capability,
    vendorPartnerServiceOfferId: f.flywheelRate.id,
    siteLocationId: site,
    scope: `Synthetic gatekeeping ${f.stamp}`,
    afeCode: `E2E-AFE-${f.stamp}`,
    requestedStartAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    requestedEndAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    crewCount: 1,
    attachmentUrls: [],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}
async function search(
  f: Fixture,
  request: APIRequestContext,
  site = f.near.id,
) {
  return request.get(
    `${root}/partners/${f.flywheel.id}/work-types/${f.gatekeeping.id}/vendors?siteId=${site}`,
  );
}
async function openComparison(f: Fixture) {
  await f.partnerPage.goto("/partner-catalog");
  await f.partnerPage
    .getByTestId(`button-toggle-catalog-${f.gatekeeping.id}`)
    .click();
  const comparison = f.partnerPage.getByTestId(
    `marketplace-work-type-${f.gatekeeping.id}`,
  );
  await comparison
    .getByRole("combobox", { name: "Job site", exact: true })
    .selectOption(String(f.near.id));
  return comparison;
}

test("Gatekeeping and Perimeter Security match Gate Services; compare, send and accept exactly one ticket", async ({
  browser,
}, testInfo) => {
  const pool = createPool();
  try {
    const f = await fixture(pool, browser);
    const demand = await f.vendorPage.request.get(
      `${root}/vendors/${f.midcon.id}/matching-demand`,
    );
    expect(demand.status()).toBe(200);
    const items = (await demand.json()).items;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partnerId: f.flywheel.id,
          name: "Gatekeeping",
          ownOffer: expect.objectContaining({ unitPrice: "75.00" }),
        }),
        expect.objectContaining({
          partnerId: f.warwick.id,
          name: "Perimeter Security",
          ownOffer: expect.objectContaining({ unitPrice: "125.00" }),
        }),
      ]),
    );
    const comparison = await openComparison(f);
    const midcon = comparison.getByRole("region", {
      name: f.midcon.name,
      exact: true,
    });
    await expect(
      midcon.getByText("USD 75.00 / hour", { exact: true }),
    ).toBeVisible();
    await expect(
      midcon.getByText("Not yet rated", { exact: true }),
    ).toHaveCount(2);
    await expect(
      midcon.getByText("Gate Services", { exact: true }),
    ).toBeVisible();
    await comparison
      .getByRole("checkbox", { name: `Compare ${f.midcon.name}`, exact: true })
      .check();
    await comparison
      .getByRole("checkbox", {
        name: `Compare ${f.competitor.name}`,
        exact: true,
      })
      .check();
    await expect(
      comparison.getByRole("region", {
        name: "Vendor comparison",
        exact: true,
      }),
    ).toContainText(f.competitor.name);
    await f.partnerPage.screenshot({
      path: testInfo.outputPath("partner-comparison.png"),
      fullPage: true,
    });
    await comparison
      .getByRole("combobox", { name: "Job site", exact: true })
      .selectOption(String(f.far.id));
    await expect(
      midcon.getByText("Out of Service Area", { exact: true }),
    ).toBeVisible();
    await expect(
      midcon.getByRole("button", { name: "Prepare job offer", exact: true }),
    ).toBeDisabled();
    const bypass = await f.partnerPage.request.post(`${root}/job-offers`, {
      headers: { "Idempotency-Key": `outside-${f.stamp}` },
      data: draft(f, f.far.id),
    });
    expect(bypass.status()).toBe(409);
    expect((await bypass.json()).code).toBe("marketplace.out_of_service_area");
    await comparison
      .getByRole("combobox", { name: "Job site", exact: true })
      .selectOption(String(f.near.id));
    await midcon
      .getByRole("button", { name: "Prepare job offer", exact: true })
      .click();
    const form = comparison.getByRole("form", {
      name: "Job offer draft",
      exact: true,
    });
    const input = draft(f);
    await form.getByLabel("Scope of work", { exact: true }).fill(input.scope);
    await expect(form.getByLabel("AFE reference", { exact: true })).toHaveValue(input.afeCode);
    await expect(form.getByLabel("AFE reference", { exact: true })).toHaveAttribute("readonly", "");
    // datetime-local is intentionally entered as wall time; the UI serializes it.
    await form
      .getByLabel("Requested start", { exact: true })
      .fill(input.requestedStartAt.slice(0, 16));
    await form
      .getByLabel("Requested end", { exact: true })
      .fill(input.requestedEndAt.slice(0, 16));
    await form
      .getByLabel("Offer expires", { exact: true })
      .fill(input.expiresAt.slice(0, 16));
    await form
      .getByRole("button", { name: "Prepare draft", exact: true })
      .click();
    await expect(
      form.getByRole("region", { name: "Confirm job offer", exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT id FROM tickets WHERE vendor_id=$1 AND work_type_id=$2",
          [f.midcon.id, f.gatekeeping.id],
        )
      ).rows,
    ).toHaveLength(0);
    await form
      .getByRole("button", { name: "Confirm and send", exact: true })
      .click();
    await expect(
      form.getByText("Job offer sent.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT id FROM tickets WHERE vendor_id=$1 AND work_type_id=$2",
          [f.midcon.id, f.gatekeeping.id],
        )
      ).rows,
    ).toHaveLength(0);
    await f.vendorPage.goto("/vendor-catalog");
    const inbox = f.vendorPage.getByRole("region", {
      name: "Job offers",
      exact: true,
    });
    await inbox
      .getByRole("button", { name: "Review offer", exact: true })
      .click();
    await expect(
      inbox.getByRole("region", { name: "Confirm acceptance", exact: true }),
    ).toContainText("75.00");
    const current = (
      await (
        await f.vendorPage.request.get(
          `${root}/vendors/${f.midcon.id}/job-offers`,
        )
      ).json()
    ).items[0];
    await inbox
      .getByRole("button", { name: "Confirm and accept", exact: true })
      .click();
    await expect(f.vendorPage).toHaveURL(/\/tickets\/\d+$/);
    const accepted = await (
      await f.vendorPage.request.get(`${root}/job-offers/${current.id}`)
    ).json();
    expect(accepted).toMatchObject({
      status: "accepted",
      createdTicketId: expect.any(Number),
    });
    const retry = await f.vendorPage.request.post(
      `${root}/job-offers/${current.id}/accept`,
      {
        headers: { "Idempotency-Key": `retry-${f.stamp}` },
        data: { version: current.version },
      },
    );
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({
      ticketId: accepted.createdTicketId,
      replayed: true,
    });
    const tickets = await pool.query(
      "SELECT id,work_type_id,canonical_service_id,vendor_capability_id,vendor_partner_service_offer_id,status,lifecycle_state FROM tickets WHERE job_offer_id=$1",
      [current.id],
    );
    expect(tickets.rows).toEqual([
      {
        id: accepted.createdTicketId,
        work_type_id: f.gatekeeping.id,
        canonical_service_id: f.service,
        vendor_capability_id: f.capability,
        vendor_partner_service_offer_id: f.flywheelRate.id,
        status: "initiated",
        lifecycle_state: "pending_arrival",
      },
    ]);
    expect(
      (
        await pool.query(
          "SELECT id FROM job_offer_acceptance_snapshots WHERE job_offer_id=$1",
          [current.id],
        )
      ).rows,
    ).toHaveLength(1);
    const readback = await f.vendorPage.request.get(
      `/api/tickets/${accepted.createdTicketId}`,
    );
    expect(readback.status()).toBe(200);
    expect(await readback.json()).toMatchObject({
      id: accepted.createdTicketId,
      workTypeId: f.gatekeeping.id,
    });
    await f.vendorPage.screenshot({
      path: testInfo.outputPath("accepted-ticket.png"),
      fullPage: true,
    });
    await f.vendorPage.goto("/vendor-catalog");
    await expect(
      f.vendorPage.getByRole("link", {
        name: "Open tracking ticket",
        exact: true,
      }),
    ).toHaveAttribute("href", `/tickets/${accepted.createdTicketId}`);
  } finally {
    await pool.end();
  }
});

test("marketplace projections isolate competitor budgets, notes and unrelated partner rates; changed coverage blocks acceptance", async ({
  browser,
}) => {
  const pool = createPool();
  try {
    const f = await fixture(pool, browser);
    const demand = await f.vendorPage.request.get(
      `${root}/vendors/${f.midcon.id}/matching-demand`,
    );
    const serialized = JSON.stringify(await demand.json());
    expect(serialized).not.toContain(f.competitor.name);
    expect(serialized).not.toMatch(
      /9876543|PARTNER-PRIVATE|COMPETITOR-NOTE|estimatedPrice|privateNotes|competitors/,
    );
    expect(
      (
        await f.vendorPage.request.get(
          `${root}/vendors/${f.competitor.id}/partner-rates`,
        )
      ).status(),
    ).toBe(403);
    const comparison = await search(f, f.partnerPage.request);
    expect(comparison.status()).toBe(200);
    const projected = await comparison.json();
    expect(JSON.stringify(projected)).not.toMatch(
      /WARWICK-PRIVATE|PARTNER-PRIVATE|COMPETITOR-NOTE|125\.00/,
    );
    expect(
      projected.items.find(
        (row: { vendorId: number }) => row.vendorId === f.midcon.id,
      ).offer.unitPrice,
    ).toBe(75);
    expect(
      (
        await f.partnerPage.request.get(
          `${root}/partners/${f.warwick.id}/work-types/${f.perimeter.id}/vendors?siteId=${f.warwickSite.id}`,
        )
      ).status(),
    ).toBe(403);
    const created = await f.partnerPage.request.post(`${root}/job-offers`, {
      headers: { "Idempotency-Key": `changed-${f.stamp}` },
      data: draft(f),
    });
    expect(created.status()).toBe(201);
    const offer = await created.json();
    const sent = await f.partnerPage.request.post(
      `${root}/job-offers/${offer.id}/send`,
      { data: { version: offer.version } },
    );
    expect(sent.status()).toBe(200);
    const sentOffer = await sent.json();
    const narrowed = await f.vendorPage.request.put(
      `${root}/vendors/${f.midcon.id}/service-areas`,
      { data: { radiusMiles: 1 } },
    );
    expect(narrowed.status()).toBe(200);
    const blocked = await f.vendorPage.request.post(
      `${root}/job-offers/${offer.id}/accept`,
      {
        headers: { "Idempotency-Key": `accept-changed-${f.stamp}` },
        data: { version: sentOffer.version },
      },
    );
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).code).toBe("marketplace.out_of_service_area");
    expect(
      (
        await pool.query("SELECT id FROM tickets WHERE job_offer_id=$1", [
          offer.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await pool.query(
          "SELECT id FROM job_offer_acceptance_snapshots WHERE job_offer_id=$1",
          [offer.id],
        )
      ).rows,
    ).toHaveLength(0);
    const saved = await (
      await f.partnerPage.request.get(`${root}/job-offers/${offer.id}`)
    ).json();
    expect(saved).toMatchObject({ status: "offered", createdTicketId: null });
  } finally {
    await pool.end();
  }
});

test("organization flags default disabled and site denial overrides an enabled organization", async ({
  browser,
}) => {
  const pool = createPool();
  try {
    const f = await fixture(pool, browser);
    await pool.query(
      "UPDATE capability_flags SET enabled=false WHERE owner_org_type='vendor' AND owner_org_id=$1 AND flag_name='semantic_service_marketplace' AND site_id IS NULL",
      [f.midcon.id],
    );
    const denied = await f.vendorPage.request.get(
      `${root}/vendors/${f.midcon.id}/capabilities`,
    );
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe("marketplace.disabled");
    await pool.query(
      "INSERT INTO capability_flags (owner_org_type,owner_org_id,site_id,flag_name,enabled) VALUES ('partner',$1,$2,'semantic_service_marketplace',false)",
      [f.flywheel.id, f.near.id],
    );
    const blockedSite = await search(f, f.partnerPage.request);
    expect(blockedSite.status()).toBe(403);
    expect((await blockedSite.json()).code).toBe("marketplace.disabled");
    expect((await search(f, f.partnerPage.request, f.far.id)).status()).toBe(
      200,
    );
    await pool.query(
      "UPDATE capability_flags SET enabled=false WHERE owner_org_type='partner' AND owner_org_id=$1 AND flag_name='semantic_service_marketplace' AND site_id IS NULL",
      [f.flywheel.id],
    );
    for (const [side, orgId, page] of [
      ["partner", f.flywheel.id, f.partnerPage],
      ["vendor", f.midcon.id, f.vendorPage],
    ] as const) {
      await pool.query(
        "INSERT INTO capability_flags (owner_org_type,owner_org_id,site_id,flag_name,enabled) VALUES ($1,$2,$3,'semantic_service_marketplace',true)",
        [side, orgId, f.far.id],
      );
      const forgedList = await page.request.get(
        `${root}/${side}s/${orgId}/job-offers`,
        {
          params: { siteId: f.far.id, siteLocationId: f.far.id },
          data: { siteLocationId: f.far.id },
        },
      );
      expect(forgedList.status()).toBe(403);
      expect((await forgedList.json()).code).toBe("marketplace.disabled");
    }
    const newVendor = await createVendor(pool, {
      name: `Unflagged ${f.stamp}`,
      contactName: "Synthetic",
      contactEmail: `unflagged-${f.stamp}@example.invalid`,
    });
    const adminPage = await browser.newPage({ baseURL });
    await login(adminPage, { username: "admin", password: "vndrly123" });
    const support = await adminPage.request.get(
      `${root}/vendors/${newVendor.id}/capabilities`,
    );
    expect(support.status()).toBe(403);
    expect((await support.json()).code).toBe("marketplace.disabled");
  } finally {
    await pool.end();
  }
});
