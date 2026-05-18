import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { sql, eq } from "drizzle-orm";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Coverage for DELETE /invoices/:id/pushed/:provider — the admin-only
// "Forget push record" endpoint added to recover from cases where the remote
// QBO/OA invoice was deleted or the wrong vendor was synced. The end-to-end
// UI flow exercises this route, but a regression in any of the auth gates,
// the audit-log write, or the 404-when-no-mapping branch would only surface
// in slow e2e runs. These tests pin the contract directly.
//
// Like the other invoice-route suites in this folder, this file talks to a
// real Postgres harness and is skipped when DATABASE_URL is unavailable so
// pure-unit CI still passes.
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

const MARKER = `clrpush-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

interface SeedIds {
  adminUserId: number;
  vendorUserId: number;
  vendorId: number;
  partnerId: number;
  invoiceQboOnlyId: number;
  invoiceQboOnlyNumber: string;
  invoiceBothId: number;
  invoiceBothNumber: string;
  invoiceUnpushedId: number;
  invoiceUnpushedNumber: string;
}

let seeded: SeedIds | null = null;
let dbModule: typeof import("@workspace/db");
let app: express.Express;

function adminCookie(userId: number): string {
  return buildTestCookie({ userId, role: "admin", displayName: "Admin" });
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
  const { db, vendorsTable, partnersTable, invoicesTable, usersTable } =
    dbModule;

  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-V`,
      contactName: "V",
      contactEmail: `${MARKER}-v@example.com`,
    })
    .returning({ id: vendorsTable.id });

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-P`,
      contactName: "P",
      contactEmail: `${MARKER}-p@example.com`,
    })
    .returning({ id: partnersTable.id });

  const baseInvoiceCols = {
    vendorId: vendor.id,
    partnerId: partner.id,
    cadence: "per_ticket" as const,
    status: "sent" as const,
    periodStart: new Date(Date.UTC(2026, 2, 1)),
    periodEnd: new Date(Date.UTC(2026, 2, 31)),
    subtotal: "100.00",
    taxTotal: "0.00",
    total: "100.00",
    sentAt: new Date(Date.UTC(2026, 2, 31)),
  };

  const [invQbo] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceCols,
      invoiceNumber: `${MARKER}-QBO`,
    })
    .returning({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
    });

  const [invBoth] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceCols,
      invoiceNumber: `${MARKER}-BOTH`,
    })
    .returning({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
    });

  const [invUnpushed] = await db
    .insert(invoicesTable)
    .values({
      ...baseInvoiceCols,
      invoiceNumber: `${MARKER}-UNPUSHED`,
    })
    .returning({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
    });

  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-admin@example.com`,
      passwordHash: "x",
      role: "admin",
      displayName: "Admin",
    })
    .returning({ id: usersTable.id });

  const [vendorUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-vendor@example.com`,
      passwordHash: "x",
      role: "vendor",
      displayName: "Vendor",
    })
    .returning({ id: usersTable.id });

  return {
    adminUserId: admin.id,
    vendorUserId: vendorUser.id,
    vendorId: vendor.id,
    partnerId: partner.id,
    invoiceQboOnlyId: invQbo.id,
    invoiceQboOnlyNumber: invQbo.invoiceNumber,
    invoiceBothId: invBoth.id,
    invoiceBothNumber: invBoth.invoiceNumber,
    invoiceUnpushedId: invUnpushed.id,
    invoiceUnpushedNumber: invUnpushed.invoiceNumber,
  };
}

async function seedPushRows(s: SeedIds): Promise<void> {
  const { db, accountingPushedInvoicesTable } = dbModule;
  await db.insert(accountingPushedInvoicesTable).values([
    {
      vendorId: s.vendorId,
      provider: "qbo",
      invoiceNumber: s.invoiceQboOnlyNumber,
      externalInvoiceId: "qbo-ext-1",
      externalDocNumber: "DOC-QBO-1",
    },
    {
      vendorId: s.vendorId,
      provider: "qbo",
      invoiceNumber: s.invoiceBothNumber,
      externalInvoiceId: "qbo-ext-2",
      externalDocNumber: "DOC-BOTH-QBO",
    },
    {
      vendorId: s.vendorId,
      provider: "oa",
      invoiceNumber: s.invoiceBothNumber,
      externalInvoiceId: "oa-ext-2",
      externalDocNumber: "DOC-BOTH-OA",
    },
  ]);
}

async function cleanup(): Promise<void> {
  const { db } = dbModule;
  await db.execute(
    sql`delete from report_export_audit_log where (scope->>'invoiceNumber') like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from accounting_pushed_invoices where invoice_number like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from invoices where invoice_number like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from users where username like ${MARKER + "-%"}`,
  );
  await db.execute(sql`delete from vendors where name like ${MARKER + "-%"}`);
  await db.execute(sql`delete from partners where name like ${MARKER + "-%"}`);
}

describe.runIf(haveRealDb)(
  "DELETE /invoices/:id/pushed/:provider",
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
      await seedPushRows(seeded);
    }, 30_000);

    afterAll(async () => {
      try {
        await cleanup();
      } finally {
        seeded = null;
      }
    });

    it("rejects unauthenticated callers with 401", async () => {
      const res = await request(app).delete(
        `/invoices/${seeded!.invoiceQboOnlyId}/pushed/qbo`,
      );
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("auth.not_authenticated");
    });

    it("rejects non-admin callers with 403 even if the vendor owns the invoice", async () => {
      const res = await request(app)
        .delete(`/invoices/${seeded!.invoiceQboOnlyId}/pushed/qbo`)
        .set("Cookie", vendorCookie(seeded!.vendorUserId, seeded!.vendorId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("auth.admin_only");

      // Mapping must still be present — the rejected call cannot have any
      // side effect on the underlying push record.
      const { db, accountingPushedInvoicesTable } = dbModule;
      const rows = await db
        .select()
        .from(accountingPushedInvoicesTable)
        .where(
          eq(
            accountingPushedInvoicesTable.invoiceNumber,
            seeded!.invoiceQboOnlyNumber,
          ),
        );
      expect(rows.length).toBe(1);
    });

    it("returns 400 for an unknown provider value", async () => {
      const res = await request(app)
        .delete(`/invoices/${seeded!.invoiceQboOnlyId}/pushed/xero`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation.invalid_input");
    });

    it("returns 404 for an unknown invoice id", async () => {
      const res = await request(app)
        .delete(`/invoices/999999999/pushed/qbo`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("invoice.not_found");
    });

    it("returns 404 (pushed.not_found) when no mapping exists for that provider", async () => {
      // The unpushed invoice has zero mapping rows for either provider.
      const res = await request(app)
        .delete(`/invoices/${seeded!.invoiceUnpushedId}/pushed/qbo`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("pushed.not_found");

      // No audit row should be written for a no-op delete — otherwise
      // the audit feed would fill up with confusing "forgotten" entries
      // for invoices that were never actually pushed.
      const { db, reportExportAuditLogTable } = dbModule;
      const auditRows = await db
        .select({ id: reportExportAuditLogTable.id })
        .from(reportExportAuditLogTable)
        .where(
          sql`(${reportExportAuditLogTable.scope}->>'invoiceNumber') = ${seeded!.invoiceUnpushedNumber}`,
        );
      expect(auditRows.length).toBe(0);
    });

    it("clears the QBO mapping, returns 200 with auditLogId, writes a qbo_api_forget audit row, and leaves the OA mapping untouched", async () => {
      const {
        db,
        accountingPushedInvoicesTable,
        reportExportAuditLogTable,
      } = dbModule;

      const res = await request(app)
        .delete(`/invoices/${seeded!.invoiceBothId}/pushed/qbo`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.body.ok).toBe(true);
      expect(res.body.provider).toBe("qbo");
      expect(res.body.invoiceNumber).toBe(seeded!.invoiceBothNumber);
      expect(res.body.externalInvoiceId).toBe("qbo-ext-2");
      expect(res.body.externalDocNumber).toBe("DOC-BOTH-QBO");
      expect(typeof res.body.auditLogId).toBe("number");
      expect(res.body.auditLogId).toBeGreaterThan(0);

      // The QBO row is gone …
      const remaining = await db
        .select()
        .from(accountingPushedInvoicesTable)
        .where(
          eq(
            accountingPushedInvoicesTable.invoiceNumber,
            seeded!.invoiceBothNumber,
          ),
        );
      // … but the OA row for the same invoice number must still be there.
      expect(remaining.length).toBe(1);
      expect(remaining[0].provider).toBe("oa");
      expect(remaining[0].externalInvoiceId).toBe("oa-ext-2");

      // Audit row matches the response and snapshots remote identifiers
      // into `scope` so the trail stays useful after the local row is gone.
      const [audit] = await db
        .select()
        .from(reportExportAuditLogTable)
        .where(eq(reportExportAuditLogTable.id, res.body.auditLogId));
      expect(audit).toBeDefined();
      expect(audit.format).toBe("qbo_api_forget");
      expect(audit.reportKind).toBe("vendor.quickbooksPush");
      expect(audit.downloadedByUserId).toBe(seeded!.adminUserId);
      expect(audit.userRole).toBe("admin");
      expect(audit.rowCount).toBe(1);
      expect(audit.fileBytes).toBe(0);
      const scope = audit.scope as Record<string, unknown>;
      expect(scope.invoiceId).toBe(seeded!.invoiceBothId);
      expect(scope.invoiceNumber).toBe(seeded!.invoiceBothNumber);
      expect(scope.provider).toBe("qbo");
      expect(scope.vendorId).toBe(seeded!.vendorId);
      expect(scope.externalInvoiceId).toBe("qbo-ext-2");
      expect(scope.externalDocNumber).toBe("DOC-BOTH-QBO");
      expect(scope.outcome).toBe("forgotten");
      expect(typeof scope.previouslyPushedAt).toBe("string");
      expect(() =>
        new Date(scope.previouslyPushedAt as string).toISOString(),
      ).not.toThrow();
    });

    it("clears the OA mapping with the oa_api_forget format and is idempotent on a second call (404)", async () => {
      const {
        db,
        accountingPushedInvoicesTable,
        reportExportAuditLogTable,
      } = dbModule;

      // First call clears the OA row left behind by the previous test.
      const res = await request(app)
        .delete(`/invoices/${seeded!.invoiceBothId}/pushed/oa`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.body.provider).toBe("oa");
      expect(res.body.externalInvoiceId).toBe("oa-ext-2");

      const [audit] = await db
        .select()
        .from(reportExportAuditLogTable)
        .where(eq(reportExportAuditLogTable.id, res.body.auditLogId));
      expect(audit.format).toBe("oa_api_forget");
      expect(audit.reportKind).toBe("vendor.openaccountantPush");
      const scope = audit.scope as Record<string, unknown>;
      expect(scope.provider).toBe("oa");

      // No mapping rows remain for this invoice.
      const remaining = await db
        .select()
        .from(accountingPushedInvoicesTable)
        .where(
          eq(
            accountingPushedInvoicesTable.invoiceNumber,
            seeded!.invoiceBothNumber,
          ),
        );
      expect(remaining.length).toBe(0);

      // Second call is a no-op: 404 with the pushed.not_found code.
      const res2 = await request(app)
        .delete(`/invoices/${seeded!.invoiceBothId}/pushed/oa`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expect(res2.status).toBe(404);
      expect(res2.body.code).toBe("pushed.not_found");
    });
  },
);

describe.skipIf(haveRealDb)(
  "DELETE /invoices/:id/pushed/:provider (skipped: no real DB)",
  () => {
    it("is skipped without DATABASE_URL", () => {
      expect(true).toBe(true);
    });
  },
);
