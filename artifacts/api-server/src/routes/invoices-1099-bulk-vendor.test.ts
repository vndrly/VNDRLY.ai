import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { sql } from "drizzle-orm";

import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Vendor-side coverage for the bulk 1099 controls.
//
// The companion `invoices-1099-undo.test.ts` already exercises the admin path
// against PATCH /invoices/:id/lines and POST /invoices/bulk-recategorize-1099.
// Production also lets a vendor user bulk-recategorize the lines on their OWN
// draft invoices via PATCH /invoices/:id/lines (see canEditInvoice in
// routes/invoices.ts), but that vendor branch had no automated coverage. This
// suite simulates the field-portal flow:
//
//   1) sign in as a seeded vendor account (mirroring the "precision" demo
//      vendor referenced in the task brief),
//   2) open one of their own draft invoices and multi-select two lines,
//   3) PATCH /invoices/:id/lines with a new income category, and
//   4) assert both rows update (and that the previousCategories snapshot is
//      returned so the field-portal Undo affordance keeps working).
//
// The suite also pins the negative cases that protect tenant isolation:
//   * a vendor cannot edit lines on a different vendor's invoice (403),
//   * a vendor cannot use the admin-only POST /invoices/bulk-recategorize-1099
//     entry point (403), and
//   * once an invoice leaves draft, even its own vendor can no longer
//     recategorize its lines (403).
//
// Like the sibling 1099 tests, this requires a real Postgres with the schema
// pushed; otherwise the suite is skipped so unit-test CI still passes.
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

const MARKER = `bulk1099vendor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface SeedIds {
  vendorUserId: number;
  vendorId: number;
  otherVendorUserId: number;
  otherVendorId: number;
  partnerId: number;
  // Vendor's own DRAFT invoice (the field portal multi-select target).
  draftInvoiceId: number;
  draftLineAId: number; // engine-derived, prior 'misc_rents'
  draftLineBId: number; // manual override, prior 'nec'
  // Vendor's own SENT invoice (immutable — recategorize must 403).
  sentInvoiceId: number;
  sentLineId: number;
  // A different vendor's DRAFT invoice (cross-tenant — must 403).
  foreignInvoiceId: number;
  foreignLineId: number;
}

let seeded: SeedIds | null = null;
let dbModule: typeof import("@workspace/db");
let app: express.Express;

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
      name: `${MARKER}-Energy`,
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
      // Mirror the "precision" demo-vendor naming the task brief calls out;
      // we keep a unique MARKER prefix so the cleanup query can find us.
      name: `${MARKER}-Precision`,
      contactName: "Owner",
      contactEmail: `${MARKER}-vendor@example.com`,
      billingAddress: "1 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  const [otherVendor] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Other`,
      contactName: "Owner2",
      contactEmail: `${MARKER}-other@example.com`,
      billingAddress: "2 Vendor St",
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

  const draftLines = await db
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

  const draftLineAId = draftLines.find(
    (l) => l.lineType === "equipment" && !l.isManualOverride,
  )!.id;
  const draftLineBId = draftLines.find(
    (l) => l.lineType === "labor_regular" && l.isManualOverride,
  )!.id;

  // SENT invoice owned by the same vendor — used to assert the draft-only
  // guard still blocks the vendor from editing once an invoice has left draft.
  const [sentInvoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-SENT`,
      vendorId: vendor.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "sent",
      sentAt: new Date(),
      periodStart: new Date(Date.UTC(2026, 4, 1)),
      periodEnd: new Date(Date.UTC(2026, 4, 30)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const [sentLine] = await db
    .insert(invoiceLinesTable)
    .values([
      {
        invoiceId: sentInvoice.id,
        sourceType: "manual",
        lineType: "equipment",
        description: "Sent line",
        quantity: "1.0000",
        unitPrice: "300.0000",
        amount: "300.00",
        incomeCategory: "misc_rents",
        isManualOverride: false,
      },
    ])
    .returning({ id: invoiceLinesTable.id });

  // Cross-tenant draft invoice owned by a different vendor.
  const [foreignInvoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-FOREIGN`,
      vendorId: otherVendor.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 6, 1)),
      periodEnd: new Date(Date.UTC(2026, 6, 30)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const [foreignLine] = await db
    .insert(invoiceLinesTable)
    .values([
      {
        invoiceId: foreignInvoice.id,
        sourceType: "manual",
        lineType: "labor_regular",
        description: "Foreign line",
        quantity: "1.0000",
        unitPrice: "400.0000",
        amount: "400.00",
        incomeCategory: "nec",
        isManualOverride: false,
      },
    ])
    .returning({ id: invoiceLinesTable.id });

  const [vendorUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-vendor-user@example.com`,
      passwordHash: "x",
      role: "vendor",
      displayName: "Vendor User",
    })
    .returning({ id: usersTable.id });

  const [otherVendorUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-other-user@example.com`,
      passwordHash: "x",
      role: "vendor",
      displayName: "Other Vendor User",
    })
    .returning({ id: usersTable.id });

  return {
    vendorUserId: vendorUser.id,
    vendorId: vendor.id,
    otherVendorUserId: otherVendorUser.id,
    otherVendorId: otherVendor.id,
    partnerId: partner.id,
    draftInvoiceId: draftInvoice.id,
    draftLineAId,
    draftLineBId,
    sentInvoiceId: sentInvoice.id,
    sentLineId: sentLine.id,
    foreignInvoiceId: foreignInvoice.id,
    foreignLineId: foreignLine.id,
  };
}

