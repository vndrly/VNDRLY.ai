import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Coverage for the Undo affordance on bulk 1099 category changes:
//
//   1) PATCH /invoices/:id/lines now accepts a per-line `updates` body shape
//      (used by the in-invoice Undo) AND returns `previousCategories` on the
//      single-category shape so the client can stash them.
//   2) POST /invoices/bulk-recategorize-1099 now returns `previousCategories`
//      so the 1099 dashboard can offer Undo.
//   3) POST /invoices/restore-1099-categories takes that snapshot and writes
//      each line's prior (category, manual-override flag) back. Lines whose
//      invoice left draft between the action and the undo are skipped.
//
// Like the sibling backfill test, this requires a real Postgres with the
// schema pushed; otherwise the suite is skipped so unit-test CI still passes.
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

const MARKER = `undo1099-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface SeedIds {
  adminUserId: number;
  vendorId: number;
  partnerId: number;
  // Per-invoice (PATCH /invoices/:id/lines) fixture
  draftInvoiceId: number;
  // Engine-derived line (manual_override = false), prior category 'misc_rents'
  engineLineId: number;
  // Manually-overridden line (manual_override = true), prior category 'nec'
  manualLineId: number;
  // Vendor-level (POST /invoices/bulk-recategorize-1099) fixture
  vendorBulkInvoiceADraftId: number;
  vendorBulkInvoiceBDraftId: number;
  vendorBulkLineA1Id: number; // engine-derived, prior 'nec'
  vendorBulkLineA2Id: number; // manual-override, prior 'misc_rents'
  vendorBulkLineB1Id: number; // engine-derived, prior 'misc_attorney'
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
      name: `${MARKER}-Vendor`,
      contactName: "Owner",
      contactEmail: `${MARKER}-vendor@example.com`,
      billingAddress: "1 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  // ── Per-invoice fixture ──────────────────────────────────────────
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

  // ── Vendor-level fixture: two draft invoices for the SAME vendor in the
  // same tax year, with mixed prior categories and override flags. ────
  const [vbInvA] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-VB-A`,
      vendorId: vendor.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 1, 1)),
      periodEnd: new Date(Date.UTC(2026, 1, 28)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const [vbInvB] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-VB-B`,
      vendorId: vendor.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 2, 1)),
      periodEnd: new Date(Date.UTC(2026, 2, 31)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const vbLines = await db
    .insert(invoiceLinesTable)
    .values([
      {
        invoiceId: vbInvA.id,
        sourceType: "manual",
        lineType: "labor_regular",
        description: "VB A1 (engine)",
        quantity: "1.0000",
        unitPrice: "10.0000",
        amount: "10.00",
        incomeCategory: "nec",
        isManualOverride: false,
      },
      {
        invoiceId: vbInvA.id,
        sourceType: "manual",
        lineType: "equipment",
        description: "VB A2 (manual)",
        quantity: "1.0000",
        unitPrice: "20.0000",
        amount: "20.00",
        incomeCategory: "misc_rents",
        isManualOverride: true,
      },
      {
        invoiceId: vbInvB.id,
        sourceType: "manual",
        lineType: "labor_regular",
        description: "VB B1 (engine)",
        quantity: "1.0000",
        unitPrice: "30.0000",
        amount: "30.00",
        incomeCategory: "misc_attorney",
        isManualOverride: false,
      },
    ])
    .returning({
      id: invoiceLinesTable.id,
      invoiceId: invoiceLinesTable.invoiceId,
      description: invoiceLinesTable.description,
    });

  const vbA1 = vbLines.find((l) => l.description === "VB A1 (engine)")!.id;
  const vbA2 = vbLines.find((l) => l.description === "VB A2 (manual)")!.id;
  const vbB1 = vbLines.find((l) => l.description === "VB B1 (engine)")!.id;

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
    vendorId: vendor.id,
    partnerId: partner.id,
    draftInvoiceId: draftInvoice.id,
    engineLineId,
    manualLineId,
    vendorBulkInvoiceADraftId: vbInvA.id,
    vendorBulkInvoiceBDraftId: vbInvB.id,
    vendorBulkLineA1Id: vbA1,
    vendorBulkLineA2Id: vbA2,
    vendorBulkLineB1Id: vbB1,
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
  "bulk 1099 category Undo affordance",
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

    describe("PATCH /invoices/:id/lines", () => {
      it("returns previousCategories on the single-category shape", async () => {
        const res = await request(app)
          .patch(`/invoices/${seeded!.draftInvoiceId}/lines`)
          .set("Cookie", adminCookie(seeded!.adminUserId))
          .send({
            lineIds: [seeded!.engineLineId, seeded!.manualLineId],
            incomeCategory: "misc_other_income",
          });
        expectStatus(res, 200);
        expect(res.body.ok).toBe(true);
        expect(res.body.updated).toBe(2);
        const prev = res.body.previousCategories as Array<{
          lineId: number;
          incomeCategory: string;
          isManualOverride: boolean;
        }>;
        expect(prev).toHaveLength(2);
        const byId = new Map(prev.map((p) => [p.lineId, p]));
        expect(byId.get(seeded!.engineLineId)).toEqual({
          lineId: seeded!.engineLineId,
          incomeCategory: "misc_rents",
          isManualOverride: false,
        });
        expect(byId.get(seeded!.manualLineId)).toEqual({
          lineId: seeded!.manualLineId,
          incomeCategory: "nec",
          isManualOverride: true,
        });
      });

      it("Undo via per-line updates restores prior category AND manual-override flag", async () => {
        // Lines are now 'misc_other_income' (both flagged manual). Replay
        // the snapshot to revert.
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
              {
                lineId: seeded!.manualLineId,
                incomeCategory: "nec",
                isManualOverride: true,
              },
            ],
          });
        expectStatus(undo, 200);
        expect(undo.body.updated).toBe(2);
        // The previousCategories the undo returns should now be the
        // post-bulk state (both 'misc_other_income', both manual=true).
        const prev = undo.body.previousCategories as Array<{
          lineId: number;
          incomeCategory: string;
          isManualOverride: boolean;
        }>;
        expect(prev).toHaveLength(2);
        for (const p of prev) {
          expect(p.incomeCategory).toBe("misc_other_income");
          expect(p.isManualOverride).toBe(true);
        }

        // Persisted state matches the undo we asked for.
        const { db, invoiceLinesTable } = dbModule;
        const [engine] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.engineLineId}`);
        expect(engine.incomeCategory).toBe("misc_rents");
        expect(engine.isManualOverride).toBe(false);
        const [manual] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.manualLineId}`);
        expect(manual.incomeCategory).toBe("nec");
        expect(manual.isManualOverride).toBe(true);
      });

      it("rejects per-line updates that reference a foreign invoice's line", async () => {
        const res = await request(app)
          .patch(`/invoices/${seeded!.draftInvoiceId}/lines`)
          .set("Cookie", adminCookie(seeded!.adminUserId))
          .send({
            updates: [
              {
                lineId: seeded!.vendorBulkLineA1Id, // belongs to a different invoice
                incomeCategory: "nec",
                isManualOverride: false,
              },
            ],
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("invoice.lines_mismatch");
      });
    });

    describe("POST /invoices/bulk-recategorize-1099", () => {
      it("returns previousCategories for every affected line", async () => {
        const res = await request(app)
          .post("/invoices/bulk-recategorize-1099")
          .set("Cookie", adminCookie(seeded!.adminUserId))
          .send({
            vendorId: seeded!.vendorId,
            incomeCategory: "misc_royalties",
            year: 2026,
          });
        expectStatus(res, 200);
        expect(res.body.ok).toBe(true);
        const prev = res.body.previousCategories as Array<{
          lineId: number;
          incomeCategory: string;
          isManualOverride: boolean;
        }>;
        const byId = new Map(prev.map((p) => [p.lineId, p]));
        // All three vendor-bulk lines should be present with their prior
        // (category, manual-override) values intact.
        expect(byId.get(seeded!.vendorBulkLineA1Id)).toMatchObject({
          incomeCategory: "nec",
          isManualOverride: false,
        });
        expect(byId.get(seeded!.vendorBulkLineA2Id)).toMatchObject({
          incomeCategory: "misc_rents",
          isManualOverride: true,
        });
        expect(byId.get(seeded!.vendorBulkLineB1Id)).toMatchObject({
          incomeCategory: "misc_attorney",
          isManualOverride: false,
        });
      });

      it("rejects non-admin callers (Undo wiring stays admin-only)", async () => {
        const res = await request(app)
          .post("/invoices/bulk-recategorize-1099")
          .set(
            "Cookie",
            vendorCookie(seeded!.adminUserId, seeded!.vendorId),
          )
          .send({
            vendorId: seeded!.vendorId,
            incomeCategory: "nec",
            year: 2026,
          });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("auth.admin_only");
      });
    });

    describe("POST /invoices/restore-1099-categories", () => {
      it("rejects unauthenticated and non-admin callers", async () => {
        const r1 = await request(app)
          .post("/invoices/restore-1099-categories")
          .send({ updates: [] });
        expect(r1.status).toBe(401);
        expect(r1.body.code).toBe("auth.not_authenticated");
        const r2 = await request(app)
          .post("/invoices/restore-1099-categories")
          .set(
            "Cookie",
            vendorCookie(seeded!.adminUserId, seeded!.vendorId),
          )
          .send({
            updates: [
              {
                lineId: seeded!.vendorBulkLineA1Id,
                incomeCategory: "nec",
                isManualOverride: false,
              },
            ],
          });
        expect(r2.status).toBe(403);
        expect(r2.body.code).toBe("auth.admin_only");
      });

      it("restores per-line category AND manual-override flag, skipping non-draft lines", async () => {
        // Sanity: the prior bulk-recategorize test pushed all three vendor
        // lines to 'misc_royalties' (manual=true).
        const { db, invoiceLinesTable, invoicesTable } = dbModule;

        // Flip invoice B to 'sent' to simulate a line that left draft
        // between the bulk action and the undo. That line should be
        // skipped (immutable) but A's two lines should restore.
        await db
          .update(invoicesTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(sql`id = ${seeded!.vendorBulkInvoiceBDraftId}`);

        const restore = await request(app)
          .post("/invoices/restore-1099-categories")
          .set("Cookie", adminCookie(seeded!.adminUserId))
          .send({
            updates: [
              {
                lineId: seeded!.vendorBulkLineA1Id,
                incomeCategory: "nec",
                isManualOverride: false,
              },
              {
                lineId: seeded!.vendorBulkLineA2Id,
                incomeCategory: "misc_rents",
                isManualOverride: true,
              },
              {
                lineId: seeded!.vendorBulkLineB1Id,
                incomeCategory: "misc_attorney",
                isManualOverride: false,
              },
            ],
          });
        expectStatus(restore, 200);
        expect(restore.body.restored).toBe(2);
        // `skipped` is now an array of {lineId, invoiceNumber, reason} so
        // the UI can list which lines couldn't be reverted and why. The
        // sent invoice (B) is the only thing that should land here.
        expect(Array.isArray(restore.body.skipped)).toBe(true);
        expect(restore.body.skipped).toHaveLength(1);
        expect(restore.body.skipped[0]).toMatchObject({
          lineId: seeded!.vendorBulkLineB1Id,
          reason: "not_draft",
          invoiceNumber: `${MARKER}-VB-B`,
        });

        // A line id that doesn't exist at all is reported as not_found
        // (separately from not_draft) so the UI can phrase it correctly.
        const restoreMissing = await request(app)
          .post("/invoices/restore-1099-categories")
          .set("Cookie", adminCookie(seeded!.adminUserId))
          .send({
            updates: [
              {
                lineId: 2_147_483_640,
                incomeCategory: "nec",
                isManualOverride: false,
              },
            ],
          });
        expectStatus(restoreMissing, 200);
        expect(restoreMissing.body.restored).toBe(0);
        expect(restoreMissing.body.skipped).toEqual([
          {
            lineId: 2_147_483_640,
            invoiceId: null,
            invoiceNumber: null,
            reason: "not_found",
          },
        ]);

        const [a1] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.vendorBulkLineA1Id}`);
        expect(a1.incomeCategory).toBe("nec");
        expect(a1.isManualOverride).toBe(false);

        const [a2] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.vendorBulkLineA2Id}`);
        expect(a2.incomeCategory).toBe("misc_rents");
        expect(a2.isManualOverride).toBe(true);

        // B1 was sent — must remain at the bulk-applied value, NOT the
        // restore target.
        const [b1] = await db
          .select()
          .from(invoiceLinesTable)
          .where(sql`id = ${seeded!.vendorBulkLineB1Id}`);
        expect(b1.incomeCategory).toBe("misc_royalties");
      });
    });
  },
);
