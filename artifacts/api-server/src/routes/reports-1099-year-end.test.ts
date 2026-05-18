import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// End-to-end coverage for the year-end 1099 dashboard, FIRE export, and
// filing-status persistence. Existing unit tests cover the pure rollups
// (rollupMisc / rollupK / FIRE field encoders) and a smoke test asserts
// the dashboard cards render. This suite exercises the *full* flow with
// realistic invoice + payment data so a regression in the aggregation
// SQL — e.g. a wrong join condition between invoices, payments, vendors
// and partners — is caught before it ships.
//
// Like the notification-helper suite, this file requires a real Postgres
// (with the schema pushed). When DATABASE_URL is unset or points at the
// placeholder used by the unit-test setup, the suite is skipped so CI
// without a DB still passes.
// ---------------------------------------------------------------------------

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
const MARKER = `r1099-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Year chosen so that all three forms share a single $600 reporting
// threshold (the 1099-K phase-in lands at $600 in TY 2026 per IRS Pub
// 1220), keeping the seeded amounts small and the math obvious.
const TAX_YEAR = 2026;

interface SeedIds {
  partnerId: number;
  partnerEinDigits: string;
  vendorAId: number; // NEC-only via ACH
  vendorBId: number; // MISC across rents/medical/attorney via ACH
  vendorCId: number; // 1099-K (credit_card)
  adminUserId: number;
  partnerUserId: number;
  invoiceAId: number;
  invoiceBId: number;
  invoiceCId: number;
}

let seeded: SeedIds | null = null;
let dbModule: typeof import("@workspace/db");
let app: express.Express;


function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin User",
  });
}

function partnerCookie(userId: number, partnerId: number): string {
  return buildTestCookie({
    userId,
    role: "partner",
    partnerId,
    displayName: "Partner User",
  });
}

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    invoicesTable,
    invoiceLinesTable,
    invoicePaymentsTable,
    usersTable,
    userOrgMembershipsTable,
  } = dbModule;

  // Random per-run payer EIN so concurrent or repeated runs against the
  // same dev DB never collide when we scan the FIRE output for "our"
  // payer-block by EIN.
  const partnerEin = String(900_000_000 + Math.floor(Math.random() * 99_999_999))
    .padStart(9, "0")
    .slice(0, 9);
  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-Energy Corp`,
      contactName: "AP",
      contactEmail: `${MARKER}-ap@example.com`,
      billingAddress: "100 Big Ave, Houston, TX 77001",
      physicalAddress: "100 Big Ave, Houston, TX 77001",
      federalTaxId: partnerEin,
      businessPhone: "5550001111",
    })
    .returning({ id: partnersTable.id });

  const [vendorA] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Acme Drilling LLC`,
      contactName: "Owner",
      contactEmail: `${MARKER}-acme@example.com`,
      billingAddress: "1 Main St, Midland, TX 79701",
      federalTaxId: "111223333",
      eDeliveryConsent: true,
    })
    .returning({ id: vendorsTable.id });

  const [vendorB] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Big Rentals Inc`,
      contactName: "Owner",
      contactEmail: `${MARKER}-big@example.com`,
      billingAddress: "200 Oak St, Austin, TX 78701",
      federalTaxId: "222334444",
    })
    .returning({ id: vendorsTable.id });

  const [vendorC] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Card Co`,
      contactName: "Owner",
      contactEmail: `${MARKER}-card@example.com`,
      billingAddress: "300 Elm St, Dallas, TX 75201",
      federalTaxId: "333445555",
    })
    .returning({ id: vendorsTable.id });

  const periodStart = new Date(Date.UTC(TAX_YEAR, 5, 1));
  const periodEnd = new Date(Date.UTC(TAX_YEAR, 5, 30, 23, 59, 59));
  const paidAt = new Date(Date.UTC(TAX_YEAR, 6, 15, 12, 0, 0));

  // Invoice A: vendor A — pure NEC service work paid by ACH.
  const [invA] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-A-001`,
      vendorId: vendorA.id,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "5000.00",
      taxTotal: "0.00",
      total: "5000.00",
      paidAmount: "5000.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invA.id,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Drilling labor — June",
    quantity: "1.0000",
    unitPrice: "5000.0000",
    amount: "5000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invA.id,
    method: "ach",
    amount: "5000.00",
    paidAt,
  });

  // Invoice B: vendor B — three MISC categories on one invoice, paid in
  // full by ACH. Each line crosses its $600 (or $10 royalty) threshold,
  // so all three boxes appear on the MISC report.
  const [invB] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-B-001`,
      vendorId: vendorB.id,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "4300.00",
      taxTotal: "0.00",
      total: "4300.00",
      paidAmount: "4300.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values([
    {
      invoiceId: invB.id,
      sourceType: "manual",
      lineType: "other",
      description: "Equipment rental — June",
      quantity: "1.0000",
      unitPrice: "2000.0000",
      amount: "2000.00",
      incomeCategory: "misc_rents",
    },
    {
      invoiceId: invB.id,
      sourceType: "manual",
      lineType: "other",
      description: "Medical services",
      quantity: "1.0000",
      unitPrice: "1500.0000",
      amount: "1500.00",
      incomeCategory: "misc_medical_health",
    },
    {
      invoiceId: invB.id,
      sourceType: "manual",
      lineType: "other",
      description: "Legal fees",
      quantity: "1.0000",
      unitPrice: "800.0000",
      amount: "800.00",
      incomeCategory: "misc_attorney",
    },
  ]);
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invB.id,
    method: "ach",
    amount: "4300.00",
    paidAt,
  });

  // Invoice C: vendor C — single labor line paid in three credit-card
  // installments across different months so the 1099-K monthly breakout
  // has multiple non-zero buckets to assert on.
  const [invC] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-C-001`,
      vendorId: vendorC.id,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "10000.00",
      taxTotal: "0.00",
      total: "10000.00",
      paidAmount: "10000.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invC.id,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Card-paid services",
    quantity: "1.0000",
    unitPrice: "10000.0000",
    amount: "10000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values([
    {
      invoiceId: invC.id,
      method: "credit_card",
      amount: "4000.00",
      paidAt: new Date(Date.UTC(TAX_YEAR, 0, 15)),
    },
    {
      invoiceId: invC.id,
      method: "credit_card",
      amount: "3000.00",
      paidAt: new Date(Date.UTC(TAX_YEAR, 5, 20)),
    },
    {
      invoiceId: invC.id,
      method: "credit_card",
      amount: "3000.00",
      paidAt: new Date(Date.UTC(TAX_YEAR, 11, 1)),
    },
  ]);

  // Users + memberships so the audit log has a downloader and the partner
  // RBAC path can be exercised end to end.
  const [adminUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-admin@example.com`,
      passwordHash: "x",
      role: "admin",
      displayName: `${MARKER} Admin`,
    })
    .returning({ id: usersTable.id });
  const [partnerUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-partner@example.com`,
      passwordHash: "x",
      role: "member",
      displayName: `${MARKER} Partner`,
    })
    .returning({ id: usersTable.id });
  await db.insert(userOrgMembershipsTable).values({
    userId: partnerUser.id,
    orgType: "partner",
    partnerId: partner.id,
    role: "admin",
  });

  return {
    partnerId: partner.id,
    partnerEinDigits: partnerEin,
    vendorAId: vendorA.id,
    vendorBId: vendorB.id,
    vendorCId: vendorC.id,
    adminUserId: adminUser.id,
    partnerUserId: partnerUser.id,
    invoiceAId: invA.id,
    invoiceBId: invB.id,
    invoiceCId: invC.id,
  };
}

