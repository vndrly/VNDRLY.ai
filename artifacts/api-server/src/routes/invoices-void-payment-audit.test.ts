import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Integration coverage for DELETE /invoices/:id/payments/:pid — the route
// finance relies on for "void / refund / reverse" actions. The handler is
// the sole writer of `invoice_payment_audit_log`, the append-only table
// finance reads when an auditor asks "who voided this payment, when, and
// why?". A regression that drops the audit insert (or stores the wrong
// action / reason / amount / actor) would silently destroy the paper
// trail, which is a compliance problem — exactly the same risk class
// task #301 just covered for the 1099 void filter.
//
// Two assertions guard the contract:
//   1. A successful void writes exactly one audit row with action='void'
//      and the right paymentId / invoiceId / actorUserId / reason / amount.
//   2. Voiding an already-voided payment returns 410 and does NOT append
//      a second audit row (the route short-circuits before the insert).
//
// Like the sibling integration files, the suite is gated on a real
// Postgres being reachable via DATABASE_URL — when the unit-only CI runs
// against the placeholder URL written by `src/test/setup.ts`, the
// describe is skipped instead of erroring.
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

const MARKER = `void-audit-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin",
  });
}

describe.runIf(haveRealDb)(
  "DELETE /invoices/:id/payments/:pid — audit log",
  () => {
    let s: typeof import("@workspace/db");
    let db: typeof import("@workspace/db").db;
    let app: express.Express;

    let partnerId = 0;
    let vendorId = 0;
    let adminUserId = 0;

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;

      const invoicesRouter = (await import("./invoices")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use(invoicesRouter);
      attachTestErrorMiddleware(app, { logErrors: false });

      const [partner] = await db
        .insert(s.partnersTable)
        .values({
          name: `${MARKER}-Partner`,
          contactName: "Pat",
          contactEmail: `${MARKER}-p@example.com`,
        })
        .returning({ id: s.partnersTable.id });
      partnerId = partner.id;

      const [vendor] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-Vendor`,
          contactName: "Vance",
          contactEmail: `${MARKER}-v@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      vendorId = vendor.id;

      const [admin] = await db
        .insert(s.usersTable)
        .values({
          username: `${MARKER}-admin@example.com`,
          passwordHash: "x",
          role: "admin",
          displayName: "Admin",
        })
        .returning({ id: s.usersTable.id });
      adminUserId = admin.id;
    }, 30_000);

    afterAll(async () => {
      // invoice_payment_audit_log cascades from invoice_payments (which
      // cascades from invoices), so deleting invoices by vendor cleans up
      // payments + audit rows in one shot.
      await db.execute(
        sql`delete from invoices where vendor_id = ${vendorId}`,
      );
      await db.execute(sql`delete from vendors where id = ${vendorId}`);
      await db.execute(sql`delete from partners where id = ${partnerId}`);
      await db.execute(sql`delete from users where id = ${adminUserId}`);
    });

    // Helper: insert an invoice + a single ACH payment so each test gets a
    // fresh payment to void without interfering with sibling tests.
    async function seedInvoiceWithPayment(opts: {
      invoiceNumber: string;
      amount: string;
    }): Promise<{ invoiceId: number; paymentId: number }> {
      const [invoice] = await db
        .insert(s.invoicesTable)
        .values({
          invoiceNumber: opts.invoiceNumber,
          vendorId,
          partnerId,
          cadence: "per_ticket",
          status: "paid",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T23:59:59Z"),
          subtotal: opts.amount,
          taxTotal: "0.00",
          total: opts.amount,
          paidAmount: opts.amount,
          paidAt: new Date("2026-06-01T12:00:00Z"),
        })
        .returning({ id: s.invoicesTable.id });

      const [payment] = await db
        .insert(s.invoicePaymentsTable)
        .values({
          invoiceId: invoice.id,
          method: "ach",
          amount: opts.amount,
          paidAt: new Date("2026-06-01T12:00:00Z"),
        })
        .returning({ id: s.invoicePaymentsTable.id });

      return { invoiceId: invoice.id, paymentId: payment.id };
    }

    it("voiding a payment writes one audit row with action='void' and the supplied reason / amount / actor", async () => {
      const { invoiceId, paymentId } = await seedInvoiceWithPayment({
        invoiceNumber: `${MARKER}-INV-A`,
        amount: "1234.56",
      });

      const reason = "duplicate ACH — vendor double-billed";
      const res = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", adminCookie(adminUserId))
        .send({ reason });
      expectStatus(res, 200);

      const auditRows = await db
        .select()
        .from(s.invoicePaymentAuditLogTable)
        .where(eq(s.invoicePaymentAuditLogTable.paymentId, paymentId));

      expect(auditRows).toHaveLength(1);
      const row = auditRows[0];
      expect(row.action).toBe("void");
      expect(row.paymentId).toBe(paymentId);
      expect(row.invoiceId).toBe(invoiceId);
      expect(row.actorUserId).toBe(adminUserId);
      expect(row.reason).toBe(reason);
      expect(row.amount).toBe("1234.56");

      // Sanity-check that the payment row itself was actually voided so
      // the assertion above can't pass against a still-active payment.
      const [payment] = await db
        .select()
        .from(s.invoicePaymentsTable)
        .where(eq(s.invoicePaymentsTable.id, paymentId));
      expect(payment.voidedAt).not.toBeNull();
      expect(payment.voidedByUserId).toBe(adminUserId);
      expect(payment.voidedReason).toBe(reason);
    });

    it("voiding an already-voided payment returns 410 and does not append a duplicate audit row", async () => {
      const { invoiceId, paymentId } = await seedInvoiceWithPayment({
        invoiceNumber: `${MARKER}-INV-B`,
        amount: "500.00",
      });

      const firstReason = "wrong account";
      const first = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", adminCookie(adminUserId))
        .send({ reason: firstReason });
      expectStatus(first, 200);

      const second = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", adminCookie(adminUserId))
        .send({ reason: "second attempt — should be rejected" });
      expectStatus(second, 410);
      expect(second.body.code).toBe("invoice.payment_already_voided");

      const auditRows = await db
        .select()
        .from(s.invoicePaymentAuditLogTable)
        .where(
          and(
            eq(s.invoicePaymentAuditLogTable.paymentId, paymentId),
            eq(s.invoicePaymentAuditLogTable.action, "void"),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].reason).toBe(firstReason);
    });
  },
);
