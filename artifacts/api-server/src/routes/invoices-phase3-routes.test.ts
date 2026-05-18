// ─────────────────────────────────────────────────────────────────────────────
// Task #234 — Supertest coverage for the Phase-3 invoice lifecycle routes:
//
//   POST   /invoices/:id/send
//   POST   /invoices/:id/payments
//   DELETE /invoices/:id/payments/:pid
//   POST   /invoices/:id/credit-memos
//   POST   /invoices/:id/remind
//   GET    /invoices/:id/pdf
//   GET    /vendors/:id/statement
//   GET    /partners/:id/statement
//
// Every endpoint is exercised three ways:
//   • happy path — admin (or the matching vendor/partner) gets a 2xx and the
//     downstream side effect (email send, payment row, status flip, …) lands.
//   • RBAC rejection — a session for the *wrong* vendor/partner is forbidden
//     even when the request body is otherwise valid.
//   • validation error — at least one of overpay / no-recipient / bad status
//     so the negative response codes (`invoice.overpay`, `invoice.no_recipient`,
//     `invoice.not_sendable`, `invoice.not_payable`, `invoice.not_creditable`,
//     `invoice.not_remindable`, `invoice.over_credit`) are wired up.
//
// SendGrid (and the in-app notification fan-out, the partner-contact email
// resolver, and the pdfkit renderer) are mocked via `vi.mock` so the suite
// never touches a real SMTP server, never inserts notification rows, and
// never spins up the PDF engine. The route still drives every database
// query / lock / transaction it normally would, against the isolated test DB
// provisioned by `scripts/run-with-test-db.ts`.
//
// Skips with `describe.runIf(haveRealDb)` when no usable DATABASE_URL is
// available, mirroring the pattern in `accounting/pushedInvoices.test.ts`
// so the offline unit-only run still passes.
// ─────────────────────────────────────────────────────────────────────────────
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";

// SendGrid: stub both invoice + reminder transports so nothing leaves the
// process. Tests assert these were called (or not called) for happy-path /
// validation-failure branches.
vi.mock("../lib/sendgrid", () => ({
  sendInvoiceEmail: vi.fn(async () => ({ messageId: "test-msg-send" })),
  sendInvoiceReminderEmail: vi.fn(async () => ({
    messageId: "test-msg-reminder",
  })),
}));

// In-app notifications fan-out: the routes log + swallow notify failures
// anyway, but stubbing keeps us off the user_notifications table entirely
// (which would otherwise need a real users row per recipient).
vi.mock("./notifications", async () => {
  const actual =
    await vi.importActual<typeof import("./notifications")>("./notifications");
  return {
    ...actual,
    notifyUsers: vi.fn(async () => 0),
  };
});

// Recipient resolution: default to a known good email + locale so happy
// paths succeed. The "missing recipient" test case overrides the email mock
// per-call with `mockResolvedValueOnce(null)`.
vi.mock("../lib/invoice-recipients", () => ({
  resolveBillingEmail: vi.fn(async () => "billing@example.com"),
  resolveBillingLocale: vi.fn(async () => "en" as const),
  findPartnerBillingUserIds: vi.fn(async () => []),
  findVendorUserIds: vi.fn(async () => []),
}));