async function cleanup(): Promise<void> {
  const { db } = dbModule;
  // Delete in dependency order. The marker prefix on partner / vendor /
  // user names lets us delete only rows this suite created.
  await db.execute(
    sql`delete from invoice_payments where invoice_id in (select id from invoices where invoice_number like ${MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from invoice_lines where invoice_id in (select id from invoices where invoice_number like ${MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from invoices where invoice_number like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from tax_1099_filings where payer_partner_id in (select id from partners where name like ${MARKER + "-%"})`,
  );
  // Audit-log scopes for the admin FIRE export are { year, formType, test }
  // and don't carry the marker, so clean up by downloader user id (which is
  // the seeded admin) — that's the only audit row this suite produces.
  // Pair it with the marker-scoped clause for partner-scoped exports whose
  // scope payload includes partnerId.
  await db.execute(
    sql`delete from report_export_audit_log
      where downloaded_by_user_id in (select id from users where username like ${MARKER + "-%"})
         or scope::text like ${"%" + MARKER + "%"}
         or scope->>'partnerId' in (select id::text from partners where name like ${MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from user_org_memberships where user_id in (select id from users where username like ${MARKER + "-%"})`,
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

// Default IRS FIRE transmitter values seeded into the singleton
// `fire_transmitter_settings` row so the "no real FIRE file with
// placeholder transmitter info" guard is satisfied for the suite.
// Task #826 removed the legacy `IRS_FIRE_*` env-var fallback so the
// row is now the only source of truth — individual tests that need
// to exercise the missing-fields guard wipe the row in their own
// finally block.
const FIRE_ROW_FIELDS = [
  "tcc",
  "ein",
  "name",
  "address",
  "contactName",
  "contactPhone",
  "contactEmail",
] as const;

const FIRE_ROW_DEFAULTS: Record<(typeof FIRE_ROW_FIELDS)[number], string> = {
  tcc: "9XYZ1",
  ein: "987654321",
  name: "VNDRLY TEST INC",
  address: "100 Main St, Austin, TX 78701",
  contactName: "Tax Ops",
  contactPhone: "5125551212",
  contactEmail: "tax-ops@vndrly.test",
};

// id=1 singleton. Re-declared here (not imported from
// transmitter-settings.ts) so the test file's import graph stays
// flat — vendor lib imports are pulled in lazily via dbModule.
const FIRE_TRANSMITTER_SETTINGS_ID = 1;

async function seedFireTransmitterRow(
  values: Record<(typeof FIRE_ROW_FIELDS)[number], string | null> = FIRE_ROW_DEFAULTS,
): Promise<void> {
  await dbModule.db
    .insert(dbModule.fireTransmitterSettingsTable)
    .values({ id: FIRE_TRANSMITTER_SETTINGS_ID, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dbModule.fireTransmitterSettingsTable.id,
      set: { ...values, updatedAt: new Date() },
    });
}

async function deleteFireTransmitterRow(): Promise<void> {
  await dbModule.db.delete(dbModule.fireTransmitterSettingsTable);
}

describe.runIf(haveRealDb)("year-end 1099 dashboard + FIRE + filing status", () => {
  beforeAll(async () => {
    dbModule = await import("@workspace/db");
    const reportsRouter = (await import("./reports")).default;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(reportsRouter);
    attachTestErrorMiddleware(app);
    seeded = await seed();
    await seedFireTransmitterRow();
  }, 30_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await deleteFireTransmitterRow();
      seeded = null;
    }
  });

  describe("/reports/admin/1099-dashboard", () => {
    it("returns one row per (form, recipient) with correct totals", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      const rows = (
        res.body.rows as Array<{
          formType: string;
          recipientVendorId: number;
          totalReportable: string;
          payerPartnerId: number;
          eDeliveryConsent: boolean;
          status: string;
          monthly: string[];
          transactionCount: number;
        }>
      ).filter((r) => r.payerPartnerId === seeded!.partnerId);

      const necRows = rows.filter((r) => r.formType === "NEC");
      const miscRows = rows.filter((r) => r.formType === "MISC");
      const kRows = rows.filter((r) => r.formType === "K");

      // nec1099 only counts lines categorized as `nec` and excludes
      // credit-card payments (those belong on 1099-K), so:
      //   * vendor A (NEC line, ACH payment) → on NEC
      //   * vendor B (only misc_* lines) → NOT on NEC
      //   * vendor C (NEC line but credit-card payment) → NOT on NEC
      // This avoids the same dollars showing up on multiple forms for
      // the same recipient.
      expect(necRows).toHaveLength(1);
      const necByVendor = new Map(
        necRows.map((r) => [r.recipientVendorId, r.totalReportable]),
      );
      expect(necByVendor.get(seeded!.vendorAId)).toBe("5000.00");
      expect(necByVendor.has(seeded!.vendorBId)).toBe(false);
      expect(necByVendor.has(seeded!.vendorCId)).toBe(false);

      // MISC: only vendor B; total is the sum of its three boxes.
      expect(miscRows).toHaveLength(1);
      expect(miscRows[0].recipientVendorId).toBe(seeded!.vendorBId);
      expect(miscRows[0].totalReportable).toBe("4300.00");

      // K: only vendor C — credit-card payments only.
      expect(kRows).toHaveLength(1);
      expect(kRows[0].recipientVendorId).toBe(seeded!.vendorCId);
      expect(kRows[0].totalReportable).toBe("10000.00");

      // 1099-K monthly breakout (Boxes 5a-5l) is what the dashboard
      // surfaces for partner reviewers — assert the seeded installments
      // land in Jan / Jun / Dec and the rest are zero, plus the txn
      // count (Box 3) matches the three credit-card payments.
      expect(kRows[0].monthly).toHaveLength(12);
      expect(kRows[0].monthly[0]).toBe("4000.00"); // Jan
      expect(kRows[0].monthly[5]).toBe("3000.00"); // Jun
      expect(kRows[0].monthly[11]).toBe("3000.00"); // Dec
      const otherMonthIdx = kRows[0].monthly
        .map((amt, i) => ({ amt, i }))
        .filter(({ i }) => i !== 0 && i !== 5 && i !== 11);
      for (const { amt } of otherMonthIdx) expect(amt).toBe("0.00");
      expect(kRows[0].transactionCount).toBe(3);

      // NEC/MISC rows should still carry the monthly/txn fields (zeros)
      // so the UI can read them unconditionally.
      expect(necRows[0].monthly).toEqual(Array(12).fill("0.00"));
      expect(necRows[0].transactionCount).toBe(0);
      expect(miscRows[0].monthly).toEqual(Array(12).fill("0.00"));
      expect(miscRows[0].transactionCount).toBe(0);

      // e-delivery flag is hydrated from vendors.e_delivery_consent.
      const vendorANecRow = necRows.find(
        (r) => r.recipientVendorId === seeded!.vendorAId,
      );
      expect(vendorANecRow?.eDeliveryConsent).toBe(true);
      const vendorBMiscRow = miscRows[0];
      expect(vendorBMiscRow.eDeliveryConsent).toBe(false);

      // Default filing status before any persisted row is "pending".
      for (const r of rows) expect(r.status).toBe("pending");

      // Summary fields reflect the same picture.
      const summary = res.body.summary;
      expect(summary.taxYear).toBe(TAX_YEAR);
      // Filter is by partner so totalRecipients counts ONLY this suite's rows.
      // The unscoped admin endpoint may include unrelated data in the dev DB,
      // so we instead recompute the per-partner expectation from `rows`.
      // 1 NEC (vendor A) + 1 MISC (vendor B) + 1 K (vendor C) = 3.
      expect(rows).toHaveLength(3);
    });

    it("partner-scoped dashboard returns only that partner's rows", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId}/1099-dashboard?year=${TAX_YEAR}`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        );
      expectStatus(res, 200);
      const rows = res.body.rows as Array<{
        formType: string;
        payerPartnerId: number;
      }>;
      // 1 NEC + 1 MISC + 1 K after the NEC fix that excludes MISC- and
      // credit-card-paid amounts from the NEC totals.
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r.payerPartnerId).toBe(seeded!.partnerId);
      expect(res.body.summary.byForm).toEqual({ NEC: 1, MISC: 1, K: 1 });
    });

    // CSV export of the 1099-K monthly breakout. AP reviewers used to
    // copy the in-card per-month grid into a spreadsheet by hand; this
    // endpoint hands them the same numbers as a download. The CSV must
    // honor the year and admin/partner scope and only include K rows.
    it("admin CSV export includes the K row(s) with Jan…Dec columns and txn count", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}&format=csv`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.headers["content-disposition"]).toMatch(/attachment/);
      expect(res.headers["content-disposition"]).toMatch(/1099-k-monthly/);

      const text = res.text;
      const lines = text.split("\r\n").filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0]).toBe(
        "TaxYear,PayerPartnerId,PayerName,RecipientVendorId,RecipientName,RecipientTIN,TotalReportable,TransactionCount,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,JanYTD,FebYTD,MarYTD,AprYTD,MayYTD,JunYTD,JulYTD,AugYTD,SepYTD,OctYTD,NovYTD,DecYTD,CrossedAtMonth,CrossedAtMonthYTD",
      );

      // Locate this suite's row by recipientVendorId so unrelated rows
      // in a shared dev DB don't fail the assertions.
      const suiteRow = lines
        .slice(1)
        .map((l) => l.split(","))
        .find(
          (cols) =>
            cols[1] === String(seeded!.partnerId) &&
            cols[3] === String(seeded!.vendorCId),
        );
      expect(suiteRow).toBeDefined();
      expect(suiteRow![0]).toBe(String(TAX_YEAR));
      expect(suiteRow![6]).toBe("10000.00"); // TotalReportable
      expect(suiteRow![7]).toBe("3"); // TransactionCount (Box 3)
      expect(suiteRow![8]).toBe("4000.00"); // Jan
      expect(suiteRow![13]).toBe("3000.00"); // Jun
      expect(suiteRow![19]).toBe("3000.00"); // Dec
      // Months other than Jan/Jun/Dec are zero.
      for (const idx of [9, 10, 11, 12, 14, 15, 16, 17, 18]) {
        expect(suiteRow![idx]).toBe("0.00");
      }
      // Task #793: parallel JanYTD…DecYTD columns carry the running
      // cumulative gross. Indices 20..31 (Jan=20, Feb=21, …, Dec=31).
      expect(suiteRow![20]).toBe("4000.00"); // JanYTD = 4000
      expect(suiteRow![21]).toBe("4000.00"); // FebYTD unchanged
      expect(suiteRow![22]).toBe("4000.00"); // MarYTD unchanged
      expect(suiteRow![23]).toBe("4000.00"); // AprYTD unchanged
      expect(suiteRow![24]).toBe("4000.00"); // MayYTD unchanged
      expect(suiteRow![25]).toBe("7000.00"); // JunYTD = 4000 + 3000
      for (const idx of [26, 27, 28, 29, 30]) {
        expect(suiteRow![idx]).toBe("7000.00"); // Jul..Nov YTD unchanged
      }
      expect(suiteRow![31]).toBe("10000.00"); // DecYTD = totalReportable
      // Task #793: CrossedAtMonth + CrossedAtMonthYTD echo the on-screen
      // tooltip. The seeded K row's $4000 January gross already exceeds
      // the 1099-K threshold in effect for the test year, so the crossover
      // month is Jan with a YTD-at-cross of $4000.
      expect(suiteRow![32]).toBe("Jan"); // CrossedAtMonth
      expect(suiteRow![33]).toBe("4000.00"); // CrossedAtMonthYTD
    });

    it("partner-scoped CSV is restricted to that partner and excludes NEC/MISC", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId}/1099-dashboard?year=${TAX_YEAR}&format=csv`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        );
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.headers["content-disposition"]).toMatch(
        new RegExp(`partner-${seeded!.partnerId}`),
      );

      const lines = res.text.split("\r\n").filter((l) => l.length > 0);
      // Header + exactly one K row for this partner (vendor C).
      expect(lines).toHaveLength(2);
      const cols = lines[1].split(",");
      expect(cols[1]).toBe(String(seeded!.partnerId));
      expect(cols[3]).toBe(String(seeded!.vendorCId));
      // Vendor A/B should not appear: only K rows are exported.
      expect(res.text).not.toMatch(new RegExp(`,${seeded!.vendorAId},`));
      expect(res.text).not.toMatch(new RegExp(`,${seeded!.vendorBId},`));
    });

    it("partner CSV is forbidden for a different partner's user", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId + 9999}/1099-dashboard?year=${TAX_YEAR}&format=csv`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        );
      expect(res.status).toBe(403);
    });

    // PDF mirror of the CSV: same K-row scope, paginated landscape
    // letter for filing packets. We just smoke-test the headers and
    // file shape (PDF magic bytes) — full PDF text extraction is brittle
    // so the column layout is covered by the renderReportPdf unit tests.
    it("admin PDF export returns a 1099-K monthly breakout PDF", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}&format=pdf`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
      expect(res.headers["content-disposition"]).toMatch(/attachment/);
      expect(res.headers["content-disposition"]).toMatch(/1099-k-monthly/);
      expect(res.headers["content-disposition"]).toMatch(/\.pdf"?$/);
      const body = res.body as Buffer;
      // PDFs always start with "%PDF-"
      expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    });

    it("partner PDF export is scoped to that partner only", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId}/1099-dashboard?year=${TAX_YEAR}&format=pdf`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        )
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
      expect(res.headers["content-disposition"]).toMatch(
        new RegExp(`partner-${seeded!.partnerId}`),
      );
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    });

    it("partner PDF is forbidden for a different partner's user", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId + 9999}/1099-dashboard?year=${TAX_YEAR}&format=pdf`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        );
      expect(res.status).toBe(403);
    });

    // The PDF tests above prove the response shape (magic bytes, headers,
    // RBAC) but say nothing about the audit row. The download path runs
    // `sendBufferAndAudit`, which in turn calls `recordExport` — if that
    // call were dropped or wired with the wrong `reportKind` / `format`,
    // the response would still look correct and the regression would
    // ship silently. These two tests close that gap by asserting the
    // matching row in `report_export_audit_log` after each download.
    //
    // Note on timing & precision: `sendBufferAndAudit` calls
    // `res.send(...)` *before* awaiting the audit insert, so supertest's
    // response can resolve before the row hits Postgres. The earlier PDF
    // tests in this describe block also exercise the same endpoints with
    // the same seeded users, so a "latest matching row" lookup would be
    // satisfied by a *previous* test's row even if the current download
    // failed to write one. The helper takes a baseline `id` snapshot
    // first and then polls for a row with `id > baseline`, which both
    // absorbs the post-`res.send` insert lag *and* guarantees we are
    // asserting on the row this test produced.
    async function getMaxAuditId(): Promise<number> {
      const { db, reportExportAuditLogTable } = dbModule;
      const [row] = await db
        .select({ id: reportExportAuditLogTable.id })
        .from(reportExportAuditLogTable)
        .orderBy(desc(reportExportAuditLogTable.id))
        .limit(1);
      return row?.id ?? 0;
    }

    async function waitForAuditRow(args: {
      sinceId: number;
      downloadedByUserId: number;
      reportKind: string;
    }): Promise<
      typeof dbModule.reportExportAuditLogTable.$inferSelect | null
    > {
      const { db, reportExportAuditLogTable } = dbModule;
      for (let attempt = 0; attempt < 25; attempt++) {
        const [row] = await db
          .select()
          .from(reportExportAuditLogTable)
          .where(
            and(
              gt(reportExportAuditLogTable.id, args.sinceId),
              eq(
                reportExportAuditLogTable.downloadedByUserId,
                args.downloadedByUserId,
              ),
              eq(reportExportAuditLogTable.reportKind, args.reportKind),
              eq(reportExportAuditLogTable.format, "1099_pdf"),
            ),
          )
          .orderBy(desc(reportExportAuditLogTable.id))
          .limit(1);
        if (row) return row;
        await new Promise((r) => setTimeout(r, 40));
      }
      return null;
    }

    it("admin PDF download writes a 1099_pdf row to the export audit log", async () => {
      const baselineId = await getMaxAuditId();
      const downloadRes = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}&format=pdf`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expectStatus(downloadRes, 200);

      const row = await waitForAuditRow({
        sinceId: baselineId,
        downloadedByUserId: seeded!.adminUserId,
        reportKind: "admin.1099kMonthly",
      });
      expect(row).not.toBeNull();
      expect(row!.format).toBe("1099_pdf");
      expect(row!.reportKind).toBe("admin.1099kMonthly");
      // Admin-scoped dashboard runs across every payer, so the only
      // scope key the route records is the tax year.
      expect(row!.scope).toEqual({ year: TAX_YEAR });
      expect(row!.userRole).toBe("admin");
      // PDFs always have a non-empty body — `recordExport` stores the
      // exact byte length of what was sent on the wire.
      expect(row!.fileBytes).toBeGreaterThan(0);
    });

    it("partner PDF download writes a partner-scoped 1099_pdf row to the export audit log", async () => {
      const baselineId = await getMaxAuditId();
      const downloadRes = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId}/1099-dashboard?year=${TAX_YEAR}&format=pdf`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        )
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expectStatus(downloadRes, 200);

      const row = await waitForAuditRow({
        sinceId: baselineId,
        downloadedByUserId: seeded!.partnerUserId,
        reportKind: "partner.1099kMonthly",
      });
      expect(row).not.toBeNull();
      expect(row!.format).toBe("1099_pdf");
      expect(row!.reportKind).toBe("partner.1099kMonthly");
      // Partner-scoped dashboard records both the tax year and the
      // partner whose payments were aggregated.
      expect(row!.scope).toEqual({
        partnerId: seeded!.partnerId,
        year: TAX_YEAR,
      });
      expect(row!.userRole).toBe("partner");
      expect(row!.fileBytes).toBeGreaterThan(0);
    });
  });

  describe("/reports/admin/1099-fire (NEC)", () => {
    it("emits a valid 750-byte fixed-width file with the right B and C records", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);

      const text = res.text;
      const lines = text.split("\r\n").filter((l) => l.length > 0);

      // Every record is exactly 750 bytes — IRS Pub 1220 fixed-width.
      for (const line of lines) expect(line.length).toBe(750);

      // The dev DB may carry additional partners with NEC payees from
      // other tests; locate the A/payer-block belonging to THIS partner
      // by its EIN, then count the B records that follow until C.
      const myPayerEin = seeded!.partnerEinDigits;
      let aIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i][0] !== "A") continue;
        // A record EIN sits at positions 13-21 (1-indexed) — slice(12, 21).
        if (lines[i].slice(12, 21) === myPayerEin) {
          aIdx = i;
          break;
        }
      }
      expect(aIdx).toBeGreaterThanOrEqual(0);

      // Walk forward collecting B records up to the next C.
      const bRecords: string[] = [];
      let cRecord: string | null = null;
      for (let i = aIdx + 1; i < lines.length; i++) {
        const tag = lines[i][0];
        if (tag === "B") {
          bRecords.push(lines[i]);
        } else if (tag === "C") {
          cRecord = lines[i];
          break;
        } else {
          // A new A record appearing before C means this partner had no
          // payees, which would contradict the seed.
          throw new Error(`Unexpected ${tag} record before C for partner`);
        }
      }
      // Only vendor A is on NEC after the fix: vendor B's lines were
      // categorized as misc_* (1099-MISC) and vendor C was paid by
      // credit card (1099-K), so neither should appear here.
      expect(bRecords).toHaveLength(1);
      expect(cRecord).not.toBeNull();

      // C record layout (Pub 1220 NEC):
      //   pos 1     : 'C'
      //   pos 2-9   : payeeCount, zero-padded
      //   pos 10-15 : blank
      //   pos 16-33 : box-1 total in cents (18 chars zero-padded)
      const c = cRecord!;
      expect(c.slice(0, 1)).toBe("C");
      expect(c.slice(1, 9)).toBe("00000001"); // 1 payee (vendor A)
      // Total = 5000 dollars = 500_000 cents.
      const totalCents = parseInt(c.slice(15, 33), 10);
      expect(totalCents).toBe(500_000);

      // The file ends with an F record that totals all A records.
      const fLine = lines[lines.length - 1];
      expect(fLine[0]).toBe("F");
    });

    it("wires the saved TCC and transmitter EIN into the T-record bytes", async () => {
      // The T record is the IRS's first gatekeeper: a wrong TCC or
      // transmitter EIN bounces the entire submission before any A or
      // B record is read. buildFirePayload reads both from the
      // singleton settings row at request time (Task #826 removed the
      // env-var fallback), so this test mutates the row, hits the
      // route, and asserts the bytes landed at the IRS-spec positions
      // (Pub 1220 — TCC at 16-20, EIN at 7-15).
      await seedFireTransmitterRow({
        ...FIRE_ROW_DEFAULTS,
        tcc: "9XYZ1",
        ein: "123456789",
      });
      try {
        const res = await request(app)
          .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC`)
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        const t = res.text.split("\r\n")[0];
        expect(t.length).toBe(750);
        expect(t[0]).toBe("T");
        // pos 7-15 (1-indexed) → slice(6, 15): transmitter EIN.
        expect(t.slice(6, 15)).toBe("123456789");
        // pos 16-20 → slice(15, 20): TCC. sanitize() upper-cases letters;
        // alphanumeric TCCs are valid IRS assignments.
        expect(t.slice(15, 20)).toBe("9XYZ1");
      } finally {
        await seedFireTransmitterRow();
      }
    });

    it("returns 404 when no filable rows exist for the year", async () => {
      // 2001 is a valid tax-year per the FireQuery schema (>= 2000) but
      // the suite seeds nothing that far back, so the route must short-
      // circuit with the structured "no rows" response instead of
      // emitting an empty FIRE file.
      const res = await request(app)
        .get(`/reports/admin/1099-fire?year=2001&formType=NEC`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    });

    // ─── transmitter settings guard ───────────────────────────────
    //
    // The IRS rejects (or worse, mis-routes) any FIRE submission whose
    // T record contains the placeholder TCC/EIN/contact info, so the
    // route must refuse a non-test download when the singleton
    // `fire_transmitter_settings` row is missing/blank and instead
    // point operators at the settings they need to fix. The test path
    // (test=true) is still permitted to use placeholders so a brand-
    // new install can dry-run against the IRS test FIRE system before
    // configuring anything.
    it("rejects non-test FIRE when the transmitter settings row is missing", async () => {
      await deleteFireTransmitterRow();
      try {
        const res = await request(app)
          .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC`)
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.length).toBeGreaterThan(0);
        // Every required field must show up in the missing list — that
        // is the only signal an operator has to know which settings to
        // configure before retrying the download.
        expect(Array.isArray(res.body.missing)).toBe(true);
        for (const f of FIRE_ROW_FIELDS) {
          expect((res.body.missing as string[]).includes(f)).toBe(true);
        }
      } finally {
        await seedFireTransmitterRow();
      }
    });

    it("rejects non-test FIRE when the transmitter address is set but unparseable", async () => {
      // parseAddress only splits "Street, City, ST 12345"-style input.
      // A free-form value would silently land entirely on the street
      // line with blank city/state/zip in the T record — equally
      // invalid for the IRS, so we surface it the same way as a
      // missing field.
      await seedFireTransmitterRow({
        ...FIRE_ROW_DEFAULTS,
        address: "100 Main St only",
      });
      try {
        const res = await request(app)
          .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC`)
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expect(res.status).toBe(400);
        expect((res.body.missing as string[]).includes("address")).toBe(true);
      } finally {
        await seedFireTransmitterRow();
      }
    });

    it("permits a test=true FIRE file even when the transmitter settings row is missing", async () => {
      // The pre-submission test path (?test=true) is the only way an
      // operator can validate plumbing against fire.test.irs.gov before
      // the prod TCC/EIN is configured, so it must keep working with
      // the historical placeholder defaults.
      await deleteFireTransmitterRow();
      try {
        const res = await request(app)
          .get(
            `/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC&test=true`,
          )
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        const t = res.text.split("\r\n")[0];
        expect(t.length).toBe(750);
        expect(t[0]).toBe("T");
        // The placeholder transmitter EIN ("000000000") and TCC
        // ("00000") must land at their Pub 1220 byte positions.
        expect(t.slice(6, 15)).toBe("000000000");
        expect(t.slice(15, 20)).toBe("00000");
      } finally {
        await seedFireTransmitterRow();
      }
    });
  });

  // ─── /reports/{admin,partner}/1099-fire/transmitter ─────────────
  //
  // Operators need to verify the resolved transmitter info BEFORE
  // clicking Download, otherwise a misconfigured TCC or stale email
  // address only surfaces after the download (or worse, after IRS
  // rejection). The preview endpoint exposes the same resolver that
  // buildFirePayload uses so the UI and the file can never disagree.
  describe("/reports/admin/1099-fire/transmitter", () => {
    it("returns ok=true and the resolved info when the settings row is saved", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-fire/transmitter`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.body.ok).toBe(true);
      expect(res.body.test).toBe(false);
      expect(res.body.missing).toEqual([]);
      // Echoes the suite's beforeAll defaults so an operator can sanity-
      // check the EIN/TCC/contact-email exactly as they will appear in
      // the T record.
      expect(res.body.transmitter.tcc).toBe("9XYZ1");
      expect(res.body.transmitter.ein).toBe("987654321");
      expect(res.body.transmitter.name).toBe("VNDRLY TEST INC");
      expect(res.body.transmitter.mailingAddress).toBe("100 Main St");
      expect(res.body.transmitter.city).toBe("Austin");
      expect(res.body.transmitter.state).toBe("TX");
      expect(res.body.transmitter.zip).toBe("78701");
      expect(res.body.transmitter.contactEmail).toBe("tax-ops@vndrly.test");
    });

    it("returns ok=false and the missing list when the settings row is absent", async () => {
      await deleteFireTransmitterRow();
      try {
        const res = await request(app)
          .get(`/reports/admin/1099-fire/transmitter`)
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        expect(res.body.ok).toBe(false);
        expect(Array.isArray(res.body.missing)).toBe(true);
        for (const f of FIRE_ROW_FIELDS) {
          expect((res.body.missing as string[]).includes(f)).toBe(true);
        }
        // Even in the error case the placeholder transmitter is echoed
        // so the UI can show "we'd send THIS if you forced it" alongside
        // the warning.
        expect(res.body.transmitter.tcc).toBe("00000");
        expect(res.body.transmitter.ein).toBe("000000000");
        expect(res.body.transmitter.contactEmail).toBe("tax@vndrly.example");
      } finally {
        await seedFireTransmitterRow();
      }
    });

    it("treats test=true as ok even when nothing is configured", async () => {
      await deleteFireTransmitterRow();
      try {
        const res = await request(app)
          .get(`/reports/admin/1099-fire/transmitter?test=true`)
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        expect(res.body.ok).toBe(true);
        expect(res.body.test).toBe(true);
        expect(res.body.missing).toEqual([]);
      } finally {
        await seedFireTransmitterRow();
      }
    });

    it("treats test=false as a real submission and surfaces missing settings", async () => {
      // Regression: z.coerce.boolean() turned the literal string "false"
      // into true (Boolean("false") === true), which silently masked the
      // missing-transmitter warning whenever the operator unticked the
      // Test-file checkbox. The query parser must now treat "false" as
      // an actual false.
      await deleteFireTransmitterRow();
      try {
        const res = await request(app)
          .get(`/reports/admin/1099-fire/transmitter?test=false`)
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expectStatus(res, 200);
        expect(res.body.test).toBe(false);
        expect(res.body.ok).toBe(false);
        expect(Array.isArray(res.body.missing)).toBe(true);
        expect((res.body.missing as string[]).length).toBeGreaterThan(0);

        const fireRes = await request(app)
          .get(
            `/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC&test=false`,
          )
          .set("Cookie", adminCookie(seeded!.adminUserId));
        expect(fireRes.status).toBe(400);
        expect(Array.isArray(fireRes.body.missing)).toBe(true);
        expect((fireRes.body.missing as string[]).length).toBeGreaterThan(0);
      } finally {
        await seedFireTransmitterRow();
      }
    });

    it("rejects partner preview from a different partner's user", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId + 9999}/1099-fire/transmitter`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        );
      expect(res.status).toBe(403);
    });

    it("partner preview returns the resolved transmitter info", async () => {
      const res = await request(app)
        .get(
          `/reports/partner/${seeded!.partnerId}/1099-fire/transmitter`,
        )
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId),
        );
      expectStatus(res, 200);
      expect(res.body.ok).toBe(true);
      expect(res.body.transmitter.ein).toBe("987654321");
    });
  });

  // ─── /reports/admin/1099-fire?formType=MISC ──────────────────────
  //
  // The 1099-MISC and 1099-NEC share the renderer but write to entirely
  // different boxes on the IRS B record (rents/royalties/medical/attorney
  // for MISC vs. a single NEC compensation box). A regression in those
  // mappings would silently corrupt filings, so we walk the FIRE bytes
  // for our seeded payer and assert each box position individually plus
  // the per-box C-record totals.
  describe("/reports/admin/1099-fire (MISC)", () => {
    it("emits per-box B-record amounts and per-box C-record totals", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=MISC`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);

      const lines = res.text.split("\r\n").filter((l) => l.length > 0);
      // Pub 1220 fixed-width: every record is exactly 750 bytes.
      for (const line of lines) expect(line.length).toBe(750);
      // File ends with the F record summarizing all A records.
      const fLine = lines[lines.length - 1];
      expect(fLine[0]).toBe("F");

      // Locate THIS suite's payer block by EIN. Other partners in the
      // dev DB may also have MISC rows so we anchor on our partner_ein.
      const myPayerEin = seeded!.partnerEinDigits;
      let aIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i][0] === "A" && lines[i].slice(12, 21) === myPayerEin) {
          aIdx = i;
          break;
        }
      }
      expect(aIdx).toBeGreaterThanOrEqual(0);

      // Confirm the A-record's "type of return" code is the MISC marker
      // ("A " per Pub 1220) — guards against a renderer mix-up that
      // would otherwise still produce a 750-byte line that reads as
      // structurally-valid but routes to the wrong form processor.
      expect(lines[aIdx].slice(26, 28)).toBe("A ");

      const bRecords: string[] = [];
      let cRecord: string | null = null;
      for (let i = aIdx + 1; i < lines.length; i++) {
        const tag = lines[i][0];
        if (tag === "B") bRecords.push(lines[i]);
        else if (tag === "C") {
          cRecord = lines[i];
          break;
        } else throw new Error(`Unexpected ${tag} record before C for MISC`);
      }
      // Only vendor B has MISC categories that cross threshold.
      expect(bRecords).toHaveLength(1);
      expect(cRecord).not.toBeNull();

      // ── B-record per-box amounts ──
      // Standard payment-amount area is positions 55-198 (12 boxes ×
      // 12 chars). For MISC the renderer maps:
      //   slot 0 (55-66)   Box 1   Rents              → $2000
      //   slot 1 (67-78)   Box 2   Royalties          → $0
      //   slot 2 (79-90)   Box 3   Other income       → $0
      //   slot 3 (91-102)  Box 4   Federal tax        → $0
      //   slot 4 (103-114) Box 5   Fishing            → $0
      //   slot 5 (115-126) Box 6   Medical            → $1500
      //   slot 6 (127-138) Box 7   (n/a)              → $0
      //   slot 7 (139-150) Box 8   Substitute pmt     → $0
      //   slot 8 (151-162) Box 9   Crop insurance     → $0
      //   slot 9 (163-174) Box A   Box 10 attorney    → $800
      //   slot 10/11       Box B/C (n/a)              → $0
      const b = bRecords[0];
      const slot = (i: number): number =>
        parseInt(b.slice(54 + i * 12, 54 + (i + 1) * 12), 10);
      expect(slot(0)).toBe(200_000); // Box 1 rents = $2000.00
      expect(slot(1)).toBe(0);       // Box 2 royalties
      expect(slot(2)).toBe(0);       // Box 3 other income
      expect(slot(3)).toBe(0);
      expect(slot(4)).toBe(0);
      expect(slot(5)).toBe(150_000); // Box 6 medical = $1500.00
      expect(slot(9)).toBe(80_000);  // Box 10 attorney = $800.00
      // Verify the unused middle slots are zero — the simplest catch
      // for an off-by-one slot mapping (e.g. attorney landing on Box 7).
      expect(slot(6)).toBe(0);
      expect(slot(7)).toBe(0);
      expect(slot(8)).toBe(0);
      expect(slot(10)).toBe(0);
      expect(slot(11)).toBe(0);

      // ── C-record per-box totals ──
      // C record positions 16-339 hold 18 box totals of 18 chars each.
      // With one MISC payee, the C totals must equal the B amounts in
      // each box position (and zero everywhere else).
      const c = cRecord!;
      expect(c.slice(0, 1)).toBe("C");
      expect(c.slice(1, 9)).toBe("00000001"); // 1 MISC payee
      const total = (i: number): number =>
        parseInt(c.slice(15 + i * 18, 15 + (i + 1) * 18), 10);
      expect(total(0)).toBe(200_000); // Box 1 rents total
      expect(total(1)).toBe(0);       // Box 2 royalties total
      expect(total(2)).toBe(0);       // Box 3 other-income total
      expect(total(5)).toBe(150_000); // Box 6 medical total
      expect(total(9)).toBe(80_000);  // Box 10 attorney total
      // Every other slot must be exactly zero — proves we are emitting
      // per-box totals rather than lumping the sum into slot 0.
      for (const i of [3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]) {
        expect(total(i)).toBe(0);
      }
    });
  });

  // ─── /reports/admin/1099-fire?formType=K ─────────────────────────
  //
  // 1099-K's most error-prone field is the monthly breakout (Boxes 5a-
  // 5l). Vendor C in this suite was paid $4000/Jan, $3000/Jun, $3000/Dec
  // by credit card — three non-zero buckets across the standard amount
  // area (Jan/Jun) and the K-specific extension area (Dec).
  describe("/reports/admin/1099-fire (K)", () => {
    it("emits monthly breakouts on the B record and matching C totals", async () => {
      const res = await request(app)
        .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=K`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);

      const lines = res.text.split("\r\n").filter((l) => l.length > 0);
      for (const line of lines) expect(line.length).toBe(750);
      const fLine = lines[lines.length - 1];
      expect(fLine[0]).toBe("F");

      const myPayerEin = seeded!.partnerEinDigits;
      let aIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i][0] === "A" && lines[i].slice(12, 21) === myPayerEin) {
          aIdx = i;
          break;
        }
      }
      expect(aIdx).toBeGreaterThanOrEqual(0);
      // 1099-K type-of-return code is "MC" per Pub 1220.
      expect(lines[aIdx].slice(26, 28)).toBe("MC");
      // A-record amount-indicator mask (positions 29-44) must flag every
      // box the following B records actually populate. Vendor C has Box
      // 1A (gross) plus Jan–Aug monthly slots wired up in payeeBoxCents,
      // so slots 0 and 4–11 must be '1'. (Sep–Dec sit in the K extension
      // area, not in this 16-char mask.) Without these bits the IRS
      // ignores the monthly breakout entirely.
      expect(lines[aIdx].slice(28, 44)).toBe("1000111111110000");

      const bRecords: string[] = [];
      let cRecord: string | null = null;
      for (let i = aIdx + 1; i < lines.length; i++) {
        const tag = lines[i][0];
        if (tag === "B") bRecords.push(lines[i]);
        else if (tag === "C") {
          cRecord = lines[i];
          break;
        } else throw new Error(`Unexpected ${tag} record before C for K`);
      }
      // Only vendor C made credit_card payments → exactly one B record.
      expect(bRecords).toHaveLength(1);
      expect(cRecord).not.toBeNull();

      // ── B-record standard amount-code slots (positions 55-198) ──
      //   slot 0  Box 1a  Gross               → $10000
      //   slot 1  Box 1b  Card not present    → $0
      //   slot 2  Box 2   MCC                 → $0
      //   slot 3  Box 4   Federal tax         → $0
      //   slot 4  Box 5a  January             → $4000
      //   slot 5  Box 5b  February            → $0
      //   slot 6  Box 5c  March               → $0
      //   slot 7  Box 5d  April               → $0
      //   slot 8  Box 5e  May                 → $0
      //   slot 9  Box 5f  June                → $3000
      //   slot 10 Box 5g  July                → $0
      //   slot 11 Box 5h  August              → $0
      const b = bRecords[0];
      const slot = (i: number): number =>
        parseInt(b.slice(54 + i * 12, 54 + (i + 1) * 12), 10);
      expect(slot(0)).toBe(1_000_000); // Box 1a gross = $10000
      expect(slot(1)).toBe(0);
      expect(slot(2)).toBe(0);
      expect(slot(3)).toBe(0);
      expect(slot(4)).toBe(400_000);   // Box 5a January = $4000
      expect(slot(5)).toBe(0);
      expect(slot(6)).toBe(0);
      expect(slot(7)).toBe(0);
      expect(slot(8)).toBe(0);
      expect(slot(9)).toBe(300_000);   // Box 5f June = $3000
      expect(slot(10)).toBe(0);
      expect(slot(11)).toBe(0);

      // ── B-record K extensions (positions 547-606) ──
      //   547-558  Box 5i  September  → $0
      //   559-570  Box 5j  October    → $0
      //   571-582  Box 5k  November   → $0
      //   583-594  Box 5l  December   → $3000
      //   595-606  Box 3   # txns     → 3
      const ext = (start1Indexed: number, width: number): number =>
        parseInt(b.slice(start1Indexed - 1, start1Indexed - 1 + width), 10);
      expect(ext(547, 12)).toBe(0);       // Sep
      expect(ext(559, 12)).toBe(0);       // Oct
      expect(ext(571, 12)).toBe(0);       // Nov
      expect(ext(583, 12)).toBe(300_000); // Dec = $3000
      expect(ext(595, 12)).toBe(3);       // 3 credit-card payments

      // ── C-record per-box totals (positions 16-339) ──
      // With one K payee the C totals should match the single B record.
      const c = cRecord!;
      expect(c.slice(0, 1)).toBe("C");
      expect(c.slice(1, 9)).toBe("00000001"); // 1 K payee
      const total = (i: number): number =>
        parseInt(c.slice(15 + i * 18, 15 + (i + 1) * 18), 10);
      expect(total(0)).toBe(1_000_000); // gross total
      expect(total(4)).toBe(400_000);   // January total
      expect(total(9)).toBe(300_000);   // June total
      // Slot 1 (1b), slot 2 (MCC), slot 3 (fed tax) and slots 5-8, 10-11
      // and 12-17 must be zero — guards against a regression that ever
      // broadcast the gross into other slots.
      for (const i of [1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]) {
        expect(total(i)).toBe(0);
      }

      // ── C-record K extension totals (positions 540-629) ──
      //   540-557  Box 5i Sep total   → $0
      //   558-575  Box 5j Oct total   → $0
      //   576-593  Box 5k Nov total   → $0
      //   594-611  Box 5l Dec total   → $3000
      //   612-629  Box 3  txn total   → 3
      const cext = (start1Indexed: number, width: number): number =>
        parseInt(c.slice(start1Indexed - 1, start1Indexed - 1 + width), 10);
      expect(cext(540, 18)).toBe(0);
      expect(cext(558, 18)).toBe(0);
      expect(cext(576, 18)).toBe(0);
      expect(cext(594, 18)).toBe(300_000);
      expect(cext(612, 18)).toBe(3);
    });
  });

  describe("/reports/1099-filing-status persistence", () => {
    it("POST upserts a row and the dashboard reflects the new status", async () => {
      const filedAt = new Date(Date.UTC(TAX_YEAR + 1, 0, 28)).toISOString();
      const post = await request(app)
        .post("/reports/1099-filing-status")
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          taxYear: TAX_YEAR,
          formType: "NEC",
          payerPartnerId: seeded!.partnerId,
          recipientVendorId: seeded!.vendorAId,
          status: "filed",
          filingMethod: "fire",
          externalReference: "FIRE-BATCH-A-001",
          filedAt,
          totalReportable: "5000.00",
        });
      expectStatus(post, 201);
      expect(post.body.row.status).toBe("filed");
      expect(post.body.row.externalReference).toBe("FIRE-BATCH-A-001");
      const filingId = post.body.row.id as number;

      const dash = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(dash, 200);
      const target = (
        dash.body.rows as Array<{
          formType: string;
          payerPartnerId: number;
          recipientVendorId: number;
          status: string;
          externalReference: string | null;
          filingMethod: string;
          filingId: number | null;
          filedAt: string | null;
        }>
      ).find(
        (r) =>
          r.formType === "NEC" &&
          r.payerPartnerId === seeded!.partnerId &&
          r.recipientVendorId === seeded!.vendorAId,
      );
      expect(target).toBeDefined();
      expect(target!.status).toBe("filed");
      expect(target!.filingMethod).toBe("fire");
      expect(target!.externalReference).toBe("FIRE-BATCH-A-001");
      expect(target!.filingId).toBe(filingId);
      expect(target!.filedAt).not.toBeNull();
    });

    it("POST is idempotent: re-upserting the same key updates instead of duplicating", async () => {
      const post = await request(app)
        .post("/reports/1099-filing-status")
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          taxYear: TAX_YEAR,
          formType: "NEC",
          payerPartnerId: seeded!.partnerId,
          recipientVendorId: seeded!.vendorAId,
          status: "accepted",
          filingMethod: "fire",
          externalReference: "FIRE-BATCH-A-001",
          totalReportable: "5000.00",
        });
      // Existing row → 200 (update path), not 201 (insert path).
      expectStatus(post, 200);
      expect(post.body.row.status).toBe("accepted");

      // Confirm only one row exists for this filing key.
      const { db, tax1099FilingsTable } = dbModule;
      const found = await db
        .select()
        .from(tax1099FilingsTable)
        .where(sql`payer_partner_id = ${seeded!.partnerId}
          and recipient_vendor_id = ${seeded!.vendorAId}
          and tax_year = ${TAX_YEAR}
          and form_type = 'NEC'`);
      expect(found).toHaveLength(1);
    });

    it("PATCH updates a single field without clobbering the rest", async () => {
      const { db, tax1099FilingsTable } = dbModule;
      const [row] = await db
        .select()
        .from(tax1099FilingsTable)
        .where(sql`payer_partner_id = ${seeded!.partnerId}
          and recipient_vendor_id = ${seeded!.vendorAId}
          and tax_year = ${TAX_YEAR}
          and form_type = 'NEC'`);
      expect(row).toBeDefined();

      const deliveredAt = new Date(Date.UTC(TAX_YEAR + 1, 1, 5)).toISOString();
      const patch = await request(app)
        .patch(`/reports/1099-filing-status/${row.id}`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          status: "delivered",
          deliveredAt,
          deliveryChannel: "email",
        });
      expectStatus(patch, 200);
      expect(patch.body.row.status).toBe("delivered");
      expect(patch.body.row.deliveryChannel).toBe("email");
      // Untouched fields from the prior upsert must persist.
      expect(patch.body.row.externalReference).toBe("FIRE-BATCH-A-001");
      expect(patch.body.row.filingMethod).toBe("fire");

      const dash = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      const target = (
        dash.body.rows as Array<{
          formType: string;
          payerPartnerId: number;
          recipientVendorId: number;
          status: string;
          deliveryChannel: string | null;
        }>
      ).find(
        (r) =>
          r.formType === "NEC" &&
          r.payerPartnerId === seeded!.partnerId &&
          r.recipientVendorId === seeded!.vendorAId,
      );
      expect(target!.status).toBe("delivered");
      expect(target!.deliveryChannel).toBe("email");
    });

    // Pub 1220 §F.5 corrected-return flow: an admin marks a filed row as
    // needing correction, the dashboard then reflects the new
    // correctedStatus, and the next FIRE export emits a separate A block
    // with the indicator at A-pos-7 / B-pos-6 instead of touching the
    // original payee block.
    it("PATCH correctedStatus → dashboard + FIRE export carry the G indicator", async () => {
      const { db, tax1099FilingsTable } = dbModule;
      const [row] = await db
        .select()
        .from(tax1099FilingsTable)
        .where(sql`payer_partner_id = ${seeded!.partnerId}
          and recipient_vendor_id = ${seeded!.vendorAId}
          and tax_year = ${TAX_YEAR}
          and form_type = 'NEC'`);
      expect(row).toBeDefined();

      const patch = await request(app)
        .patch(`/reports/1099-filing-status/${row.id}`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({ correctedStatus: "g" });
      expectStatus(patch, 200);
      expect(patch.body.row.correctedStatus).toBe("g");

      // Dashboard surfaces the indicator so the UI can show CORR-G.
      const dash = await request(app)
        .get(`/reports/admin/1099-dashboard?year=${TAX_YEAR}`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      const target = (
        dash.body.rows as Array<{
          formType: string;
          payerPartnerId: number;
          recipientVendorId: number;
          correctedStatus: string;
        }>
      ).find(
        (r) =>
          r.formType === "NEC" &&
          r.payerPartnerId === seeded!.partnerId &&
          r.recipientVendorId === seeded!.vendorAId,
      );
      expect(target!.correctedStatus).toBe("g");

      // FIRE export now contains a "G" A block for THIS partner. Other
      // tests may have seeded extra payees, so locate the partner's A
      // record(s) by EIN and require at least one to carry G at pos 7
      // and a following B at pos 6.
      const fire = await request(app)
        .get(`/reports/admin/1099-fire?year=${TAX_YEAR}&formType=NEC`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(fire, 200);
      const lines = fire.text.split("\r\n").filter((l) => l.length > 0);
      const myEin = seeded!.partnerEinDigits;

      let foundCorrectedBlock = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i][0] !== "A") continue;
        if (lines[i].slice(12, 21) !== myEin) continue;
        if (lines[i][6] !== "G") continue;
        // Walk forward; at least one immediately-following B must also
        // carry G at position 6 (pre-next-A/C terminator).
        for (let j = i + 1; j < lines.length; j++) {
          const tag = lines[j][0];
          if (tag === "B") {
            expect(lines[j][5]).toBe("G");
            foundCorrectedBlock = true;
            break;
          }
          if (tag === "A" || tag === "C" || tag === "F") break;
        }
        if (foundCorrectedBlock) break;
      }
      expect(foundCorrectedBlock).toBe(true);

      // Reset for any later tests in the suite.
      await request(app)
        .patch(`/reports/1099-filing-status/${row.id}`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({ correctedStatus: "none" });
    });

    it("rejects correctedStatus G/C when the row is not yet filed", async () => {
      // Seed a fresh pending row for vendor B so we don't disturb the
      // filed vendor-A row used by adjacent tests.
      const post = await request(app)
        .post("/reports/1099-filing-status")
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({
          taxYear: TAX_YEAR,
          formType: "MISC",
          payerPartnerId: seeded!.partnerId,
          recipientVendorId: seeded!.vendorBId,
          status: "pending",
        });
      expect(post.status).toBeLessThan(300);
      const id = post.body.row.id as number;

      const blocked = await request(app)
        .patch(`/reports/1099-filing-status/${id}`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({ correctedStatus: "g" });
      expect(blocked.status).toBe(409);

      // Bumping status into filed first allows the same PATCH to succeed.
      const advance = await request(app)
        .patch(`/reports/1099-filing-status/${id}`)
        .set("Cookie", adminCookie(seeded!.adminUserId))
        .send({ status: "filed", correctedStatus: "g" });
      expectStatus(advance, 200);
      expect(advance.body.row.correctedStatus).toBe("g");
    });

    it("rejects partner-scoped writes for a different partner", async () => {
      const res = await request(app)
        .post("/reports/1099-filing-status")
        .set(
          "Cookie",
          partnerCookie(seeded!.partnerUserId, seeded!.partnerId + 9999),
        )
        .send({
          taxYear: TAX_YEAR,
          formType: "NEC",
          payerPartnerId: seeded!.partnerId,
          recipientVendorId: seeded!.vendorAId,
          status: "filed",
        });
      expect(res.status).toBe(403);
    });
  });
});

