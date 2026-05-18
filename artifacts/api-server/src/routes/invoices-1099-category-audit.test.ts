import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Audit-trail coverage for bulk 1099 category changes (and undo).
//
// Verifies that all three mutating endpoints write rows to
// `invoice_line_category_audit` inside the same transaction as the line
// update, that no-op writes are skipped, that batchId groups a single
// action together, and that the GET /invoices/audit/1099-categories reader
// honors RBAC scoping.
//
// Like the sibling 1099 tests this requires a real Postgres with the
// schema pushed; otherwise the suite is skipped so unit-test CI passes.
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

const MARKER = `cataudit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface SeedIds {
  adminUserId: number;
  otherVendorUserId: number;
  vendorId: number;
  otherVendorId: number;
  partnerId: number;
  draftInvoiceId: number;
  engineLineId: number; // prior 'misc_rents', manual=false
  manualLineId: number; // prior 'nec', manual=true
  otherDraftInvoiceId: number;
  otherLineId: number; // belongs to otherVendor
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

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    invoicesTable,
    invoiceLinesTable,
    usersTable,
  } = dbModule;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-Partner`,
      contactName: "AP",
      contactEmail: `${MARKER}-ap@example.com`,
      billingAddress: "1 Main",
      physicalAddress: "1 Main",
      businessPhone: "5550000000",
    })
    .returning({ id: partnersTable.id });

  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Vendor`,
      contactName: "Owner",
      contactEmail: `${MARKER}-vendor@example.com`,
      billingAddress: "1 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  const [otherVendor] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-OtherVendor`,
      contactName: "Owner2",
      contactEmail: `${MARKER}-other@example.com`,
      billingAddress: "2 Other St",
    })
    .returning({ id: vendorsTable.id });

  const [draftInvoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-DRAFT`,
      vendorId: vendor.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 5, 1)),
      periodEnd: new Date(Date.UTC(2026, 5, 30)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const lines = await db
    .insert(invoiceLinesTable)
    .values([
      {
        invoiceId: draftInvoice.id,
        sourceType: "manual",
        lineType: "equipment",
        description: "Engine line",
        quantity: "1.0000",
        unitPrice: "100.0000",
        amount: "100.00",
        incomeCategory: "misc_rents",
        isManualOverride: false,
      },
      {
        invoiceId: draftInvoice.id,
        sourceType: "manual",
        lineType: "labor_regular",
        description: "Manual line",
        quantity: "1.0000",
        unitPrice: "200.0000",
        amount: "200.00",
        incomeCategory: "nec",
        isManualOverride: true,
      },
    ])
    .returning({
      id: invoiceLinesTable.id,
      lineType: invoiceLinesTable.lineType,
      isManualOverride: invoiceLinesTable.isManualOverride,
    });

  const engineLineId = lines.find(
    (l) => l.lineType === "equipment" && !l.isManualOverride,
  )!.id;
  const manualLineId = lines.find(
    (l) => l.lineType === "labor_regular" && l.isManualOverride,
  )!.id;

  const [otherDraft] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-OTHER`,
      vendorId: otherVendor.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 5, 1)),
      periodEnd: new Date(Date.UTC(2026, 5, 30)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const [otherLine] = await db
    .insert(invoiceLinesTable)
    .values({
      invoiceId: otherDraft.id,
      sourceType: "manual",
      lineType: "equipment",
      description: "Other vendor line",
      quantity: "1.0000",
      unitPrice: "100.0000",
      amount: "100.00",
      incomeCategory: "misc_rents",
      isManualOverride: false,
    })
    .returning({ id: invoiceLinesTable.id });

  const [adminUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-admin@example.com`,
      passwordHash: "x",
      role: "admin",
      displayName: "Admin Doe",
    })
    .returning({ id: usersTable.id });

  const [vendorUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-other-vendor@example.com`,
      passwordHash: "x",
      role: "vendor",
      displayName: "Other Vendor User",
    })
    .returning({ id: usersTable.id });

  return {
    adminUserId: adminUser.id,
    otherVendorUserId: vendorUser.id,
    vendorId: vendor.id,
    otherVendorId: otherVendor.id,
    partnerId: partner.id,
    draftInvoiceId: draftInvoice.id,
    engineLineId,
    manualLineId,
    otherDraftInvoiceId: otherDraft.id,
    otherLineId: otherLine.id,
  };
}