// PDF rendering: pdfkit is heavy and writes binary; a tiny Buffer stub is
// enough for the route's content-type / content-length / send-log writes.
vi.mock("../lib/invoice-pdf", () => ({
  renderInvoicePdf: vi.fn(async () => Buffer.from("%PDF-1.4 stub bytes")),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  // The placeholder URL written by `src/test/setup.ts` for offline unit-only
  // runs has no live server behind it.
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

// All seeded rows carry this marker so cleanup can target only what the suite
// created without touching pre-existing data in the dev DB.
const MARKER = `inv-routes-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)("invoices Phase-3 routes (real DB)", () => {
  let dbm: typeof import("@workspace/db");
  let sendgridMock: typeof import("../lib/sendgrid");
  let recipientsMock: typeof import("../lib/invoice-recipients");
  let app: express.Express;

  let adminUserId = 0;
  let vendorAId = 0;
  let vendorBId = 0;
  let partnerAId = 0;
  let partnerBId = 0;

  // Per-test invoice number suffix so each test gets a fresh row that the
  // route can mutate without crosstalk.
  let invoiceCounter = 0;

  function adminCookie(): string {
    return buildTestCookie({
      userId: adminUserId,
      role: "admin",
      displayName: "Admin",
    });
  }
  function vendorCookie(vendorId: number): string {
    return buildTestCookie({
      userId: adminUserId,
      role: "vendor",
      vendorId,
      displayName: "Vendor",
    });
  }
  function partnerCookie(partnerId: number): string {
    return buildTestCookie({
      userId: adminUserId,
      role: "partner",
      partnerId,
      displayName: "Partner",
    });
  }

  async function seedInvoice(args: {
    status: "draft" | "open" | "sent" | "paid" | "overdue" | "cancelled";
    total?: string;
    paidAmount?: string;
    creditedAmount?: string;
    vendorId?: number;
    partnerId?: number;
    dueDate?: Date | null;
  }): Promise<number> {
    invoiceCounter += 1;
    const num = `${MARKER}-${invoiceCounter}`;
    // Use a unique periodStart per seeded invoice so the
    // `invoices_unique_draft_per_period` partial-unique index can't fire
    // when more than one draft fixture lands under the same (vendor,
    // partner, cadence) pair.
    const periodStart = new Date(
      Date.UTC(2026, 2, 1) + invoiceCounter * 24 * 60 * 60 * 1000,
    );
    const periodEnd = new Date(
      Date.UTC(2026, 2, 1) + (invoiceCounter + 30) * 24 * 60 * 60 * 1000,
    );
    const [row] = await dbm.db
      .insert(dbm.invoicesTable)
      .values({
        invoiceNumber: num,
        vendorId: args.vendorId ?? vendorAId,
        partnerId: args.partnerId ?? partnerAId,
        cadence: "per_ticket",
        status: args.status,
        periodStart,
        periodEnd,
        dueDate: args.dueDate === undefined
          ? new Date("2026-04-30T23:59:59Z")
          : args.dueDate,
        paymentTermsDays: 30,
        subtotal: args.total ?? "100.00",
        taxTotal: "0.00",
        total: args.total ?? "100.00",
        paidAmount: args.paidAmount ?? "0",
        creditedAmount: args.creditedAmount ?? "0",
      })
      .returning({ id: dbm.invoicesTable.id });
    return row!.id;
  }

  async function insertPayment(opts: {
    invoiceId: number;
    amount: string;
    voided?: boolean;
  }): Promise<number> {
    const [row] = await dbm.db
      .insert(dbm.invoicePaymentsTable)
      .values({
        invoiceId: opts.invoiceId,
        method: "ach",
        amount: opts.amount,
        paidAt: new Date("2026-04-15T12:00:00Z"),
        recordedByUserId: adminUserId,
        markedByPartner: false,
        voidedAt: opts.voided ? new Date() : null,
        voidedByUserId: opts.voided ? adminUserId : null,
        voidedReason: opts.voided ? "test-pre-voided" : null,
      })
      .returning({ id: dbm.invoicePaymentsTable.id });
    return row!.id;
  }

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    sendgridMock = await import("../lib/sendgrid");
    recipientsMock = await import("../lib/invoice-recipients");
    const invoicesRouter = (await import("./invoices")).default;

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(invoicesRouter);
    attachTestErrorMiddleware(app, { logErrors: false });

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

    const [vA] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-VA`,
        contactName: "VA",
        contactEmail: `${MARKER}-va@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    const [vB] = await dbm.db
      .insert(dbm.vendorsTable)
      .values({
        name: `${MARKER}-VB`,
        contactName: "VB",
        contactEmail: `${MARKER}-vb@example.com`,
      })
      .returning({ id: dbm.vendorsTable.id });
    vendorAId = vA.id;
    vendorBId = vB.id;

    const [pA] = await dbm.db
      .insert(dbm.partnersTable)
      .values({
        name: `${MARKER}-PA`,
        contactName: "PA",
        contactEmail: `${MARKER}-pa@example.com`,
      })
      .returning({ id: dbm.partnersTable.id });
    const [pB] = await dbm.db
      .insert(dbm.partnersTable)
      .values({
        name: `${MARKER}-PB`,
        contactName: "PB",
        contactEmail: `${MARKER}-pb@example.com`,
      })
      .returning({ id: dbm.partnersTable.id });
    partnerAId = pA.id;
    partnerBId = pB.id;
  }, 30_000);

  afterAll(async () => {
    if (!dbm) return;
    // Order matters: child rows first to avoid FK violations against
    // invoices / users / vendors / partners.
    await dbm.db.execute(
      sql`delete from invoice_payment_audit_log where invoice_id in (
            select id from invoices where invoice_number like ${`${MARKER}-%`}
          )`,
    );
    await dbm.db.execute(
      sql`delete from invoice_payments where invoice_id in (
            select id from invoices where invoice_number like ${`${MARKER}-%`}
          )`,
    );
    await dbm.db.execute(
      sql`delete from invoice_credit_memos where invoice_id in (
            select id from invoices where invoice_number like ${`${MARKER}-%`}
          )`,
    );
    await dbm.db.execute(
      sql`delete from invoice_send_log where invoice_id in (
            select id from invoices where invoice_number like ${`${MARKER}-%`}
          )`,
    );
    await dbm.db.execute(
      sql`delete from invoice_reminder_log where invoice_id in (
            select id from invoices where invoice_number like ${`${MARKER}-%`}
          )`,
    );
    await dbm.db.execute(
      sql`delete from invoices where invoice_number like ${`${MARKER}-%`}`,
    );
    if (adminUserId) {
      await dbm.db.execute(sql`delete from users where id = ${adminUserId}`);
    }
    if (vendorAId || vendorBId) {
      await dbm.db.execute(
        sql`delete from vendors where id in (${vendorAId}, ${vendorBId})`,
      );
    }
    if (partnerAId || partnerBId) {
      await dbm.db.execute(
        sql`delete from partners where id in (${partnerAId}, ${partnerBId})`,
      );
    }
  });

  beforeEach(() => {
    // Clear call history but keep the default impls installed in vi.mock().
    vi.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /invoices/:id/send
  // ───────────────────────────────────────────────────────────────────
  describe("POST /invoices/:id/send", () => {
    it("admin sends an open invoice → 200, status flips to 'sent', email is dispatched", async () => {
      const invoiceId = await seedInvoice({ status: "open", total: "200.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/send`)
        .set("Cookie", adminCookie())
        .send({});
      expectStatus(res, 200);
      expect(res.body).toMatchObject({
        sent: true,
        toEmail: "billing@example.com",
        messageId: "test-msg-send",
        failureMessage: null,
      });
      expect(res.body.invoice.status).toBe("sent");
      expect(res.body.invoice.billingContactEmail).toBe("billing@example.com");
      expect(vi.mocked(sendgridMock.sendInvoiceEmail)).toHaveBeenCalledTimes(1);
    });

    it("rejects a vendor session for a different vendor with 403", async () => {
      const invoiceId = await seedInvoice({ status: "open" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/send`)
        .set("Cookie", vendorCookie(vendorBId))
        .send({});
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
      expect(vi.mocked(sendgridMock.sendInvoiceEmail)).not.toHaveBeenCalled();
    });

    it("returns 409 invoice.not_sendable when the invoice is already paid", async () => {
      const invoiceId = await seedInvoice({
        status: "paid",
        total: "100.00",
        paidAmount: "100.00",
      });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/send`)
        .set("Cookie", adminCookie())
        .send({});
      expectStatus(res, 409);
      expect(res.body.code).toBe("invoice.not_sendable");
      expect(vi.mocked(sendgridMock.sendInvoiceEmail)).not.toHaveBeenCalled();
    });

    it("returns 400 invoice.no_recipient when the email resolver returns null", async () => {
      vi.mocked(recipientsMock.resolveBillingEmail).mockResolvedValueOnce(
        null,
      );
      const invoiceId = await seedInvoice({ status: "open" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/send`)
        .set("Cookie", adminCookie())
        .send({});
      expectStatus(res, 400);
      expect(res.body.code).toBe("invoice.no_recipient");
      expect(vi.mocked(sendgridMock.sendInvoiceEmail)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /invoices/:id/payments
  // ───────────────────────────────────────────────────────────────────
  describe("POST /invoices/:id/payments", () => {
    it("admin records a partial payment → 201, paid_amount updated, status stays sent", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/payments`)
        .set("Cookie", adminCookie())
        .send({
          method: "ach",
          amount: "40.00",
          paidAt: "2026-04-15T12:00:00Z",
        });
      expectStatus(res, 201);
      expect(res.body.invoice.status).toBe("sent");
      expect(res.body.invoice.paidAmount).toBe("40.00");
      expect(res.body.balanceDue).toBe("60.00");
      expect(typeof res.body.payment.id).toBe("number");
    });

    it("rejects a vendor session for a different vendor with 403 (primary ownership boundary)", async () => {
      // The primary RBAC check on this route is `session.vendorId === pre.vendorId`.
      // A vendor cookie scoped to vendorBId must NOT be able to record a
      // payment against an invoice owned by vendorAId — otherwise vendor B
      // could falsify vendor A's payment ledger.
      const invoiceId = await seedInvoice({
        status: "sent",
        total: "100.00",
        vendorId: vendorAId,
      });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/payments`)
        .set("Cookie", vendorCookie(vendorBId))
        .send({
          method: "ach",
          amount: "10.00",
          paidAt: "2026-04-15T12:00:00Z",
        });
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("rejects a partner session with 403 (partners may never self-record payments)", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/payments`)
        .set("Cookie", partnerCookie(partnerAId))
        .send({
          method: "ach",
          amount: "10.00",
          paidAt: "2026-04-15T12:00:00Z",
        });
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("returns 409 invoice.not_payable on a draft invoice (bad status)", async () => {
      const invoiceId = await seedInvoice({ status: "draft", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/payments`)
        .set("Cookie", adminCookie())
        .send({
          method: "ach",
          amount: "10.00",
          paidAt: "2026-04-15T12:00:00Z",
        });
      expectStatus(res, 409);
      expect(res.body.code).toBe("invoice.not_payable");
    });

    it("returns 409 invoice.overpay when amount exceeds the balance", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/payments`)
        .set("Cookie", adminCookie())
        .send({
          method: "ach",
          amount: "250.00",
          paidAt: "2026-04-15T12:00:00Z",
        });
      expectStatus(res, 409);
      expect(res.body.code).toBe("invoice.overpay");
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // DELETE /invoices/:id/payments/:pid
  // ───────────────────────────────────────────────────────────────────
  describe("DELETE /invoices/:id/payments/:pid", () => {
    it("admin voids an existing payment → 200, balance reopens", async () => {
      const invoiceId = await seedInvoice({
        status: "paid",
        total: "100.00",
        paidAmount: "100.00",
      });
      const paymentId = await insertPayment({ invoiceId, amount: "100.00" });
      const res = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", adminCookie())
        .send({ reason: "test-void" });
      expectStatus(res, 200);
      // Voiding the only payment must drop paid_amount back to 0 and reopen
      // the invoice to "sent" so the collection / aging worker pick it back
      // up.
      expect(res.body.invoice.status).toBe("sent");
      expect(res.body.invoice.paidAmount).toBe("0.00");
      expect(res.body.balanceDue).toBe("100.00");
    });

    it("rejects a vendor session for a different vendor with 403 (primary ownership boundary)", async () => {
      // Vendor B must not be able to void a payment recorded against an
      // invoice owned by vendor A — the void path reopens the invoice and
      // mutates paid_amount, so a cross-vendor void is exactly the kind of
      // ledger-tampering the RBAC gate exists to stop.
      const invoiceId = await seedInvoice({
        status: "sent",
        total: "100.00",
        vendorId: vendorAId,
      });
      const paymentId = await insertPayment({ invoiceId, amount: "10.00" });
      const res = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", vendorCookie(vendorBId))
        .send({});
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("rejects a partner session with 403", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const paymentId = await insertPayment({ invoiceId, amount: "10.00" });
      const res = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", partnerCookie(partnerAId))
        .send({});
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("returns 410 invoice.payment_already_voided when the payment was previously voided", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const paymentId = await insertPayment({
        invoiceId,
        amount: "10.00",
        voided: true,
      });
      const res = await request(app)
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set("Cookie", adminCookie())
        .send({});
      expectStatus(res, 410);
      expect(res.body.code).toBe("invoice.payment_already_voided");
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /invoices/:id/credit-memos
  // ───────────────────────────────────────────────────────────────────
  describe("POST /invoices/:id/credit-memos", () => {
    it("admin issues a partial credit memo → 201, credited_amount updated", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/credit-memos`)
        .set("Cookie", adminCookie())
        .send({ amount: "30.00", reason: "goodwill adjustment" });
      expectStatus(res, 201);
      expect(res.body.invoice.creditedAmount).toBe("30.00");
      expect(res.body.balanceDue).toBe("70.00");
      expect(typeof res.body.creditMemo.id).toBe("number");
    });

    it("rejects a vendor session for a different vendor with 403 (primary ownership boundary)", async () => {
      // Vendor B must not be able to issue a credit memo against an invoice
      // owned by vendor A. The credit-memo path mutates credit_total /
      // balance_due, so a cross-vendor credit is exactly the kind of
      // ledger-tampering the RBAC gate exists to stop.
      const invoiceId = await seedInvoice({
        status: "sent",
        total: "100.00",
        vendorId: vendorAId,
      });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/credit-memos`)
        .set("Cookie", vendorCookie(vendorBId))
        .send({
          amount: "5.00",
          reason: "billing_error",
          memo: "x",
        });
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("rejects a partner session with 403 (partners may never issue credit memos)", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/credit-memos`)
        .set("Cookie", partnerCookie(partnerAId))
        .send({ amount: "10.00", reason: "test" });
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("returns 409 invoice.not_creditable on a draft invoice", async () => {
      const invoiceId = await seedInvoice({ status: "draft", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/credit-memos`)
        .set("Cookie", adminCookie())
        .send({ amount: "10.00", reason: "test" });
      expectStatus(res, 409);
      expect(res.body.code).toBe("invoice.not_creditable");
    });

    it("returns 409 invoice.over_credit when the credit exceeds the balance", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/credit-memos`)
        .set("Cookie", adminCookie())
        .send({ amount: "999.00", reason: "test overcredit" });
      expectStatus(res, 409);
      expect(res.body.code).toBe("invoice.over_credit");
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /invoices/:id/remind
  // ───────────────────────────────────────────────────────────────────
  describe("POST /invoices/:id/remind", () => {
    it("admin reminds a sent invoice → 201, reminder email is dispatched", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/remind`)
        .set("Cookie", adminCookie())
        .send({});
      expectStatus(res, 201);
      expect(res.body).toMatchObject({
        sent: true,
        toEmail: "billing@example.com",
        messageId: "test-msg-reminder",
        failureMessage: null,
      });
      expect(
        vi.mocked(sendgridMock.sendInvoiceReminderEmail),
      ).toHaveBeenCalledTimes(1);
    });

    it("rejects a partner session for a different partner with 403", async () => {
      const invoiceId = await seedInvoice({
        status: "sent",
        total: "100.00",
        partnerId: partnerAId,
      });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/remind`)
        .set("Cookie", partnerCookie(partnerBId))
        .send({});
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
      expect(
        vi.mocked(sendgridMock.sendInvoiceReminderEmail),
      ).not.toHaveBeenCalled();
    });

    it("returns 409 invoice.not_remindable on a paid invoice (bad status)", async () => {
      const invoiceId = await seedInvoice({
        status: "paid",
        total: "100.00",
        paidAmount: "100.00",
      });
      const res = await request(app)
        .post(`/invoices/${invoiceId}/remind`)
        .set("Cookie", adminCookie())
        .send({});
      expectStatus(res, 409);
      expect(res.body.code).toBe("invoice.not_remindable");
      expect(
        vi.mocked(sendgridMock.sendInvoiceReminderEmail),
      ).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /invoices/:id/pdf
  // ───────────────────────────────────────────────────────────────────
  describe("GET /invoices/:id/pdf", () => {
    it("admin downloads the PDF → 200 with application/pdf body", async () => {
      const invoiceId = await seedInvoice({ status: "sent", total: "100.00" });
      const res = await request(app)
        .get(`/invoices/${invoiceId}/pdf`)
        .set("Cookie", adminCookie());
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
      expect(res.headers["content-disposition"]).toMatch(/inline; filename=/);
      // The mocked renderer returns a tiny stub buffer (>0 bytes).
      expect(Number(res.headers["content-length"])).toBeGreaterThan(0);
    });

    it("rejects a vendor session for a different vendor with 403", async () => {
      const invoiceId = await seedInvoice({
        status: "sent",
        total: "100.00",
        vendorId: vendorAId,
      });
      const res = await request(app)
        .get(`/invoices/${invoiceId}/pdf`)
        .set("Cookie", vendorCookie(vendorBId));
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("returns 404 invoice.not_found for an unknown invoice id", async () => {
      const res = await request(app)
        .get(`/invoices/999999999/pdf`)
        .set("Cookie", adminCookie());
      expectStatus(res, 404);
      expect(res.body.code).toBe("invoice.not_found");
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /vendors/:vendorId/statement
  // ───────────────────────────────────────────────────────────────────
  describe("GET /vendors/:vendorId/statement", () => {
    it("admin gets a statement scoped to the vendor → 200 with party + rows + totals", async () => {
      // Two open invoices for vendorA + a paid one (filtered out by the
      // default `scope=open`) so we can assert the route applies its
      // balance-due filter and totals only sum the open rows.
      await seedInvoice({ status: "sent", total: "100.00" });
      await seedInvoice({ status: "open", total: "50.00" });
      await seedInvoice({
        status: "paid",
        total: "70.00",
        paidAmount: "70.00",
      });
      const res = await request(app)
        .get(`/vendors/${vendorAId}/statement`)
        .set("Cookie", adminCookie());
      expectStatus(res, 200);
      expect(res.body.party).toEqual({
        id: vendorAId,
        name: `${MARKER}-VA`,
      });
      expect(Array.isArray(res.body.rows)).toBe(true);
      // We can't assert exact counts because the suite seeds many invoices
      // across tests (and afterAll only runs once at the end), but every
      // returned row must be open/sent/overdue and have a positive balance.
      for (const row of res.body.rows as Array<{
        status: string;
        balanceDue: string;
      }>) {
        expect(["open", "sent", "overdue"]).toContain(row.status);
        expect(Number(row.balanceDue)).toBeGreaterThan(0);
      }
      expect(res.body.totals).toMatchObject({
        invoiced: expect.any(String),
        paid: expect.any(String),
        credited: expect.any(String),
        outstanding: expect.any(String),
      });
    });

    it("rejects a vendor session for a different vendor with 403", async () => {
      const res = await request(app)
        .get(`/vendors/${vendorAId}/statement`)
        .set("Cookie", vendorCookie(vendorBId));
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("returns 400 vendor.invalid_id for a non-positive vendorId", async () => {
      const res = await request(app)
        .get(`/vendors/0/statement`)
        .set("Cookie", adminCookie());
      expectStatus(res, 400);
      expect(res.body.code).toBe("vendor.invalid_id");
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /partners/:partnerId/statement
  // ───────────────────────────────────────────────────────────────────
  describe("GET /partners/:partnerId/statement", () => {
    it("admin gets a statement scoped to the partner → 200 with party + rows + totals", async () => {
      await seedInvoice({ status: "sent", total: "120.00" });
      const res = await request(app)
        .get(`/partners/${partnerAId}/statement`)
        .set("Cookie", adminCookie());
      expectStatus(res, 200);
      expect(res.body.party).toEqual({
        id: partnerAId,
        name: `${MARKER}-PA`,
      });
      expect(Array.isArray(res.body.rows)).toBe(true);
      expect(res.body.totals).toMatchObject({
        invoiced: expect.any(String),
        paid: expect.any(String),
        credited: expect.any(String),
        outstanding: expect.any(String),
      });
    });

    it("rejects a partner session for a different partner with 403", async () => {
      const res = await request(app)
        .get(`/partners/${partnerAId}/statement`)
        .set("Cookie", partnerCookie(partnerBId));
      expectStatus(res, 403);
      expect(res.body.code).toBe("auth.forbidden");
    });

    it("returns 400 partner.invalid_id for a non-positive partnerId", async () => {
      const res = await request(app)
        .get(`/partners/-3/statement`)
        .set("Cookie", adminCookie());
      expectStatus(res, 400);
      expect(res.body.code).toBe("partner.invalid_id");
    });
  });
});

describe.skipIf(haveRealDb)(
  "invoices Phase-3 routes (skipped: no real DB)",
  () => {
    it("is skipped without a usable DATABASE_URL", () => {
      expect(true).toBe(true);
    });
  },
);