describe.skipIf(haveRealDb)("year-end 1099 dashboard + FIRE + filing status", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder used
    // by the unit-test setup; this suite seeds real rows and exercises
    // the actual SQL the 1099 aggregations issue.
  });
});

// ---------------------------------------------------------------------------
// Line-level routing fixtures.
//
// `nec1099` does its routing entirely in SQL — the per-form filters
// (`income_category = 'nec'`, `method != 'credit_card'`, the proportional
// `LEAST(payment.amount, invoice.total) / invoice.total` split). The pure
// `applyThreshold` and EIN-sharing simulator unit tests don't exercise any
// of those filters; the full-flow test above only covers the case where
// every line + payment lands cleanly on a single form.
//
// This suite seeds one fixture per "did the row route to the right form
// (and only that form)?" scenario, then calls `nec1099Rows`, `misc1099Rows`
// and `k1099Rows` directly with `payerPartnerId` + `vendorId` scoping so
// each assertion sees exactly the dollars from its own fixture. A SQL
// regression that lets the same dollars cross between NEC, MISC and K
// will fail one of these assertions before it reaches production.
// ---------------------------------------------------------------------------

interface RoutingSeedIds {
  partnerId: number;
  // Scenario 1: invoice with both NEC and misc_rents lines.
  vendorMixedId: number;
  // Scenario 2: NEC line paid only partially (50%).
  vendorPartialId: number;
  // Scenario 3: NEC line paid 50% ACH / 50% credit card.
  vendorSplitMethodId: number;
  // Scenario 4: line categorized as `none` (e.g. reimbursement).
  vendorNoneId: number;
  // Scenario 5a: NEC line on a $1000 invoice paid $1200 (110% overpay).
  vendorOverpayNecId: number;
  // Scenario 5b: misc_rents line on a $1000 invoice paid $1200.
  vendorOverpayMiscId: number;
  // Scenario 5d: NEC line on a $1000 invoice paid $1200 by credit card.
  // Locks down 1099-K's intentionally *un-clamped* behavior — see the
  // Pub 1220 reference next to the assertion for why K must report gross.
  vendorOverpayCardId: number;
  // Scenario 5c: invoice with NEC + misc_rents lines, paid by ACH +
  // credit_card, with EVERY payment voided. Guards the
  // `isNull(invoice_payments.voided_at)` predicate on all three reports
  // (NEC, MISC, K). Without that filter the dollars would over-report
  // refunded/reversed payments to the IRS.
  vendorVoidedId: number;
}