async function cleanup(): Promise<void> {
  const { db } = dbModule;
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
  "bulk 1099 controls — vendor role",
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

    describe("PATCH /invoices/:id/lines (vendor)", () => {
      it("multi-selects two lines on the vendor's own draft invoice and applies a 1099 category", async () => {
        const res = await request(app)
          .patch(`/invoices/${seeded!.draftInvoiceId}/lines`)
          .set("Cookie", vendorCookie(seeded!.vendorUserId, seeded!.vendorId))
          .send({
            lineIds: [seeded!.draftLineAId, seeded!.draftLineBId],
            incomeCategory: "misc_other_income",
          });
        expectStatus(res, 200);
        expect(res.body.ok).toBe(true);
        expect(res.body.updated).toBe(2);

        // Undo affordance: vendor caller should also receive the snapshot of
        // each line's prior (category, manual-override) values so the
        // field-portal toolbar can offer Undo just like the admin UI.
        const prev = res.body.previousCategories as Array<{
          lineId: number;
          incomeCategory: string;
          isManualOverride: boolean;
        }>;
        expect(prev).toHaveLength(2);
        const byId = new Map(prev.map((p) => [p.lineId, p]));
        expect(byId.get(seeded!.draftLineAId)).toEqual({
          lineId: seeded!.draftLineAId,
          incomeCategory: "misc_rents",
          isManualOverride: false,
        });
        expect(byId.get(seeded!.draftLineBId)).toEqual({
          lineId: seeded!.draftLineBId,
          incomeCategory: "nec",
          isManualOverride: true,
        });

        // Persisted state matches: both rows now carry the new category and
        // are flagged as manual overrides (the deliberate-choice semantics
        // of the single-category bulk shape).
        const { db, invoiceLinesTable } = dbModule;
        const rows = await db
          .select()
          .from(invoiceLinesTable)
          .where(
            sql`id in (${sql.raw(seeded!.draftLineAId.toString())}, ${sql.raw(
              seeded!.draftLineBId.toString(),
            )})`,
          );
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.incomeCategory).toBe("misc_other_income");
          expect(row.isManualOverride).toBe(true);
        }
      });

      it("supports the per-line Undo shape from the vendor portal", async () => {
        // Replay the prior-category snapshot to revert the lines we just
        // recategorized — this is exactly what the field-portal Undo button
        // POSTs after stashing the previousCategories from the call above.
        const undo = await request(app)
          .patch(`/invoices/${seeded!.draftInvoiceId}/lines`)
          .set("Cookie", vendorCookie(seeded!.vendorUserId, seeded!.vendorId))
          .send({
            updates: [
              {
                lineId: seeded!.draftLineAId,
                incomeCategory: "misc_rents",
                isManualOverride: false,
              },
              {
                lineId: seeded!.draftLineBId,
                incomeCategory: "nec",
                isManualOverride: true,
              },
            ],
          });
        expectStatus(undo, 200);
        expect(undo.body.updated).toBe(2);

        const { db, invoiceLinesTable } = dbModule;
        const [a] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.draftLineAId}`);
        expect(a.incomeCategory).toBe("misc_rents");
        expect(a.isManualOverride).toBe(false);
        const [b] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.draftLineBId}`);
        expect(b.incomeCategory).toBe("nec");
        expect(b.isManualOverride).toBe(true);
      });

      it("rejects a vendor trying to recategorize a different vendor's invoice", async () => {
        const res = await request(app)
          .patch(`/invoices/${seeded!.foreignInvoiceId}/lines`)
          .set("Cookie", vendorCookie(seeded!.vendorUserId, seeded!.vendorId))
          .send({
            lineIds: [seeded!.foreignLineId],
            incomeCategory: "misc_other_income",
          });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("invoice.cannot_edit");

        // Persisted state on the foreign invoice is unchanged.
        const { db, invoiceLinesTable } = dbModule;
        const [row] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.foreignLineId}`);
        expect(row.incomeCategory).toBe("nec");
      });

      it("rejects a vendor recategorizing their own invoice once it has left draft", async () => {
        const res = await request(app)
          .patch(`/invoices/${seeded!.sentInvoiceId}/lines`)
          .set("Cookie", vendorCookie(seeded!.vendorUserId, seeded!.vendorId))
          .send({
            lineIds: [seeded!.sentLineId],
            incomeCategory: "misc_other_income",
          });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("invoice.cannot_edit");
      });
    });

    describe("POST /invoices/bulk-recategorize-1099 (vendor)", () => {
      it("is admin-only — even the invoice's own vendor cannot call it", async () => {
        const res = await request(app)
          .post("/invoices/bulk-recategorize-1099")
          .set("Cookie", vendorCookie(seeded!.vendorUserId, seeded!.vendorId))
          .send({
            vendorId: seeded!.vendorId,
            incomeCategory: "misc_other_income",
            year: 2026,
          });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("auth.admin_only");
      });
    });
  },
);
