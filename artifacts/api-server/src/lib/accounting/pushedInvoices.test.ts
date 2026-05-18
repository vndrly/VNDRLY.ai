// Integration coverage for `loadPushedStatusForInvoices` — the bulk
// helper that the invoices list/detail routes use to surface each
// invoice's per-provider QBO/OA push status without an N+1 query.
//
// We seed real rows in `accounting_pushed_invoices` against the test
// Postgres harness so we exercise the real WHERE/OR construction
// (per-vendor `inArray` predicates ORed together). We also drive a
// route-level GET /invoices through supertest so a regression that
// drops the `pushedTo` envelope or wires the wrong key shape would be
// caught here.
//
// Skips with a no-op describe when DATABASE_URL is unavailable so the
// pure-unit suite still passes on workstations / CI without a DB.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildTestCookie } from "../../test-utils/session";

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  // Ignore the placeholder URL the unit-test setup writes when no DB exists.
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

// All seeded rows carry this marker so cleanup can target only what the
// suite created without touching pre-existing data in the dev DB.
const MARKER = `pushinv-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

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

describe.runIf(haveRealDb)("loadPushedStatusForInvoices (real DB)", () => {
  let dbm: typeof import("@workspace/db");
  let loadPushedStatusForInvoices: typeof import("./pushedInvoices").loadPushedStatusForInvoices;

  // Two vendors with rows + one vendor with NO push rows so we can
  // assert it never appears in the result map.
  let vendorAId = 0;
  let vendorBId = 0;
  let vendorEmptyId = 0;

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    ({ loadPushedStatusForInvoices } = await import("./pushedInvoices"));

    const [vA] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-A`,
        contactName: "A",
        contactEmail: `${MARKER}-a@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    const [vB] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-B`,
        contactName: "B",
        contactEmail: `${MARKER}-b@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    const [vEmpty] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-Empty`,
        contactName: "E",
        contactEmail: `${MARKER}-e@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    vendorAId = vA.id;
    vendorBId = vB.id;
    vendorEmptyId = vEmpty.id;

    // Vendor A: INV-A1 pushed to BOTH providers, INV-A2 only to QBO.
    // Vendor B: INV-B1 only to OA. Same invoice number reused across
    // vendors so we can prove the result key really is namespaced by
    // vendorId.
    await dbm.db.insert(dbm.accountingPushedInvoicesTable).values([
      {
        vendorId: vendorAId,
        provider: "qbo",
        invoiceNumber: "INV-A1",
        externalInvoiceId: "qbo-A1",
        externalDocNumber: "DOC-A1",
      },
      {
        vendorId: vendorAId,
        provider: "oa",
        invoiceNumber: "INV-A1",
        externalInvoiceId: "oa-A1",
        externalDocNumber: "DOC-A1",
      },
      {
        vendorId: vendorAId,
        provider: "qbo",
        invoiceNumber: "INV-A2",
        externalInvoiceId: "qbo-A2",
        externalDocNumber: "DOC-A2",
      },
      // Reuse "INV-A1" under vendor B but to OA only — proves the
      // helper does not bleed across vendors.
      {
        vendorId: vendorBId,
        provider: "oa",
        invoiceNumber: "INV-A1",
        externalInvoiceId: "oa-B-collide",
        externalDocNumber: "DOC-B-collide",
      },
      {
        vendorId: vendorBId,
        provider: "oa",
        invoiceNumber: "INV-B1",
        externalInvoiceId: "oa-B1",
        externalDocNumber: "DOC-B1",
      },
    ]);
  });

  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.execute(
      sql`delete from accounting_pushed_invoices where vendor_id in (${vendorAId}, ${vendorBId}, ${vendorEmptyId})`,
    );
    await dbm.db.execute(
      sql`delete from vendors where id in (${vendorAId}, ${vendorBId}, ${vendorEmptyId})`,
    );
  });

  it("returns an empty map for empty input without hitting the DB", async () => {
    const result = await loadPushedStatusForInvoices([]);
    expect(result.size).toBe(0);
  });

  it("returns a single (vendor, invoice) lookup with the right provider populated", async () => {
    const result = await loadPushedStatusForInvoices([
      { vendorId: vendorAId, invoiceNumber: "INV-A2" },
    ]);
    expect(result.size).toBe(1);
    const entry = result.get(`${vendorAId}:INV-A2`);
    expect(entry).toBeDefined();
    expect(entry!.qbo).not.toBeNull();
    expect(entry!.qbo!.externalInvoiceId).toBe("qbo-A2");
    expect(entry!.qbo!.externalDocNumber).toBe("DOC-A2");
    // pushedAt is serialized as an ISO string for the wire envelope.
    expect(typeof entry!.qbo!.pushedAt).toBe("string");
    expect(() => new Date(entry!.qbo!.pushedAt).toISOString()).not.toThrow();
    // No OA push ever happened for INV-A2 → null bucket.
    expect(entry!.oa).toBeNull();
  });

  it("populates BOTH providers when an invoice has been pushed to qbo and oa", async () => {
    const result = await loadPushedStatusForInvoices([
      { vendorId: vendorAId, invoiceNumber: "INV-A1" },
    ]);
    const entry = result.get(`${vendorAId}:INV-A1`);
    expect(entry).toBeDefined();
    expect(entry!.qbo).not.toBeNull();
    expect(entry!.qbo!.externalInvoiceId).toBe("qbo-A1");
    expect(entry!.oa).not.toBeNull();
    expect(entry!.oa!.externalInvoiceId).toBe("oa-A1");
  });

  it("scopes results per vendor when the same invoice number exists under multiple vendors", async () => {
    // Both vendors have a row under invoice number "INV-A1" but with
    // different providers/external ids. The helper must keep them
    // separated by the `vendorId:invoiceNumber` key.
    const result = await loadPushedStatusForInvoices([
      { vendorId: vendorAId, invoiceNumber: "INV-A1" },
      { vendorId: vendorBId, invoiceNumber: "INV-A1" },
    ]);
    expect(result.size).toBe(2);

    const aEntry = result.get(`${vendorAId}:INV-A1`)!;
    expect(aEntry.qbo!.externalInvoiceId).toBe("qbo-A1");
    expect(aEntry.oa!.externalInvoiceId).toBe("oa-A1");

    const bEntry = result.get(`${vendorBId}:INV-A1`)!;
    // Vendor B only ever pushed this number to OA.
    expect(bEntry.qbo).toBeNull();
    expect(bEntry.oa!.externalInvoiceId).toBe("oa-B-collide");
  });

  it("returns lookups across multiple vendors in a single round-trip", async () => {
    const result = await loadPushedStatusForInvoices([
      { vendorId: vendorAId, invoiceNumber: "INV-A1" },
      { vendorId: vendorAId, invoiceNumber: "INV-A2" },
      { vendorId: vendorBId, invoiceNumber: "INV-B1" },
    ]);
    expect(result.size).toBe(3);
    expect(result.get(`${vendorAId}:INV-A1`)!.qbo!.externalInvoiceId).toBe(
      "qbo-A1",
    );
    expect(result.get(`${vendorAId}:INV-A2`)!.qbo!.externalInvoiceId).toBe(
      "qbo-A2",
    );
    expect(result.get(`${vendorBId}:INV-B1`)!.oa!.externalInvoiceId).toBe(
      "oa-B1",
    );
  });

  it("returns no entries for vendors / invoice numbers with zero push rows", async () => {
    // Asks for invoice numbers under the empty vendor and an unknown
    // invoice number under vendor A. Neither has any rows → the map is
    // empty rather than carrying placeholder buckets. (The route layer
    // is responsible for filling in the `{ qbo: null, oa: null }`
    // placeholder for unmatched invoices; the helper does not.)
    const result = await loadPushedStatusForInvoices([
      { vendorId: vendorEmptyId, invoiceNumber: "INV-X" },
      { vendorId: vendorEmptyId, invoiceNumber: "INV-Y" },
      { vendorId: vendorAId, invoiceNumber: "INV-DOES-NOT-EXIST" },
    ]);
    expect(result.size).toBe(0);
    expect(result.get(`${vendorEmptyId}:INV-X`)).toBeUndefined();
    expect(result.get(`${vendorAId}:INV-DOES-NOT-EXIST`)).toBeUndefined();
  });
});

describe.runIf(haveRealDb)(
  "GET /invoices populates pushedTo from accounting_pushed_invoices",
  () => {
    let dbm: typeof import("@workspace/db");
    let app: express.Express;

    let adminUserId = 0;
    let vendorId = 0;
    let partnerId = 0;
    // Two invoices: one with QBO+OA push rows, one with no push rows so
    // we can assert the route still returns the empty `{qbo:null,oa:null}`
    // envelope rather than dropping the field.
    let pushedInvoiceId = 0;
    let unpushedInvoiceId = 0;
    const PUSHED_NUMBER = `${MARKER}-PUSHED`;
    const UNPUSHED_NUMBER = `${MARKER}-UNPUSHED`;

    beforeAll(async () => {
      dbm = await import("@workspace/db");
      const invoicesRouter = (await import("../../routes/invoices")).default;

      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use(invoicesRouter);

      const [vendor] = await dbm.db
        .insert(dbm.vendorsTable)
        .values({
          name: `${MARKER}-RouteVendor`,
          contactName: "RV",
          contactEmail: `${MARKER}-rv@example.com`,
        })
        .returning({ id: dbm.vendorsTable.id });
      vendorId = vendor.id;

      const [partner] = await dbm.db
        .insert(dbm.partnersTable)
        .values({
          name: `${MARKER}-RoutePartner`,
          contactName: "RP",
          contactEmail: `${MARKER}-rp@example.com`,
        })
        .returning({ id: dbm.partnersTable.id });
      partnerId = partner.id;

      const [pushedInv] = await dbm.db
        .insert(dbm.invoicesTable)
        .values({
          invoiceNumber: PUSHED_NUMBER,
          vendorId,
          partnerId,
          cadence: "per_ticket",
          status: "sent",
          periodStart: new Date("2026-03-01T00:00:00Z"),
          periodEnd: new Date("2026-03-31T23:59:59Z"),
          subtotal: "100.00",
          taxTotal: "10.00",
          total: "110.00",
        })
        .returning({ id: dbm.invoicesTable.id });
      pushedInvoiceId = pushedInv.id;

      const [unpushedInv] = await dbm.db
        .insert(dbm.invoicesTable)
        .values({
          invoiceNumber: UNPUSHED_NUMBER,
          vendorId,
          partnerId,
          cadence: "per_ticket",
          status: "draft",
          periodStart: new Date("2026-04-01T00:00:00Z"),
          periodEnd: new Date("2026-04-30T23:59:59Z"),
          subtotal: "200.00",
          taxTotal: "0.00",
          total: "200.00",
        })
        .returning({ id: dbm.invoicesTable.id });
      unpushedInvoiceId = unpushedInv.id;

      await dbm.db.insert(dbm.accountingPushedInvoicesTable).values([
        {
          vendorId,
          provider: "qbo",
          invoiceNumber: PUSHED_NUMBER,
          externalInvoiceId: "qbo-route-1",
          externalDocNumber: PUSHED_NUMBER,
        },
        {
          vendorId,
          provider: "oa",
          invoiceNumber: PUSHED_NUMBER,
          externalInvoiceId: "oa-route-1",
          externalDocNumber: PUSHED_NUMBER,
        },
      ]);

      const [admin] = await dbm.db
        .insert(dbm.usersTable)
        .values({
          username: `${MARKER}-admin@example.com`,
          passwordHash: "x",
          role: "admin",
          displayName: "Admin",
        })
        .returning({ id: dbm.usersTable.id });
      adminUserId = admin.id;
    }, 30_000);

    afterAll(async () => {
      if (!dbm) return;
      await dbm.db.execute(
        sql`delete from accounting_pushed_invoices where vendor_id = ${vendorId}`,
      );
      await dbm.db.execute(
        sql`delete from invoices where invoice_number in (${PUSHED_NUMBER}, ${UNPUSHED_NUMBER})`,
      );
      if (adminUserId) {
        await dbm.db.execute(
          sql`delete from users where id = ${adminUserId}`,
        );
      }
      if (vendorId) {
        await dbm.db.execute(sql`delete from vendors where id = ${vendorId}`);
      }
      if (partnerId) {
        await dbm.db.execute(sql`delete from partners where id = ${partnerId}`);
      }
    });

    it("returns pushedTo with both providers populated for a pushed invoice and null buckets for an unpushed one", async () => {
      const res = await request(app)
        .get("/invoices")
        .query({ vendorId, partnerId })
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);

      const items = res.body.items as Array<{
        invoiceNumber: string;
        pushedTo: {
          qbo: {
            pushedAt: string;
            externalInvoiceId: string | null;
            externalDocNumber: string | null;
          } | null;
          oa: {
            pushedAt: string;
            externalInvoiceId: string | null;
            externalDocNumber: string | null;
          } | null;
        };
      }>;

      const pushed = items.find((i) => i.invoiceNumber === PUSHED_NUMBER);
      const unpushed = items.find((i) => i.invoiceNumber === UNPUSHED_NUMBER);
      expect(pushed).toBeDefined();
      expect(unpushed).toBeDefined();

      // Pushed invoice has both providers populated with the seeded
      // external ids.
      expect(pushed!.pushedTo.qbo).not.toBeNull();
      expect(pushed!.pushedTo.qbo!.externalInvoiceId).toBe("qbo-route-1");
      expect(pushed!.pushedTo.qbo!.externalDocNumber).toBe(PUSHED_NUMBER);
      expect(typeof pushed!.pushedTo.qbo!.pushedAt).toBe("string");

      expect(pushed!.pushedTo.oa).not.toBeNull();
      expect(pushed!.pushedTo.oa!.externalInvoiceId).toBe("oa-route-1");
      expect(pushed!.pushedTo.oa!.externalDocNumber).toBe(PUSHED_NUMBER);

      // Unpushed invoice still carries the envelope (so the frontend
      // can render unconditionally) but with both buckets null.
      expect(unpushed!.pushedTo).toEqual({ qbo: null, oa: null });
    });

    it("uses pushedInvoiceId/unpushedInvoiceId fixtures so cleanup can target them", () => {
      // Sanity: ids should be non-zero so the afterAll DELETEs target
      // the rows we created. Guards against a regression where the
      // beforeAll inserts get re-ordered and forget to capture an id.
      expect(pushedInvoiceId).toBeGreaterThan(0);
      expect(unpushedInvoiceId).toBeGreaterThan(0);
    });
  },
);

describe.runIf(haveRealDb)(
  "GET /invoices scopes pushedTo to the caller's own invoices",
  () => {
    // Pins the RBAC contract that vendor and partner sessions only ever
    // receive `pushedTo` data for invoices they already have access to.
    // A regression that widened the WHERE clause in GET /invoices would
    // otherwise silently leak push timestamps and external doc numbers
    // (the QBO/OA invoice id and DocNumber) across vendor/partner
    // boundaries — which is the exact data this contract is meant to
    // gate.
    let dbm: typeof import("@workspace/db");
    let app: express.Express;

    // Two vendors and two partners, each with their own invoice + push
    // rows so we can assert vendor1 never sees vendor2's pushedTo (and
    // vice versa) and the same for partners.
    let vendor1Id = 0;
    let vendor2Id = 0;
    let partner1Id = 0;
    let partner2Id = 0;
    let vendor1UserId = 0;
    let vendor2UserId = 0;
    let partner1UserId = 0;
    let partner2UserId = 0;
    const V1_NUMBER = `${MARKER}-V1-INV`;
    const V2_NUMBER = `${MARKER}-V2-INV`;
    const P1_NUMBER = `${MARKER}-P1-INV`;
    const P2_NUMBER = `${MARKER}-P2-INV`;

    beforeAll(async () => {
      dbm = await import("@workspace/db");
      const invoicesRouter = (await import("../../routes/invoices")).default;

      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use(invoicesRouter);

      // Two vendors with one shared partner per side — what matters is
      // that each invoice is owned by a distinct (vendor, partner) tuple
      // so vendor1's session and partner1's session each scope to a
      // single row.
      const [v1] = await dbm.db
        .insert(dbm.vendorsTable)
        .values({
          name: `${MARKER}-Vendor1`,
          contactName: "V1",
          contactEmail: `${MARKER}-v1@example.com`,
        })
        .returning({ id: dbm.vendorsTable.id });
      const [v2] = await dbm.db
        .insert(dbm.vendorsTable)
        .values({
          name: `${MARKER}-Vendor2`,
          contactName: "V2",
          contactEmail: `${MARKER}-v2@example.com`,
        })
        .returning({ id: dbm.vendorsTable.id });
      vendor1Id = v1.id;
      vendor2Id = v2.id;

      const [p1] = await dbm.db
        .insert(dbm.partnersTable)
        .values({
          name: `${MARKER}-Partner1`,
          contactName: "P1",
          contactEmail: `${MARKER}-p1@example.com`,
        })
        .returning({ id: dbm.partnersTable.id });
      const [p2] = await dbm.db
        .insert(dbm.partnersTable)
        .values({
          name: `${MARKER}-Partner2`,
          contactName: "P2",
          contactEmail: `${MARKER}-p2@example.com`,
        })
        .returning({ id: dbm.partnersTable.id });
      partner1Id = p1.id;
      partner2Id = p2.id;

      // Vendor1 + Partner1 share invoice V1_NUMBER; Vendor2 + Partner2
      // share invoice V2_NUMBER. We also create a P1_NUMBER under
      // (Vendor1, Partner1) and P2_NUMBER under (Vendor2, Partner2) so
      // each partner has a distinct invoice number to look for. This
      // way the vendor and partner assertions are checking different
      // scoping axes (vendor_id vs partner_id) rather than the same row
      // by coincidence.
      await dbm.db.insert(dbm.invoicesTable).values([
        {
          invoiceNumber: V1_NUMBER,
          vendorId: vendor1Id,
          partnerId: partner1Id,
          cadence: "per_ticket",
          status: "sent",
          periodStart: new Date("2026-03-01T00:00:00Z"),
          periodEnd: new Date("2026-03-31T23:59:59Z"),
          subtotal: "100.00",
          taxTotal: "0.00",
          total: "100.00",
        },
        {
          invoiceNumber: V2_NUMBER,
          vendorId: vendor2Id,
          partnerId: partner2Id,
          cadence: "per_ticket",
          status: "sent",
          periodStart: new Date("2026-03-01T00:00:00Z"),
          periodEnd: new Date("2026-03-31T23:59:59Z"),
          subtotal: "200.00",
          taxTotal: "0.00",
          total: "200.00",
        },
        {
          invoiceNumber: P1_NUMBER,
          vendorId: vendor1Id,
          partnerId: partner1Id,
          cadence: "per_ticket",
          status: "sent",
          periodStart: new Date("2026-04-01T00:00:00Z"),
          periodEnd: new Date("2026-04-30T23:59:59Z"),
          subtotal: "150.00",
          taxTotal: "0.00",
          total: "150.00",
        },
        {
          invoiceNumber: P2_NUMBER,
          vendorId: vendor2Id,
          partnerId: partner2Id,
          cadence: "per_ticket",
          status: "sent",
          periodStart: new Date("2026-04-01T00:00:00Z"),
          periodEnd: new Date("2026-04-30T23:59:59Z"),
          subtotal: "250.00",
          taxTotal: "0.00",
          total: "250.00",
        },
      ]);

      // Each invoice has its own QBO push row carrying a marker external
      // id that we can assert against. If a regression broke RBAC and
      // returned vendor2's pushedTo to vendor1, the externalInvoiceId
      // string ("qbo-v2-only") would surface in vendor1's response.
      await dbm.db.insert(dbm.accountingPushedInvoicesTable).values([
        {
          vendorId: vendor1Id,
          provider: "qbo",
          invoiceNumber: V1_NUMBER,
          externalInvoiceId: "qbo-v1-only",
          externalDocNumber: V1_NUMBER,
        },
        {
          vendorId: vendor2Id,
          provider: "qbo",
          invoiceNumber: V2_NUMBER,
          externalInvoiceId: "qbo-v2-only",
          externalDocNumber: V2_NUMBER,
        },
        {
          vendorId: vendor1Id,
          provider: "oa",
          invoiceNumber: P1_NUMBER,
          externalInvoiceId: "oa-p1-only",
          externalDocNumber: P1_NUMBER,
        },
        {
          vendorId: vendor2Id,
          provider: "oa",
          invoiceNumber: P2_NUMBER,
          externalInvoiceId: "oa-p2-only",
          externalDocNumber: P2_NUMBER,
        },
      ]);

      const userRows = await dbm.db
        .insert(dbm.usersTable)
        .values([
          {
            username: `${MARKER}-v1user@example.com`,
            passwordHash: "x",
            role: "vendor",
            displayName: "V1 User",
          },
          {
            username: `${MARKER}-v2user@example.com`,
            passwordHash: "x",
            role: "vendor",
            displayName: "V2 User",
          },
          {
            username: `${MARKER}-p1user@example.com`,
            passwordHash: "x",
            role: "partner",
            displayName: "P1 User",
          },
          {
            username: `${MARKER}-p2user@example.com`,
            passwordHash: "x",
            role: "partner",
            displayName: "P2 User",
          },
        ])
        .returning({ id: dbm.usersTable.id });
      vendor1UserId = userRows[0].id;
      vendor2UserId = userRows[1].id;
      partner1UserId = userRows[2].id;
      partner2UserId = userRows[3].id;
    }, 30_000);

    afterAll(async () => {
      if (!dbm) return;
      await dbm.db.execute(
        sql`delete from accounting_pushed_invoices where vendor_id in (${vendor1Id}, ${vendor2Id})`,
      );
      await dbm.db.execute(
        sql`delete from invoices where invoice_number in (${V1_NUMBER}, ${V2_NUMBER}, ${P1_NUMBER}, ${P2_NUMBER})`,
      );
      await dbm.db.execute(
        sql`delete from users where id in (${vendor1UserId}, ${vendor2UserId}, ${partner1UserId}, ${partner2UserId})`,
      );
      await dbm.db.execute(
        sql`delete from vendors where id in (${vendor1Id}, ${vendor2Id})`,
      );
      await dbm.db.execute(
        sql`delete from partners where id in (${partner1Id}, ${partner2Id})`,
      );
    });

    it("only returns vendor1's pushedTo to a vendor1 session", async () => {
      const res = await request(app)
        .get("/invoices")
        .set("Cookie", vendorCookie(vendor1UserId, vendor1Id));
      expect(res.status).toBe(200);

      const items = res.body.items as Array<{
        invoiceNumber: string;
        vendorId: number;
        pushedTo: {
          qbo: { externalInvoiceId: string | null } | null;
          oa: { externalInvoiceId: string | null } | null;
        };
      }>;

      // Vendor1 only ever sees rows where vendor_id = vendor1Id.
      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(it.vendorId).toBe(vendor1Id);
      }

      // The vendor1-owned invoices come back with their own pushedTo
      // payload intact.
      const own = items.find((i) => i.invoiceNumber === V1_NUMBER);
      expect(own).toBeDefined();
      expect(own!.pushedTo.qbo!.externalInvoiceId).toBe("qbo-v1-only");

      // Vendor2's invoice (and therefore its pushedTo) must not appear
      // anywhere in the response.
      const leaked = items.find((i) => i.invoiceNumber === V2_NUMBER);
      expect(leaked).toBeUndefined();

      // Defense-in-depth: even searching for the foreign external id
      // should turn up nothing.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("qbo-v2-only");
      expect(serialized).not.toContain("oa-p2-only");
    });

    it("only returns vendor2's pushedTo to a vendor2 session", async () => {
      // Symmetric check — guards against an asymmetric bug where the
      // first vendor in the table happens to be safe but a later one is
      // exposed (e.g. an off-by-one in an OR'd clause).
      const res = await request(app)
        .get("/invoices")
        .set("Cookie", vendorCookie(vendor2UserId, vendor2Id));
      expect(res.status).toBe(200);

      const items = res.body.items as Array<{
        invoiceNumber: string;
        vendorId: number;
        pushedTo: {
          qbo: { externalInvoiceId: string | null } | null;
          oa: { externalInvoiceId: string | null } | null;
        };
      }>;
      for (const it of items) {
        expect(it.vendorId).toBe(vendor2Id);
      }
      const own = items.find((i) => i.invoiceNumber === V2_NUMBER);
      expect(own).toBeDefined();
      expect(own!.pushedTo.qbo!.externalInvoiceId).toBe("qbo-v2-only");

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("qbo-v1-only");
      expect(serialized).not.toContain("oa-p1-only");
    });

    it("only returns partner1's pushedTo to a partner1 session", async () => {
      const res = await request(app)
        .get("/invoices")
        .set("Cookie", partnerCookie(partner1UserId, partner1Id));
      expect(res.status).toBe(200);

      const items = res.body.items as Array<{
        invoiceNumber: string;
        partnerId: number;
        pushedTo: {
          qbo: { externalInvoiceId: string | null } | null;
          oa: { externalInvoiceId: string | null } | null;
        };
      }>;

      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(it.partnerId).toBe(partner1Id);
      }
      const own = items.find((i) => i.invoiceNumber === P1_NUMBER);
      expect(own).toBeDefined();
      expect(own!.pushedTo.oa!.externalInvoiceId).toBe("oa-p1-only");

      // Partner2's invoices (and their external ids) must not appear.
      const leaked = items.find((i) => i.invoiceNumber === P2_NUMBER);
      expect(leaked).toBeUndefined();
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("oa-p2-only");
      expect(serialized).not.toContain("qbo-v2-only");
    });

    it("only returns partner2's pushedTo to a partner2 session", async () => {
      const res = await request(app)
        .get("/invoices")
        .set("Cookie", partnerCookie(partner2UserId, partner2Id));
      expect(res.status).toBe(200);

      const items = res.body.items as Array<{
        invoiceNumber: string;
        partnerId: number;
        pushedTo: {
          qbo: { externalInvoiceId: string | null } | null;
          oa: { externalInvoiceId: string | null } | null;
        };
      }>;
      for (const it of items) {
        expect(it.partnerId).toBe(partner2Id);
      }
      const own = items.find((i) => i.invoiceNumber === P2_NUMBER);
      expect(own).toBeDefined();
      expect(own!.pushedTo.oa!.externalInvoiceId).toBe("oa-p2-only");

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("oa-p1-only");
      expect(serialized).not.toContain("qbo-v1-only");
    });
  },
);

describe.runIf(haveRealDb)("deletePushedInvoice (real DB)", () => {
  let dbm: typeof import("@workspace/db");
  let deletePushedInvoice: typeof import("./pushedInvoices").deletePushedInvoice;
  let getPushedInvoice: typeof import("./pushedInvoices").getPushedInvoice;
  let vendorId = 0;

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    ({ deletePushedInvoice, getPushedInvoice } = await import(
      "./pushedInvoices"
    ));
    const [v] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-Del`,
        contactName: "D",
        contactEmail: `${MARKER}-d@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    vendorId = v.id;
    await dbm.db.insert(dbm.accountingPushedInvoicesTable).values({
      vendorId,
      provider: "qbo",
      invoiceNumber: "INV-DEL-1",
      externalInvoiceId: "qbo-del-1",
      externalDocNumber: "DOC-DEL-1",
    });
  });

  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.execute(
      sql`delete from accounting_pushed_invoices where vendor_id = ${vendorId}`,
    );
    await dbm.db.execute(sql`delete from vendors where id = ${vendorId}`);
  });

  it("returns null when no mapping row matches", async () => {
    // Wrong invoice number under a real vendor — must report null without
    // touching unrelated rows. This is the branch the route relies on to
    // turn a no-op delete into a 404.
    const result = await deletePushedInvoice(
      vendorId,
      "qbo",
      "INV-DOES-NOT-EXIST",
    );
    expect(result).toBeNull();

    // Wrong provider for a number that does have a row — must also be null
    // (the natural key includes provider).
    const wrongProvider = await deletePushedInvoice(
      vendorId,
      "oa",
      "INV-DEL-1",
    );
    expect(wrongProvider).toBeNull();

    // The matching row for (vendor, qbo, INV-DEL-1) is still intact.
    const stillThere = await getPushedInvoice(vendorId, "qbo", "INV-DEL-1");
    expect(stillThere).not.toBeNull();
    expect(stillThere!.externalInvoiceId).toBe("qbo-del-1");
  });

  it("deletes the row and returns its snapshot when a mapping matches", async () => {
    const deleted = await deletePushedInvoice(vendorId, "qbo", "INV-DEL-1");
    expect(deleted).not.toBeNull();
    expect(deleted!.externalInvoiceId).toBe("qbo-del-1");
    expect(deleted!.externalDocNumber).toBe("DOC-DEL-1");
    expect(deleted!.pushedAt).toBeInstanceOf(Date);

    // Subsequent lookup confirms the row is gone — and a second delete is
    // idempotent (returns null rather than throwing).
    const after = await getPushedInvoice(vendorId, "qbo", "INV-DEL-1");
    expect(after).toBeNull();
    const reDelete = await deletePushedInvoice(vendorId, "qbo", "INV-DEL-1");
    expect(reDelete).toBeNull();
  });
});

describe.runIf(haveRealDb)("getPushedInvoice (real DB)", () => {
  let dbm: typeof import("@workspace/db");
  let getPushedInvoice: typeof import("./pushedInvoices").getPushedInvoice;
  let vendorId = 0;
  let otherVendorId = 0;

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    ({ getPushedInvoice } = await import("./pushedInvoices"));

    const [v] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-Get`,
        contactName: "G",
        contactEmail: `${MARKER}-g@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    vendorId = v.id;

    const [v2] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-GetOther`,
        contactName: "GO",
        contactEmail: `${MARKER}-go@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    otherVendorId = v2.id;

    // Vendor under test: INV-GET-1 pushed to QBO only, INV-GET-2 to OA only.
    // Other vendor: INV-GET-1 pushed to QBO with a DIFFERENT external id so
    // we can prove vendor scoping works.
    await dbm.db.insert(dbm.accountingPushedInvoicesTable).values([
      {
        vendorId,
        provider: "qbo",
        invoiceNumber: "INV-GET-1",
        externalInvoiceId: "qbo-get-1",
        externalDocNumber: "DOC-GET-1",
      },
      {
        vendorId,
        provider: "oa",
        invoiceNumber: "INV-GET-2",
        externalInvoiceId: "oa-get-2",
        externalDocNumber: "DOC-GET-2",
      },
      {
        vendorId: otherVendorId,
        provider: "qbo",
        invoiceNumber: "INV-GET-1",
        externalInvoiceId: "qbo-get-1-OTHER",
        externalDocNumber: "DOC-GET-1-OTHER",
      },
    ]);
  });

  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.execute(
      sql`delete from accounting_pushed_invoices where vendor_id in (${vendorId}, ${otherVendorId})`,
    );
    await dbm.db.execute(
      sql`delete from vendors where id in (${vendorId}, ${otherVendorId})`,
    );
  });

  it("returns the matching mapping row when (vendor, provider, number) all hit", async () => {
    const r = await getPushedInvoice(vendorId, "qbo", "INV-GET-1");
    expect(r).not.toBeNull();
    expect(r!.vendorId).toBe(vendorId);
    expect(r!.provider).toBe("qbo");
    expect(r!.invoiceNumber).toBe("INV-GET-1");
    expect(r!.externalInvoiceId).toBe("qbo-get-1");
    expect(r!.externalDocNumber).toBe("DOC-GET-1");
    expect(r!.pushedAt).toBeInstanceOf(Date);
  });

  it("returns null for an unknown invoice number under a real vendor", async () => {
    const r = await getPushedInvoice(vendorId, "qbo", "INV-DOES-NOT-EXIST");
    expect(r).toBeNull();
  });

  it("returns null when the provider is wrong (natural key includes provider)", async () => {
    // INV-GET-1 exists for this vendor under QBO only — asking for OA must
    // miss rather than return the QBO row. Guards against accidentally
    // dropping the provider predicate from the WHERE clause.
    const r = await getPushedInvoice(vendorId, "oa", "INV-GET-1");
    expect(r).toBeNull();
  });

  it("scopes by vendorId so another vendor's row for the same number is invisible", async () => {
    // Both vendors have a (qbo, INV-GET-1) mapping with different external
    // ids. Asking under our vendor must return our row, never the other
    // vendor's, so the Re-sync action sends the correct remote id.
    const ours = await getPushedInvoice(vendorId, "qbo", "INV-GET-1");
    expect(ours!.externalInvoiceId).toBe("qbo-get-1");
    const theirs = await getPushedInvoice(otherVendorId, "qbo", "INV-GET-1");
    expect(theirs!.externalInvoiceId).toBe("qbo-get-1-OTHER");
  });
});

describe.runIf(haveRealDb)("listPushedInvoicesForNumber (real DB)", () => {
  let dbm: typeof import("@workspace/db");
  let listPushedInvoicesForNumber: typeof import("./pushedInvoices").listPushedInvoicesForNumber;
  let vendorId = 0;
  let otherVendorId = 0;

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    ({ listPushedInvoicesForNumber } = await import("./pushedInvoices"));

    const [v] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-List`,
        contactName: "L",
        contactEmail: `${MARKER}-l@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    vendorId = v.id;
    const [v2] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-ListOther`,
        contactName: "LO",
        contactEmail: `${MARKER}-lo@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    otherVendorId = v2.id;

    // Two invoice numbers under our vendor:
    //   INV-LIST-Q: only QBO push row
    //   INV-LIST-BOTH: QBO + OA push rows
    // Plus a noise row under another vendor for INV-LIST-BOTH that must
    // never be returned when we ask under our vendor.
    await dbm.db.insert(dbm.accountingPushedInvoicesTable).values([
      {
        vendorId,
        provider: "qbo",
        invoiceNumber: "INV-LIST-Q",
        externalInvoiceId: "qbo-list-q",
        externalDocNumber: "DOC-LIST-Q",
      },
      {
        vendorId,
        provider: "qbo",
        invoiceNumber: "INV-LIST-BOTH",
        externalInvoiceId: "qbo-list-both",
        externalDocNumber: "DOC-LIST-BOTH",
      },
      {
        vendorId,
        provider: "oa",
        invoiceNumber: "INV-LIST-BOTH",
        externalInvoiceId: "oa-list-both",
        externalDocNumber: "DOC-LIST-BOTH",
      },
      {
        vendorId: otherVendorId,
        provider: "qbo",
        invoiceNumber: "INV-LIST-BOTH",
        externalInvoiceId: "qbo-list-both-OTHER",
        externalDocNumber: "DOC-LIST-BOTH-OTHER",
      },
    ]);
  });

  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.execute(
      sql`delete from accounting_pushed_invoices where vendor_id in (${vendorId}, ${otherVendorId})`,
    );
    await dbm.db.execute(
      sql`delete from vendors where id in (${vendorId}, ${otherVendorId})`,
    );
  });

  it("returns an empty array when the invoice has never been pushed", async () => {
    const rows = await listPushedInvoicesForNumber(
      vendorId,
      "INV-NEVER-PUSHED",
    );
    expect(rows).toEqual([]);
  });

  it("returns a single-provider list when the invoice was only pushed to one remote", async () => {
    const rows = await listPushedInvoicesForNumber(vendorId, "INV-LIST-Q");
    expect(rows.length).toBe(1);
    expect(rows[0].provider).toBe("qbo");
    expect(rows[0].vendorId).toBe(vendorId);
    expect(rows[0].invoiceNumber).toBe("INV-LIST-Q");
    expect(rows[0].externalInvoiceId).toBe("qbo-list-q");
    expect(rows[0].externalDocNumber).toBe("DOC-LIST-Q");
    expect(rows[0].pushedAt).toBeInstanceOf(Date);
  });

  it("returns both providers when the invoice was pushed to qbo and oa", async () => {
    const rows = await listPushedInvoicesForNumber(vendorId, "INV-LIST-BOTH");
    expect(rows.length).toBe(2);
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    expect(byProvider.get("qbo")!.externalInvoiceId).toBe("qbo-list-both");
    expect(byProvider.get("oa")!.externalInvoiceId).toBe("oa-list-both");
    // The other-vendor row for the same invoice number must NOT leak in.
    for (const r of rows) {
      expect(r.vendorId).toBe(vendorId);
      expect(r.externalInvoiceId).not.toContain("OTHER");
    }
  });
});

describe.runIf(haveRealDb)(
  "GET /invoices/:id pushedTo matches GET /invoices envelope shape",
  () => {
    let dbm: typeof import("@workspace/db");
    let app: express.Express;

    let adminUserId = 0;
    let vendorId = 0;
    let partnerId = 0;
    let invoiceId = 0;
    const NUMBER = `${MARKER}-DETAIL`;

    beforeAll(async () => {
      dbm = await import("@workspace/db");
      const invoicesRouter = (await import("../../routes/invoices")).default;

      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use(invoicesRouter);

      const [vendor] = await dbm.db
        .insert(dbm.vendorsTable)
        .values({
          name: `${MARKER}-DetailVendor`,
          contactName: "DV",
          contactEmail: `${MARKER}-dv@example.com`,
        })
        .returning({ id: dbm.vendorsTable.id });
      vendorId = vendor.id;
      const [partner] = await dbm.db
        .insert(dbm.partnersTable)
        .values({
          name: `${MARKER}-DetailPartner`,
          contactName: "DP",
          contactEmail: `${MARKER}-dp@example.com`,
        })
        .returning({ id: dbm.partnersTable.id });
      partnerId = partner.id;

      const [inv] = await dbm.db
        .insert(dbm.invoicesTable)
        .values({
          invoiceNumber: NUMBER,
          vendorId,
          partnerId,
          cadence: "per_ticket",
          status: "sent",
          periodStart: new Date("2026-03-01T00:00:00Z"),
          periodEnd: new Date("2026-03-31T23:59:59Z"),
          subtotal: "100.00",
          taxTotal: "10.00",
          total: "110.00",
        })
        .returning({ id: dbm.invoicesTable.id });
      invoiceId = inv.id;

      await dbm.db.insert(dbm.accountingPushedInvoicesTable).values([
        {
          vendorId,
          provider: "qbo",
          invoiceNumber: NUMBER,
          externalInvoiceId: "qbo-detail-1",
          externalDocNumber: NUMBER,
        },
        {
          vendorId,
          provider: "oa",
          invoiceNumber: NUMBER,
          externalInvoiceId: "oa-detail-1",
          externalDocNumber: NUMBER,
        },
      ]);

      const [admin] = await dbm.db
        .insert(dbm.usersTable)
        .values({
          username: `${MARKER}-detailadmin@example.com`,
          passwordHash: "x",
          role: "admin",
          displayName: "Admin",
        })
        .returning({ id: dbm.usersTable.id });
      adminUserId = admin.id;
    }, 30_000);

    afterAll(async () => {
      if (!dbm) return;
      await dbm.db.execute(
        sql`delete from accounting_pushed_invoices where vendor_id = ${vendorId}`,
      );
      await dbm.db.execute(
        sql`delete from invoices where invoice_number = ${NUMBER}`,
      );
      if (adminUserId) {
        await dbm.db.execute(
          sql`delete from users where id = ${adminUserId}`,
        );
      }
      if (vendorId) {
        await dbm.db.execute(sql`delete from vendors where id = ${vendorId}`);
      }
      if (partnerId) {
        await dbm.db.execute(sql`delete from partners where id = ${partnerId}`);
      }
    });

    it("detail pushedTo envelope is shaped identically to the list endpoint", async () => {
      const detailRes = await request(app)
        .get(`/invoices/${invoiceId}`)
        .set("Cookie", adminCookie(adminUserId));
      expect(detailRes.status).toBe(200);

      const listRes = await request(app)
        .get("/invoices")
        .query({ vendorId, partnerId })
        .set("Cookie", adminCookie(adminUserId));
      expect(listRes.status).toBe(200);

      const listed = (
        listRes.body.items as Array<{
          invoiceNumber: string;
          pushedTo: unknown;
        }>
      ).find((i) => i.invoiceNumber === NUMBER);
      expect(listed).toBeDefined();

      // Same keys, same shape — both providers populated identically.
      expect(detailRes.body.pushedTo).toEqual(listed!.pushedTo);

      const pushedTo = detailRes.body.pushedTo as {
        qbo: {
          pushedAt: string;
          externalInvoiceId: string | null;
          externalDocNumber: string | null;
        } | null;
        oa: {
          pushedAt: string;
          externalInvoiceId: string | null;
          externalDocNumber: string | null;
        } | null;
      };
      expect(pushedTo.qbo).not.toBeNull();
      expect(pushedTo.qbo!.externalInvoiceId).toBe("qbo-detail-1");
      expect(pushedTo.qbo!.externalDocNumber).toBe(NUMBER);
      expect(typeof pushedTo.qbo!.pushedAt).toBe("string");
      expect(pushedTo.oa).not.toBeNull();
      expect(pushedTo.oa!.externalInvoiceId).toBe("oa-detail-1");
      expect(pushedTo.oa!.externalDocNumber).toBe(NUMBER);
    });
  },
);

describe.skipIf(haveRealDb)(
  "loadPushedStatusForInvoices (skipped: no real DB)",
  () => {
    it("is skipped without DATABASE_URL", () => {
      expect(true).toBe(true);
    });
  },
);