const ROUTING_MARKER = `r1099-routing-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const ROUTING_TAX_YEAR = 2026;

let routingSeed: RoutingSeedIds | null = null;
let routingDb: typeof import("@workspace/db");
let nec1099RowsFn: typeof import("../lib/reports/nec1099").nec1099Rows;
let misc1099RowsFn: typeof import("../lib/reports/misc1099").misc1099Rows;
let k1099RowsFn: typeof import("../lib/reports/k1099").k1099Rows;

async function seedRouting(): Promise<RoutingSeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    invoicesTable,
    invoiceLinesTable,
    invoicePaymentsTable,
  } = routingDb;

  const partnerEin = String(900_000_000 + Math.floor(Math.random() * 99_999_999))
    .padStart(9, "0")
    .slice(0, 9);
  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${ROUTING_MARKER}-Routing Partner`,
      contactName: "AP",
      contactEmail: `${ROUTING_MARKER}-ap@example.com`,
      billingAddress: "1 Routing Way, Houston, TX 77001",
      physicalAddress: "1 Routing Way, Houston, TX 77001",
      federalTaxId: partnerEin,
      businessPhone: "5550009999",
    })
    .returning({ id: partnersTable.id });

  const makeVendor = async (suffix: string) => {
    const [v] = await db
      .insert(vendorsTable)
      .values({
        name: `${ROUTING_MARKER}-Vendor-${suffix}`,
        contactName: "Owner",
        contactEmail: `${ROUTING_MARKER}-${suffix}@example.com`,
        billingAddress: "100 Vendor Rd, Midland, TX 79701",
        // Each vendor uses a distinct random EIN so the shared-EIN
        // detection doesn't fire and pollute these focused assertions.
        federalTaxId: String(
          100_000_000 + Math.floor(Math.random() * 800_000_000),
        )
          .padStart(9, "0")
          .slice(0, 9),
      })
      .returning({ id: vendorsTable.id });
    return v.id;
  };

  const vendorMixedId = await makeVendor("Mixed");
  const vendorPartialId = await makeVendor("Partial");
  const vendorSplitMethodId = await makeVendor("Split");
  const vendorNoneId = await makeVendor("None");
  const vendorOverpayNecId = await makeVendor("OverpayNec");
  const vendorOverpayMiscId = await makeVendor("OverpayMisc");
  const vendorOverpayCardId = await makeVendor("OverpayCard");
  const vendorVoidedId = await makeVendor("Voided");

  const periodStart = new Date(Date.UTC(ROUTING_TAX_YEAR, 5, 1));
  const periodEnd = new Date(Date.UTC(ROUTING_TAX_YEAR, 5, 30, 23, 59, 59));
  const paidAt = new Date(Date.UTC(ROUTING_TAX_YEAR, 6, 15, 12, 0, 0));

  // ── Scenario 1: NEC + misc_rents on the same invoice, paid in full ──
  // Invoice total is $1800 ($1000 NEC + $800 rents), one ACH payment
  // covers it. Each line's contribution is `amount * (paid / total) =
  // amount * 1.0`. Expectation: NEC totalPaid = $1000, MISC box1Rents
  // = $800. A bug that joined the NEC filter onto the wrong line, or
  // dropped the line filter entirely, would either zero NEC or sweep
  // the rents amount into NEC.
  const [invMixed] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-MIXED-001`,
      vendorId: vendorMixedId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "1800.00",
      taxTotal: "0.00",
      total: "1800.00",
      paidAmount: "1800.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values([
    {
      invoiceId: invMixed.id,
      sourceType: "manual",
      lineType: "labor_regular",
      description: "Labor",
      quantity: "1.0000",
      unitPrice: "1000.0000",
      amount: "1000.00",
      incomeCategory: "nec",
    },
    {
      invoiceId: invMixed.id,
      sourceType: "manual",
      lineType: "other",
      description: "Equipment rental",
      quantity: "1.0000",
      unitPrice: "800.0000",
      amount: "800.00",
      incomeCategory: "misc_rents",
    },
  ]);
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invMixed.id,
    method: "ach",
    amount: "1800.00",
    paidAt,
  });

  // ── Scenario 2: single NEC line, partially paid ──
  // Invoice total $2000, only $1000 paid (50%). The proportional
  // formula `line.amount * LEAST(paid, total) / total = 2000 * 0.5`
  // must yield $1000 on NEC — not the full $2000 line amount and not
  // the raw payment of $1000 (those happen to coincide here, but the
  // test still anchors the contract).
  const [invPartial] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-PARTIAL-001`,
      vendorId: vendorPartialId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "partial",
      periodStart,
      periodEnd,
      subtotal: "2000.00",
      taxTotal: "0.00",
      total: "2000.00",
      paidAmount: "1000.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invPartial.id,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Labor — half-paid",
    quantity: "1.0000",
    unitPrice: "2000.0000",
    amount: "2000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invPartial.id,
    method: "ach",
    amount: "1000.00",
    paidAt,
  });

  // ── Scenario 3: NEC line paid 50% ACH + 50% credit card ──
  // Invoice total $1200, two payments of $600. The NEC filter excludes
  // credit_card payments → only the ACH payment row survives → $1200
  // line × ($600 / $1200) = $600 on NEC. The K filter takes ONLY the
  // credit_card payment → $600 on K. Together: $600 NEC + $600 K, NOT
  // $1200 on either form. This is the canonical "don't double-count
  // the same dollars on two forms" regression guard.
  const [invSplit] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-SPLIT-001`,
      vendorId: vendorSplitMethodId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "1200.00",
      taxTotal: "0.00",
      total: "1200.00",
      paidAmount: "1200.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invSplit.id,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Labor — paid two ways",
    quantity: "1.0000",
    unitPrice: "1200.0000",
    amount: "1200.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values([
    {
      invoiceId: invSplit.id,
      method: "ach",
      amount: "600.00",
      paidAt,
    },
    {
      invoiceId: invSplit.id,
      method: "credit_card",
      amount: "600.00",
      paidAt,
    },
  ]);

  // ── Scenario 4: line with income_category = 'none' ──
  // Reimbursements / returns of capital sit in this bucket. The amount
  // is well above every reporting threshold; if a SQL filter ever drops
  // the `incomeCategory` predicate, $5000 would suddenly appear on NEC
  // (or MISC). Paid by ACH so it can't even be excused via the K path.
  const [invNone] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-NONE-001`,
      vendorId: vendorNoneId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "5000.00",
      taxTotal: "0.00",
      total: "5000.00",
      paidAmount: "5000.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invNone.id,
    sourceType: "manual",
    lineType: "other",
    description: "Reimbursement (not 1099-reportable)",
    quantity: "1.0000",
    unitPrice: "5000.0000",
    amount: "5000.00",
    incomeCategory: "none",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invNone.id,
    method: "ach",
    amount: "5000.00",
    paidAt,
  });

  // ── Scenario 5a: NEC line on a $1000 invoice paid $1200 by ACH ──
  // Over-payments (e.g. duplicate ACH, customer prepay, refund still
  // pending) must be clamped at the invoice total when apportioned to
  // 1099 boxes. The proportional formula
  //   line.amount * LEAST(payment.amount, invoice.total) / invoice.total
  // turns 1000 * LEAST(1200, 1000) / 1000 = $1000 — NOT $1200. A
  // regression that drops the LEAST() clamp and uses raw payment.amount
  // would silently report 10% extra income to the IRS for this vendor.
  const [invOverpayNec] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-OVERPAY-NEC-001`,
      vendorId: vendorOverpayNecId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "1000.00",
      taxTotal: "0.00",
      total: "1000.00",
      paidAmount: "1200.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invOverpayNec.id,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Labor — over-paid",
    quantity: "1.0000",
    unitPrice: "1000.0000",
    amount: "1000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invOverpayNec.id,
    method: "ach",
    amount: "1200.00",
    paidAt,
  });

  // ── Scenario 5b: misc_rents line on a $1000 invoice paid $1200 ──
  // Same over-pay shape as 5a but on the MISC pipeline so misc1099's
  // identical LEAST() clamp is also covered. Box 1 (rents) must read
  // $1000.00 — NOT $1200.00 — under the proportional formula.
  const [invOverpayMisc] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-OVERPAY-MISC-001`,
      vendorId: vendorOverpayMiscId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "1000.00",
      taxTotal: "0.00",
      total: "1000.00",
      paidAmount: "1200.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invOverpayMisc.id,
    sourceType: "manual",
    lineType: "other",
    description: "Equipment rental — over-paid",
    quantity: "1.0000",
    unitPrice: "1000.0000",
    amount: "1000.00",
    incomeCategory: "misc_rents",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invOverpayMisc.id,
    method: "ach",
    amount: "1200.00",
    paidAt,
  });

  // ── Scenario 5d: NEC line on a $1000 invoice paid $1200 by credit card ──
  // Same shape as 5a/5b, but the over-payment arrives via credit_card so
  // it routes to 1099-K instead of NEC/MISC. Per IRS Pub 1220, Box 1a of
  // the 1099-K is the **gross amount of payment card / TPSO transactions**
  // settled to the payee in the calendar year — it is NOT clamped to the
  // invoice total or any apportioned line amount. The TPSO reports what
  // it actually processed; reconciling that against the underlying
  // invoice is the recipient's responsibility on their return.
  //
  // k1099Rows therefore SUMs invoice_payments.amount with no LEAST()
  // clamp, so an over-paid card invoice must surface the **gross $1200**
  // — NOT $1000. This is the deliberate divergence from nec1099 / misc1099
  // and the reason this scenario lives here as its own fixture: a future
  // refactor that "consistency-fixes" k1099 to share the NEC/MISC clamp
  // would silently under-report TPSO totals to the IRS, and this test
  // would catch it.
  const [invOverpayCard] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-OVERPAY-CARD-001`,
      vendorId: vendorOverpayCardId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "1000.00",
      taxTotal: "0.00",
      total: "1000.00",
      paidAmount: "1200.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invOverpayCard.id,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Card-paid services — over-paid",
    quantity: "1.0000",
    unitPrice: "1000.0000",
    amount: "1000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invOverpayCard.id,
    method: "credit_card",
    amount: "1200.00",
    paidAt,
  });

  // ── Scenario 5c: voided payments must NEVER appear on any 1099 ──
  // One invoice with both an NEC line and a misc_rents line, paid by an
  // ACH payment AND a credit_card payment — and BOTH payments are voided
  // (refunded / reversed). All amounts sit comfortably above the IRS
  // $600 thresholds, so if `isNull(voided_at)` were ever dropped from
  // any of the three reports the dollars would surface immediately:
  //   * NEC would see the ACH payment → $1000 NEC line × ($1000/$2000)
  //     = $500 reportable.
  //   * MISC has no method filter, so both payments would feed it →
  //     $1000 misc_rents line × LEAST($payment, $invoice)/$invoice for
  //     each payment, summing to $1000.
  //   * K would see the credit_card payment → $1000 gross.
  // With the voided filter intact, every report must return zero rows
  // for this vendor — that's the IRS over-reporting / refund-correctness
  // guarantee this scenario asserts.
  const voidedAt = new Date(Date.UTC(ROUTING_TAX_YEAR, 7, 1, 12, 0, 0));
  const [invVoided] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${ROUTING_MARKER}-VOIDED-001`,
      vendorId: vendorVoidedId,
      partnerId: partner.id,
      cadence: "monthly",
      status: "paid",
      periodStart,
      periodEnd,
      subtotal: "2000.00",
      taxTotal: "0.00",
      total: "2000.00",
      // paidAmount stays at $2000 to mirror the original (pre-void)
      // bookkeeping — the void lives on invoice_payments, not the
      // invoice header.
      paidAmount: "2000.00",
    })
    .returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values([
    {
      invoiceId: invVoided.id,
      sourceType: "manual",
      lineType: "labor_regular",
      description: "Labor — voided",
      quantity: "1.0000",
      unitPrice: "1000.0000",
      amount: "1000.00",
      incomeCategory: "nec",
    },
    {
      invoiceId: invVoided.id,
      sourceType: "manual",
      lineType: "other",
      description: "Equipment rental — voided",
      quantity: "1.0000",
      unitPrice: "1000.0000",
      amount: "1000.00",
      incomeCategory: "misc_rents",
    },
  ]);
  await db.insert(invoicePaymentsTable).values([
    {
      invoiceId: invVoided.id,
      method: "ach",
      amount: "1000.00",
      paidAt,
      voidedAt,
      voidedReason: "refunded",
    },
    {
      invoiceId: invVoided.id,
      method: "credit_card",
      amount: "1000.00",
      paidAt,
      voidedAt,
      voidedReason: "refunded",
    },
  ]);

  return {
    partnerId: partner.id,
    vendorMixedId,
    vendorPartialId,
    vendorSplitMethodId,
    vendorNoneId,
    vendorOverpayNecId,
    vendorOverpayMiscId,
    vendorOverpayCardId,
    vendorVoidedId,
  };
}

