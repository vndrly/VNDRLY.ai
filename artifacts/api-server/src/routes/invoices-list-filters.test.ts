import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Coverage for GET /invoices list filters — specifically the new
// `pushed=qbo|oa|none|any` query param backed by EXISTS / NOT EXISTS
// subqueries against accounting_pushed_invoices, plus its interaction with
// the RBAC scoping branch (vendor/partner sessions only see their own rows
// even when the filter is applied).
//
// Like the other invoice integration suites this requires a real Postgres
// with the schema pushed; without one, the suite is skipped so unit-test CI
// still passes.
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  if (DATABASE_URL.includes("test:test@localhost")) return false;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

const MARKER = `listf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface SeedIds {
  adminUserId: number;
  vendorAId: number;
  vendorBId: number;
  partnerXId: number;
  partnerYId: number;
  // Invoice ids by their push state so assertions stay readable.
  invQboOnlyId: number;
  invOaOnlyId: number;
  invBothId: number;
  invNoneId: number;
  // Vendor B invoice (different vendor, no push rows) — used to verify
  // RBAC scoping when vendor A applies pushed=none.
  invVendorBNoneId: number;
  // Partner Y invoice — used to verify partner scoping.
  invPartnerYNoneId: number;
  invQboOnlyNumber: string;
  invOaOnlyNumber: string;
  invBothNumber: string;
  invNoneNumber: string;
  invVendorBNoneNumber: string;
  invPartnerYNoneNumber: string;
}

let seeded: SeedIds | null = null;
let dbModule: typeof import("@workspace/db");
let app: express.Express;

function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin",
  });
}

function vendorCookie(userId: number, vendorId: number): string {
  return buildTestCookie({
    userId,
    role: "vendor",
    vendorId,
    displayName: "Vendor",
  });
}

function partnerCookie(userId: number, partnerId: number): string {
  return buildTestCookie({
    userId,
    role: "partner",
    partnerId,
    displayName: "Partner",
  });
}

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    invoicesTable,
    accountingPushedInvoicesTable,
    usersTable,
  } = dbModule;

  const [partnerX] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-PartnerX`,
      contactName: "AP",
      contactEmail: `${MARKER}-x@example.com`,
      billingAddress: "1 Main",
      physicalAddress: "1 Main",
      businessPhone: "5550000000",
    })
    .returning({ id: partnersTable.id });

  const [partnerY] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-PartnerY`,
      contactName: "AP",
      contactEmail: `${MARKER}-y@example.com`,
      billingAddress: "2 Main",
      physicalAddress: "2 Main",
      businessPhone: "5550000001",
    })
    .returning({ id: partnersTable.id });

  const [vendorA] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-VendorA`,
      contactName: "Owner",
      contactEmail: `${MARKER}-a@example.com`,
      billingAddress: "1 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  const [vendorB] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-VendorB`,
      contactName: "Owner",
      contactEmail: `${MARKER}-b@example.com`,
      billingAddress: "2 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  const baseInvoiceFields = {
    cadence: "per_ticket" as const,
    status: "sent" as const,
    periodStart: new Date(Date.UTC(2026, 5, 1)),
    periodEnd: new Date(Date.UTC(2026, 5, 30)),
    subtotal: "100.00",
    taxTotal: "0.00",
    total: "100.00",
  };

  const invQboOnlyNumber = `${MARKER}-QBO`;
  const invOaOnlyNumber = `${MARKER}-OA`;
  const invBothNumber = `${MARKER}-BOTH`;
  const invNoneNumber = `${MARKER}-NONE`;
  const invVendorBNoneNumber = `${MARKER}-VB-NONE`;
  const invPartnerYNoneNumber = `${MARKER}-PY-NONE`;

  // Vendor A x Partner X invoices in each push state.
  const [invQbo] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceFields,
      invoiceNumber: invQboOnlyNumber,
      vendorId: vendorA.id,
      partnerId: partnerX.id,
    })
    .returning({ id: invoicesTable.id });
  const [invOa] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceFields,
      invoiceNumber: invOaOnlyNumber,
      vendorId: vendorA.id,
      partnerId: partnerX.id,
    })
    .returning({ id: invoicesTable.id });
  const [invBoth] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceFields,
      invoiceNumber: invBothNumber,
      vendorId: vendorA.id,
      partnerId: partnerX.id,
    })
    .returning({ id: invoicesTable.id });
  const [invNone] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceFields,
      invoiceNumber: invNoneNumber,
      vendorId: vendorA.id,
      partnerId: partnerX.id,
    })
    .returning({ id: invoicesTable.id });

  // Vendor B (different vendor) — no push rows. Used to verify a vendor A
  // session never sees vendor B's invoices regardless of `pushed` filter.
  const [invVendorBNone] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceFields,
      invoiceNumber: invVendorBNoneNumber,
      vendorId: vendorB.id,
      partnerId: partnerX.id,
    })
    .returning({ id: invoicesTable.id });

  // Partner Y — used to verify a partner X session never sees partner Y's
  // invoices regardless of `pushed` filter.
  const [invPartnerYNone] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceFields,
      invoiceNumber: invPartnerYNoneNumber,
      vendorId: vendorA.id,
      partnerId: partnerY.id,
    })
    .returning({ id: invoicesTable.id });

  // Push rows. Natural key is (vendor_id, provider, invoice_number).
  await db.insert(accountingPushedInvoicesTable).values([
    {
      vendorId: vendorA.id,
      provider: "qbo",
      invoiceNumber: invQboOnlyNumber,
      externalInvoiceId: "qbo-1",
      externalDocNumber: invQboOnlyNumber,
    },
    {
      vendorId: vendorA.id,
      provider: "oa",
      invoiceNumber: invOaOnlyNumber,
      externalInvoiceId: "oa-1",
      externalDocNumber: invOaOnlyNumber,
    },
    {
      vendorId: vendorA.id,
      provider: "qbo",
      invoiceNumber: invBothNumber,
      externalInvoiceId: "qbo-2",
      externalDocNumber: invBothNumber,
    },
    {
      vendorId: vendorA.id,
      provider: "oa",
      invoiceNumber: invBothNumber,
      externalInvoiceId: "oa-2",
      externalDocNumber: invBothNumber,
    },
  ]);

  const [adminUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-admin@example.com`,
      passwordHash: "x",
      role: "admin",
      displayName: "Admin",
    })
    .returning({ id: usersTable.id });

  return {
    adminUserId: adminUser.id,
    vendorAId: vendorA.id,
    vendorBId: vendorB.id,
    partnerXId: partnerX.id,
    partnerYId: partnerY.id,
    invQboOnlyId: invQbo.id,
    invOaOnlyId: invOa.id,
    invBothId: invBoth.id,
    invNoneId: invNone.id,
    invVendorBNoneId: invVendorBNone.id,
    invPartnerYNoneId: invPartnerYNone.id,
    invQboOnlyNumber,
    invOaOnlyNumber,
    invBothNumber,
    invNoneNumber,
    invVendorBNoneNumber,
    invPartnerYNoneNumber,
  };
}

async function cleanup(): Promise<void> {
  const { db } = dbModule;
  await db.execute(
    sql`delete from accounting_pushed_invoices where invoice_number like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from invoice_lines where invoice_id in (select id from invoices where invoice_number like ${MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from invoices where invoice_number like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from users where username like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from vendors where name like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from partners where name like ${MARKER + "-%"}`,
  );
}

interface ListItem {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  partnerId: number;
}

/** Filter the list response down to just the invoices this suite seeded so
 *  unrelated dev-DB rows don't pollute assertions. */
function ourIds(items: ListItem[]): number[] {
  if (!seeded) return [];
  const ours = new Set([
    seeded.invQboOnlyId,
    seeded.invOaOnlyId,
    seeded.invBothId,
    seeded.invNoneId,
    seeded.invVendorBNoneId,
    seeded.invPartnerYNoneId,
  ]);
  return items.filter((i) => ours.has(i.id)).map((i) => i.id);
}

describe.runIf(haveRealDb)("GET /invoices — pushed filter + RBAC", () => {
  beforeAll(async () => {
    dbModule = await import("@workspace/db");
    const invoicesRouter = (await import("./invoices")).default;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(invoicesRouter);
    attachTestErrorMiddleware(app);
    seeded = await seed();
  }, 30_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      seeded = null;
    }
  });

  it("pushed=qbo returns only invoices with a QBO push row", async () => {
    const res = await request(app)
      .get("/invoices")
      .query({ vendorId: seeded!.vendorAId, pushed: "qbo", limit: 500 })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(res, 200);
    const ids = ourIds(res.body.items as ListItem[]).sort((a, b) => a - b);
    expect(ids).toEqual(
      [seeded!.invQboOnlyId, seeded!.invBothId].sort((a, b) => a - b),
    );
  });

  it("pushed=oa returns only invoices with an OA push row", async () => {
    const res = await request(app)
      .get("/invoices")
      .query({ vendorId: seeded!.vendorAId, pushed: "oa", limit: 500 })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(res, 200);
    const ids = ourIds(res.body.items as ListItem[]).sort((a, b) => a - b);
    expect(ids).toEqual(
      [seeded!.invOaOnlyId, seeded!.invBothId].sort((a, b) => a - b),
    );
  });

  it("pushed=none returns only invoices with no push row for either provider", async () => {
    const res = await request(app)
      .get("/invoices")
      .query({ vendorId: seeded!.vendorAId, pushed: "none", limit: 500 })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(res, 200);
    const ids = ourIds(res.body.items as ListItem[]).sort((a, b) => a - b);
    // Only the vendor-A "none" invoice and vendor-A partner-Y "none"
    // invoice are eligible (vendorId=vendorA filter excludes vendor B's
    // invoice, and the QBO / OA / BOTH ones all have push rows).
    expect(ids).toEqual(
      [seeded!.invNoneId, seeded!.invPartnerYNoneId].sort((a, b) => a - b),
    );
  });

  it("pushed=any returns everything visible (same as omitting the filter)", async () => {
    const withAny = await request(app)
      .get("/invoices")
      .query({ vendorId: seeded!.vendorAId, pushed: "any", limit: 500 })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(withAny, 200);
    const withoutFilter = await request(app)
      .get("/invoices")
      .query({ vendorId: seeded!.vendorAId, limit: 500 })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(withoutFilter, 200);

    const anyIds = ourIds(withAny.body.items as ListItem[]).sort(
      (a, b) => a - b,
    );
    const noneFilterIds = ourIds(withoutFilter.body.items as ListItem[]).sort(
      (a, b) => a - b,
    );
    const expectedAll = [
      seeded!.invQboOnlyId,
      seeded!.invOaOnlyId,
      seeded!.invBothId,
      seeded!.invNoneId,
      seeded!.invPartnerYNoneId,
    ].sort((a, b) => a - b);
    expect(anyIds).toEqual(expectedAll);
    expect(noneFilterIds).toEqual(expectedAll);
  });

  it("invoices that were pushed to BOTH providers appear exactly once (no row blow-up)", async () => {
    // Regression guard: an inner join to accounting_pushed_invoices would
    // duplicate the BOTH invoice. The route uses EXISTS subqueries, so
    // each invoice should appear at most once in any single response.
    const res = await request(app)
      .get("/invoices")
      .query({ vendorId: seeded!.vendorAId, pushed: "qbo", limit: 500 })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(res, 200);
    const items = res.body.items as ListItem[];
    const bothCount = items.filter((i) => i.id === seeded!.invBothId).length;
    expect(bothCount).toBe(1);
  });

  it("pushed=invalid is rejected with 400", async () => {
    const res = await request(app)
      .get("/invoices")
      .query({ pushed: "invalid" })
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_input");
  });

  it("vendor session only sees its own invoices when pushed=none is applied", async () => {
    // Vendor A session should never see vendor B's "none"-state invoice
    // even though that invoice technically also satisfies pushed=none.
    const res = await request(app)
      .get("/invoices")
      .query({ pushed: "none", limit: 500 })
      .set(
        "Cookie",
        vendorCookie(seeded!.adminUserId, seeded!.vendorAId),
      );
    expectStatus(res, 200);
    const items = res.body.items as ListItem[];
    const ids = ourIds(items).sort((a, b) => a - b);
    expect(ids).toEqual(
      [seeded!.invNoneId, seeded!.invPartnerYNoneId].sort((a, b) => a - b),
    );
    // Vendor B's invoice must not leak through.
    expect(items.find((i) => i.id === seeded!.invVendorBNoneId)).toBeUndefined();
    // And every visible row must belong to vendor A.
    for (const item of items) {
      expect(item.vendorId).toBe(seeded!.vendorAId);
    }
  });

  it("vendor session sees its own pushed=qbo rows but not other vendors'", async () => {
    const res = await request(app)
      .get("/invoices")
      .query({ pushed: "qbo", limit: 500 })
      .set(
        "Cookie",
        vendorCookie(seeded!.adminUserId, seeded!.vendorAId),
      );
    expectStatus(res, 200);
    const ids = ourIds(res.body.items as ListItem[]).sort((a, b) => a - b);
    expect(ids).toEqual(
      [seeded!.invQboOnlyId, seeded!.invBothId].sort((a, b) => a - b),
    );
    // Vendor B has no QBO push rows; ensure vendor B's invoice is absent.
    const items = res.body.items as ListItem[];
    expect(
      items.find((i) => i.id === seeded!.invVendorBNoneId),
    ).toBeUndefined();
  });

  it("partner session only sees invoices for its own partnerId when pushed=none is applied", async () => {
    // Partner X session should NOT see partner Y's invoice even though
    // it also satisfies pushed=none.
    const res = await request(app)
      .get("/invoices")
      .query({ pushed: "none", limit: 500 })
      .set(
        "Cookie",
        partnerCookie(seeded!.adminUserId, seeded!.partnerXId),
      );
    expectStatus(res, 200);
    const items = res.body.items as ListItem[];
    const ids = ourIds(items).sort((a, b) => a - b);
    // Partner X's "none"-state invoices are: invNone (vendorA/partnerX)
    // and invVendorBNone (vendorB/partnerX). Partner Y's invoice must NOT
    // appear.
    expect(ids).toEqual(
      [seeded!.invNoneId, seeded!.invVendorBNoneId].sort((a, b) => a - b),
    );
    expect(
      items.find((i) => i.id === seeded!.invPartnerYNoneId),
    ).toBeUndefined();
    for (const item of items) {
      expect(item.partnerId).toBe(seeded!.partnerXId);
    }
  });

  it("partner session sees pushed=qbo rows for its partnerId only", async () => {
    const res = await request(app)
      .get("/invoices")
      .query({ pushed: "qbo", limit: 500 })
      .set(
        "Cookie",
        partnerCookie(seeded!.adminUserId, seeded!.partnerXId),
      );
    expectStatus(res, 200);
    const ids = ourIds(res.body.items as ListItem[]).sort((a, b) => a - b);
    expect(ids).toEqual(
      [seeded!.invQboOnlyId, seeded!.invBothId].sort((a, b) => a - b),
    );
    for (const item of res.body.items as ListItem[]) {
      expect(item.partnerId).toBe(seeded!.partnerXId);
    }
  });
});