async function cleanup(): Promise<void> {
  const { db } = dbModule;
  await db.execute(
    sql`delete from invoice_line_category_audit where invoice_id in (select id from invoices where invoice_number like ${MARKER + "-%"})`,
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

describe.runIf(haveRealDb)(
  "1099 category audit trail",
  () => {
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

    it("PATCH /invoices/:id/lines (lineIds shape) writes one bulk_set row per affected line, sharing a batchId, skipping no-ops", async () => {
      // Engine line is currently 'misc_rents'. Manual line is currently
      // 'nec'. Apply 'nec' to both so the manual line is a no-op (same
      // category) and only the engine line should produce an audit row.
      const res = await request(app)
        .patch(`/invoices/${seeded!.draftInvoiceId}/lines`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          lineIds: [seeded!.engineLineId, seeded!.manualLineId],
          incomeCategory: "nec",
        });
      expectStatus(res, 200);
      expect(res.body.auditBatchId).toEqual(expect.any(String));

      const { db, invoiceLineCategoryAuditTable } = dbModule;
      const rows = await db
        .select()
        .from(invoiceLineCategoryAuditTable)
        .where(sql`batch_id = ${res.body.auditBatchId}`);
      // Manual line was already 'nec' AND already manual=true; bulk_set
      // applies manual=true so its (cat, override) is unchanged. Skipped.
      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.action).toBe("bulk_set");
      expect(r.lineId).toBe(seeded!.engineLineId);
      expect(r.invoiceId).toBe(seeded!.draftInvoiceId);
      expect(r.vendorId).toBe(seeded!.vendorId);
      expect(r.partnerId).toBe(seeded!.partnerId);
      expect(r.priorIncomeCategory).toBe("misc_rents");
      expect(r.priorIsManualOverride).toBe(false);
      expect(r.newIncomeCategory).toBe("nec");
      expect(r.newIsManualOverride).toBe(true);
      expect(r.actorUserId).toBe(seeded!.adminUserId);
      expect(r.actorRole).toBe("admin");
    });

    it("PATCH /invoices/:id/lines (updates shape) writes undo rows", async () => {
      const undo = await request(app)
        .patch(`/invoices/${seeded!.draftInvoiceId}/lines`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          updates: [
            {
              lineId: seeded!.engineLineId,
              incomeCategory: "misc_rents",
              isManualOverride: false,
            },
          ],
        });
      expectStatus(undo, 200);
      expect(undo.body.auditBatchId).toEqual(expect.any(String));

      const { db, invoiceLineCategoryAuditTable } = dbModule;
      const rows = await db
        .select()
        .from(invoiceLineCategoryAuditTable)
        .where(sql`batch_id = ${undo.body.auditBatchId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("undo");
      expect(rows[0].lineId).toBe(seeded!.engineLineId);
      expect(rows[0].priorIncomeCategory).toBe("nec");
      expect(rows[0].priorIsManualOverride).toBe(true);
      expect(rows[0].newIncomeCategory).toBe("misc_rents");
      expect(rows[0].newIsManualOverride).toBe(false);
    });

    it("POST /invoices/bulk-recategorize-1099 writes vendor_recategorize rows", async () => {
      const res = await request(app)
        .post("/invoices/bulk-recategorize-1099")
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          vendorId: seeded!.vendorId,
          incomeCategory: "misc_royalties",
          year: 2026,
        });
      expectStatus(res, 200);
      expect(res.body.auditBatchId).toEqual(expect.any(String));

      const { db, invoiceLineCategoryAuditTable } = dbModule;
      const rows = await db
        .select()
        .from(invoiceLineCategoryAuditTable)
        .where(sql`batch_id = ${res.body.auditBatchId}`);
      // Both lines should change: engine was misc_rents, manual was nec.
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const r of rows) {
        expect(r.action).toBe("vendor_recategorize");
        expect(r.vendorId).toBe(seeded!.vendorId);
        expect(r.partnerId).toBe(seeded!.partnerId);
        expect(r.newIncomeCategory).toBe("misc_royalties");
        expect(r.newIsManualOverride).toBe(true);
      }
    });

    describe("GET /invoices/audit/1099-categories", () => {
      it("admin can list with vendor + year filters", async () => {
        const res = await request(app)
          .get("/invoices/audit/1099-categories")
          .query({ vendorId: seeded!.vendorId, year: 2026, limit: 200 })
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        expect(Array.isArray(res.body.rows)).toBe(true);
        expect(res.body.rows.length).toBeGreaterThan(0);
        for (const r of res.body.rows) {
          expect(r.vendorId).toBe(seeded!.vendorId);
        }
        // Newest first: ids descending.
        const ids = res.body.rows.map((r: { id: number }) => r.id);
        const sorted = [...ids].sort((a: number, b: number) => b - a);
        expect(ids).toEqual(sorted);
        // Actor display info batched in.
        expect(res.body.rows[0].actorDisplayName).toBe("Admin Doe");
        expect(res.body.rows[0].vendorName).toContain(MARKER);
      });

      it("year filter excludes other years", async () => {
        const res = await request(app)
          .get("/invoices/audit/1099-categories")
          .query({ vendorId: seeded!.vendorId, year: 2023 })
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        expect(res.body.rows).toEqual([]);
      });

      it("vendor scope is forced to the caller's vendorId (cannot peek at other vendors)", async () => {
        // Caller is the vendor user belonging to otherVendorId. Even
        // though they request seeded.vendorId, RBAC pins the filter to
        // their own vendorId, so the result must be empty (no audits
        // exist for otherVendorId yet).
        const res = await request(app)
          .get("/invoices/audit/1099-categories")
          .query({ vendorId: seeded!.vendorId })
          .set(
            "Cookie",
            vendorCookie(seeded!.otherVendorUserId, seeded!.otherVendorId),
          );
        expectStatus(res, 200);
        for (const r of res.body.rows) {
          expect(r.vendorId).toBe(seeded!.otherVendorId);
        }
      });

      it("rejects unauthenticated callers", async () => {
        const res = await request(app).get("/invoices/audit/1099-categories");
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("auth.not_authenticated");
      });
    });
  },
);