async function cleanupRouting(): Promise<void> {
  const { db } = routingDb;
  // Mirrors the main suite's marker-scoped cleanup so a failed run never
  // leaves dangling rows behind to skew a follow-up suite's totals.
  await db.execute(
    sql`delete from invoice_payments where invoice_id in (select id from invoices where invoice_number like ${ROUTING_MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from invoice_lines where invoice_id in (select id from invoices where invoice_number like ${ROUTING_MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from invoices where invoice_number like ${ROUTING_MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from vendors where name like ${ROUTING_MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from partners where name like ${ROUTING_MARKER + "-%"}`,
  );
}

describe.runIf(haveRealDb)("1099 line-level routing", () => {
  beforeAll(async () => {
    routingDb = await import("@workspace/db");
    nec1099RowsFn = (await import("../lib/reports/nec1099")).nec1099Rows;
    misc1099RowsFn = (await import("../lib/reports/misc1099")).misc1099Rows;
    k1099RowsFn = (await import("../lib/reports/k1099")).k1099Rows;
    routingSeed = await seedRouting();
  }, 30_000);

  afterAll(async () => {
    try {
      await cleanupRouting();
    } finally {
      routingSeed = null;
    }
  });

  it("invoice with both NEC and misc_* lines splits across NEC and MISC totals", async () => {
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorMixedId,
    });
    expect(necRows).toHaveLength(1);
    // NEC sees only the $1000 NEC line; the $800 misc_rents line must
    // not contribute even though the same payment row covered both.
    expect(necRows[0].totalPaid).toBe("1000.00");

    const miscRows = await misc1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorMixedId,
    });
    expect(miscRows).toHaveLength(1);
    // MISC sees only the $800 misc_rents line, lands in Box 1.
    expect(miscRows[0].box1Rents).toBe("800.00");
    expect(miscRows[0].totalReportable).toBe("800.00");

    // K is empty — no credit_card payments on this invoice at all.
    const kRows = await k1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorMixedId,
    });
    expect(kRows).toHaveLength(0);
  });

  it("partial payment apportions an NEC line proportionally", async () => {
    // Override the threshold so the $1000 apportioned amount surfaces
    // in the result without depending on it being above the IRS $600.
    // (It is — $1000 ≥ $600 — but pinning the threshold keeps the
    // assertion about the proportional math, not the threshold gate.)
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorPartialId,
      threshold: 1,
    });
    expect(necRows).toHaveLength(1);
    // $2000 line × LEAST($1000 paid, $2000 total) / $2000 = $1000.00.
    // A regression that summed the raw payment amount would still
    // print $1000 here by coincidence; a regression that summed the
    // raw line amount would print $2000 and fail this assertion.
    expect(necRows[0].totalPaid).toBe("1000.00");

    // MISC and K must not see this NEC line at all.
    const miscRows = await misc1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorPartialId,
    });
    expect(miscRows).toHaveLength(0);
    const kRows = await k1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorPartialId,
    });
    expect(kRows).toHaveLength(0);
  });

  it("NEC line paid 50% ACH / 50% credit card lands the ACH on NEC and the card on K", async () => {
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorSplitMethodId,
      threshold: 1,
    });
    expect(necRows).toHaveLength(1);
    // ACH payment only: $1200 line × ($600 / $1200) = $600.00.
    expect(necRows[0].totalPaid).toBe("600.00");

    const kRows = await k1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorSplitMethodId,
      threshold: 1,
    });
    expect(kRows).toHaveLength(1);
    // K reports the gross credit_card payment regardless of category.
    expect(kRows[0].grossAmount).toBe("600.00");

    // Sum across both forms must equal the actual money moved ($1200),
    // proving the dollars were partitioned (not duplicated) across
    // the two filings.
    expect(
      Number(necRows[0].totalPaid) + Number(kRows[0].grossAmount),
    ).toBe(1200);

    // The NEC line is not a misc_* category, so MISC stays empty.
    const miscRows = await misc1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorSplitMethodId,
    });
    expect(miscRows).toHaveLength(0);
  });

  it("clamps an over-paid invoice's NEC contribution at the invoice total", async () => {
    // $1000 invoice paid $1200 by ACH. The proportional formula
    //   line.amount * LEAST(payment.amount, invoice.total) / invoice.total
    // must report $1000.00 — NOT $1200.00. Drop the threshold so the
    // assertion is about the clamp, not the $600 reporting gate.
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorOverpayNecId,
      threshold: 1,
    });
    expect(necRows).toHaveLength(1);
    // If a regression replaces LEAST(payment.amount, invoice.total) with
    // the raw payment.amount, this would be "1200.00" and the IRS would
    // see 10% extra income for this vendor.
    expect(necRows[0].totalPaid).toBe("1000.00");
  });

  it("clamps an over-paid invoice's MISC contribution at the invoice total", async () => {
    // Same shape as the NEC over-pay scenario but on the MISC pipeline:
    // misc1099 carries the same LEAST(payment, total) clamp and must
    // produce $1000.00 in Box 1 (rents), not $1200.00.
    const miscRows = await misc1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorOverpayMiscId,
    });
    expect(miscRows).toHaveLength(1);
    expect(miscRows[0].box1Rents).toBe("1000.00");
    expect(miscRows[0].totalReportable).toBe("1000.00");
  });

  it("reports the GROSS payment amount on 1099-K when a card invoice is over-paid", async () => {
    // $1000 invoice paid $1200 by credit card. Unlike NEC/MISC, the
    // 1099-K is filed by the TPSO (the card processor) and reports the
    // gross dollars **settled** to the payee — see IRS Pub 1220, Part C,
    // Record Layout for Form 1099-K, Box 1a "Gross amount of payment
    // card/third party network transactions". That field is explicitly
    // the amount the network processed, not the underlying invoice
    // total, and the IRS instructions warn filers NOT to net out
    // chargebacks, refunds, fees, or over-payments — those sit on the
    // recipient's return as reconciling items.
    //
    // So k1099Rows must surface the **gross $1200.00**, not the
    // invoice-clamped $1000.00 that NEC/MISC use. Pin the threshold to
    // $1 so the assertion is about the (deliberate lack of a) clamp,
    // not the IRS dollar floor.
    const kRows = await k1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorOverpayCardId,
      threshold: 1,
    });
    expect(kRows).toHaveLength(1);
    // If a future refactor "harmonizes" k1099 with the NEC/MISC
    // LEAST(payment, total) clamp, this would silently drop to
    // "1000.00" and we'd under-report TPSO gross to the IRS.
    expect(kRows[0].grossAmount).toBe("1200.00");
    // Same gross dollars must land in the July monthly bucket (Box 5g)
    // since the seeded paidAt is 7/15 — guards against a regression
    // that clamps the monthly aggregate independently of the gross.
    expect(kRows[0].monthly[6]).toBe("1200.00");
    expect(kRows[0].transactionCount).toBe(1);

    // The over-paid card invoice is NEC-categorized at the line level,
    // but credit-card payments are excluded from NEC by design (they
    // belong on K). With a single card payment and no ACH, NEC must
    // see zero — confirming the dollars are reported on exactly one
    // form, not double-counted.
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorOverpayCardId,
      threshold: 1,
    });
    expect(necRows).toHaveLength(0);
  });

  it("voided payments never appear on NEC, MISC, or K", async () => {
    // Threshold pinned to 1 so the only thing keeping the result empty
    // is the `isNull(voided_at)` predicate itself, not the IRS dollar
    // floor. The seeded amounts ($1000 NEC line, $1000 misc_rents line,
    // and a $1000 credit-card payment) would all clear the real $600
    // thresholds if the void filter ever silently dropped, so this
    // assertion would fail loudly instead of leaving voided dollars on
    // the form.
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorVoidedId,
      threshold: 1,
    });
    expect(necRows).toHaveLength(0);

    const miscRows = await misc1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorVoidedId,
    });
    expect(miscRows).toHaveLength(0);

    const kRows = await k1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorVoidedId,
      threshold: 1,
    });
    expect(kRows).toHaveLength(0);
  });

  it("a line with income_category = 'none' is excluded from NEC, MISC and K", async () => {
    // Drop the threshold to 1 so the only thing standing between this
    // $5000 ACH-paid invoice and a result row is the income_category
    // filter itself.
    const necRows = await nec1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorNoneId,
      threshold: 1,
    });
    expect(necRows).toHaveLength(0);

    const miscRows = await misc1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorNoneId,
    });
    expect(miscRows).toHaveLength(0);

    // K filters by payment method, not income category, and the seed
    // pays this invoice by ACH — so K is empty for the right reason.
    const kRows = await k1099RowsFn({
      year: ROUTING_TAX_YEAR,
      payerPartnerId: routingSeed!.partnerId,
      vendorId: routingSeed!.vendorNoneId,
      threshold: 1,
    });
    expect(kRows).toHaveLength(0);
  });
});

describe.skipIf(haveRealDb)("1099 line-level routing", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder used
    // by the unit-test setup; this suite seeds real rows and exercises
    // the actual SQL the 1099 routing filters issue.
  });
});
