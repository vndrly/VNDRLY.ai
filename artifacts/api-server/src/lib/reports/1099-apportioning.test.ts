import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedSchema,
  dropStaleIsolatedSchemas,
  hasReachableDatabase,
  type IsolatedSchemaHandle,
} from "../../test/db-harness";

// ---------------------------------------------------------------------------
// End-to-end DB coverage for the SQL apportioning rules in
// {nec1099,misc1099,k1099}.ts. The existing unit tests in
// nec1099.test.ts / misc1099.test.ts / k1099.test.ts only exercise the
// pure threshold and rollup helpers — they don't actually run the
// `LEAST(payment, total)/total` apportionment SQL or the credit-card /
// income-category filters. Without these checks the backend can drift
// from the now-locked client-side contract in
// artifacts/vndrly/src/lib/form1099.test.ts and the year-end totals
// will silently disagree with what the UI shows.
//
// Each describe block seeds a tightly scoped invoice/line/payment
// fixture into an isolated Postgres schema, calls the public report
// function (nec1099Rows / misc1099Rows / k1099Rows), and asserts the
// rolled-up amounts. The harness drops the schema CASCADE in afterAll
// so cleanup is automatic and these tests do not pollute the dev DB.
// ---------------------------------------------------------------------------

const HAVE_DB = await hasReachableDatabase();

const TAX_YEAR = 2026;

let handle: IsolatedSchemaHandle | null = null;
let dbModule: typeof import("@workspace/db");
let nec1099Mod: typeof import("./nec1099");
let misc1099Mod: typeof import("./misc1099");
let k1099Mod: typeof import("./k1099");

let partnerId: number;
let vendorNecAchId: number; // single-line NEC, ACH only
let vendorNecMixedId: number; // single-line NEC, ACH + credit_card split
let vendorNecMultiLineId: number; // NEC + misc_rents on same invoice, ACH
let vendorMiscCcId: number; // misc_rents only, paid by credit_card
let vendorKMonthlyId: number; // NEC line, three credit_card payments across months

async function seed(): Promise<void> {
  const {
    db,
    partnersTable,
    vendorsTable,
    invoicesTable,
    invoiceLinesTable,
    invoicePaymentsTable,
  } = dbModule;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: "Apportioning Test Partner",
      contactName: "AP",
      contactEmail: "ap@example.com",
      billingAddress: "100 Big Ave",
      federalTaxId: "987654321",
    })
    .returning({ id: partnersTable.id });
  partnerId = partner.id;

  async function makeVendor(name: string, ein: string): Promise<number> {
    const [v] = await db
      .insert(vendorsTable)
      .values({
        name,
        contactName: "Owner",
        contactEmail: `${name.replace(/\s+/g, "-").toLowerCase()}@example.com`,
        billingAddress: "1 Main St",
        federalTaxId: ein,
      })
      .returning({ id: vendorsTable.id });
    return v.id;
  }

  vendorNecAchId = await makeVendor("Nec Ach Vendor", "111111111");
  vendorNecMixedId = await makeVendor("Nec Mixed Vendor", "222222222");
  vendorNecMultiLineId = await makeVendor("Nec Multi Vendor", "333333333");
  vendorMiscCcId = await makeVendor("Misc CC Vendor", "444444444");
  vendorKMonthlyId = await makeVendor("K Monthly Vendor", "555555555");

  const periodStart = new Date(Date.UTC(TAX_YEAR, 5, 1));
  const periodEnd = new Date(Date.UTC(TAX_YEAR, 5, 30, 23, 59, 59));
  const paidAt = new Date(Date.UTC(TAX_YEAR, 6, 15, 12, 0, 0));

  async function makeInvoice(
    vendorId: number,
    invoiceNumber: string,
    total: string,
    paidAmount: string,
  ): Promise<number> {
    const [inv] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber,
        vendorId,
        partnerId,
        cadence: "monthly",
        status: "paid",
        periodStart,
        periodEnd,
        subtotal: total,
        taxTotal: "0.00",
        total,
        paidAmount,
      })
      .returning({ id: invoicesTable.id });
    return inv.id;
  }

  // --- Vendor A: pure NEC paid in full by ACH (single-line baseline). ---
  const invA = await makeInvoice(vendorNecAchId, "APT-A-001", "1500.00", "1500.00");
  await db.insert(invoiceLinesTable).values({
    invoiceId: invA,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Drilling labor",
    quantity: "1.0000",
    unitPrice: "1500.0000",
    amount: "1500.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invA,
    method: "ach",
    amount: "1500.00",
    paidAt,
  });

  // --- Vendor B: single NEC line, paid $400 by credit_card and $600 by
  // cash. NEC excludes the cc payment (LEAST(600, 1000)/1000 share = 0.6)
  // and K reports the cc payment ($400). Sums must equal the line total
  // ($1000) without double-counting. ---
  const invB = await makeInvoice(vendorNecMixedId, "APT-B-001", "1000.00", "1000.00");
  await db.insert(invoiceLinesTable).values({
    invoiceId: invB,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Mixed-pay labor",
    quantity: "1.0000",
    unitPrice: "1000.0000",
    amount: "1000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values([
    { invoiceId: invB, method: "credit_card", amount: "400.00", paidAt },
    { invoiceId: invB, method: "cash", amount: "600.00", paidAt },
  ]);

  // --- Vendor C: multi-line invoice (NEC + misc_rents) paid in full by
  // ACH. Apportioning by LEAST(payment, total)/total = 1.0 should make
  // NEC = $700 and MISC rents = $800 — i.e. each line's own amount, not
  // the full payment summed against both lines. ---
  const invC = await makeInvoice(vendorNecMultiLineId, "APT-C-001", "1500.00", "1500.00");
  await db.insert(invoiceLinesTable).values([
    {
      invoiceId: invC,
      sourceType: "manual",
      lineType: "labor_regular",
      description: "Service labor",
      quantity: "1.0000",
      unitPrice: "700.0000",
      amount: "700.00",
      incomeCategory: "nec",
    },
    {
      invoiceId: invC,
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
    invoiceId: invC,
    method: "ach",
    amount: "1500.00",
    paidAt,
  });

  // --- Vendor D: misc_rents-only invoice paid in full by credit_card.
  // MISC ignores payment method, so the row should appear at $700. K
  // must NOT include this credit-card payment because the underlying
  // invoice has no NEC / k_third_party_network line — that mirrors the
  // client-side helper, which keeps MISC categories on MISC even when
  // paid by card. ---
  const invD = await makeInvoice(vendorMiscCcId, "APT-D-001", "700.00", "700.00");
  await db.insert(invoiceLinesTable).values({
    invoiceId: invD,
    sourceType: "manual",
    lineType: "other",
    description: "Equipment rental",
    quantity: "1.0000",
    unitPrice: "700.0000",
    amount: "700.00",
    incomeCategory: "misc_rents",
  });
  await db.insert(invoicePaymentsTable).values({
    invoiceId: invD,
    method: "credit_card",
    amount: "700.00",
    paidAt,
  });

  // --- Vendor E: NEC line $9000 invoice paid by three credit_card
  // installments in Jan / Jun / Dec so the K monthly breakout (Boxes
  // 5a-5l) and crossedAtMonthIdx have multiple non-zero buckets to
  // assert on. NEC report should be $0 (all card). ---
  const invE = await makeInvoice(vendorKMonthlyId, "APT-E-001", "9000.00", "9000.00");
  await db.insert(invoiceLinesTable).values({
    invoiceId: invE,
    sourceType: "manual",
    lineType: "labor_regular",
    description: "Card-paid services",
    quantity: "1.0000",
    unitPrice: "9000.0000",
    amount: "9000.00",
    incomeCategory: "nec",
  });
  await db.insert(invoicePaymentsTable).values([
    {
      invoiceId: invE,
      method: "credit_card",
      amount: "3000.00",
      paidAt: new Date(Date.UTC(TAX_YEAR, 0, 15)),
    },
    {
      invoiceId: invE,
      method: "credit_card",
      amount: "2500.00",
      paidAt: new Date(Date.UTC(TAX_YEAR, 5, 20)),
    },
    {
      invoiceId: invE,
      method: "credit_card",
      amount: "3500.00",
      paidAt: new Date(Date.UTC(TAX_YEAR, 11, 1)),
    },
  ]);
}

describe.runIf(HAVE_DB)("1099 backend routing-rule apportioning", () => {
  beforeAll(async () => {
    await dropStaleIsolatedSchemas();
    handle = await createIsolatedSchema("1099-apportion");
    process.env.DATABASE_URL = handle.url;
    dbModule = await import("@workspace/db");
    nec1099Mod = await import("./nec1099");
    misc1099Mod = await import("./misc1099");
    k1099Mod = await import("./k1099");
    await seed();
  }, 60_000);

  afterAll(async () => {
    try {
      await dbModule?.pool.end();
    } finally {
      await handle?.teardown();
    }
  });

  describe("nec1099Rows — apportioning + credit-card exclusion", () => {
    it("includes a single-line NEC invoice paid in full by ACH at the line amount", async () => {
      const rows = await nec1099Mod.nec1099Rows({
        year: TAX_YEAR,
        vendorId: vendorNecAchId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].totalPaid).toBe("1500.00");
    });

    it("apportions a NEC line on a multi-line invoice by line amount, not full payment", async () => {
      // Invoice C: NEC $700 + misc_rents $800, total $1500, paid $1500
      // ACH. NEC contribution = 700 * (1500/1500) = 700, NOT $1500.
      // A naive SUM(payment.amount) would erroneously yield $1500.
      const rows = await nec1099Mod.nec1099Rows({
        year: TAX_YEAR,
        vendorId: vendorNecMultiLineId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].totalPaid).toBe("700.00");
    });

    it("excludes credit-card payments when computing NEC totals", async () => {
      // Invoice B: NEC $1000, $400 cc + $600 cash. cc is excluded so
      // NEC sum = 1000 * (600/1000) = 600. Above $600 threshold so the
      // row appears.
      const rows = await nec1099Mod.nec1099Rows({
        year: TAX_YEAR,
        vendorId: vendorNecMixedId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].totalPaid).toBe("600.00");
    });

    it("does not produce an NEC row for an NEC line paid entirely by credit card", async () => {
      // Vendor E's whole $9000 NEC line was paid by credit_card, so the
      // NEC sum is $0 — below the $600 threshold and therefore absent.
      const rows = await nec1099Mod.nec1099Rows({
        year: TAX_YEAR,
        vendorId: vendorKMonthlyId,
      });
      expect(rows).toHaveLength(0);
    });

    it("does not include misc_* lines on the NEC report", async () => {
      // Vendor D has only a misc_rents line — no NEC anywhere. NEC must
      // be empty for this vendor regardless of payment method.
      const rows = await nec1099Mod.nec1099Rows({
        year: TAX_YEAR,
        vendorId: vendorMiscCcId,
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe("misc1099Rows — categories ignore payment method", () => {
    it("aggregates a multi-category invoice by income_category, not by line count", async () => {
      // Vendor C: misc_rents $800 line on a $1500 invoice paid in full
      // (NEC $700 line is on the same invoice). MISC report rents box
      // should be $800 — apportioning shouldn't bleed the NEC dollars
      // into the rents box.
      const rows = await misc1099Mod.misc1099Rows({
        year: TAX_YEAR,
        vendorId: vendorNecMultiLineId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].box1Rents).toBe("800.00");
      expect(rows[0].totalReportable).toBe("800.00");
    });

    it("keeps a MISC line paid by credit card on the MISC report (no method exclusion)", async () => {
      // Vendor D: misc_rents $700 paid entirely by credit_card. MISC
      // does not filter by payment method (unlike NEC), so the row
      // should appear at the full line amount.
      const rows = await misc1099Mod.misc1099Rows({
        year: TAX_YEAR,
        vendorId: vendorMiscCcId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].box1Rents).toBe("700.00");
      expect(rows[0].totalReportable).toBe("700.00");
    });
  });

  describe("k1099Rows — credit-card aggregation, monthly breakout", () => {
    it("does NOT include a credit-card payment whose invoice has only MISC lines", async () => {
      // The locked client contract (form1099.test.ts) keeps misc_*
      // categories on MISC even when paid by card. The K rollup must
      // mirror that — otherwise vendor D's $700 would be double-reported
      // (once on MISC, once on K) for the same recipient.
      const rows = await k1099Mod.k1099Rows({
        year: TAX_YEAR,
        vendorId: vendorMiscCcId,
        threshold: 1, // force inclusion regardless of IRS threshold
      });
      expect(rows).toHaveLength(0);
    });

    it("aggregates monthly buckets and counts transactions for an NEC line paid by card", async () => {
      // Vendor E: three cc installments in Jan (3000), Jun (2500), Dec
      // (3500). Gross $9000, tx count = 3, monthly buckets per month.
      const rows = await k1099Mod.k1099Rows({
        year: TAX_YEAR,
        vendorId: vendorKMonthlyId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].grossAmount).toBe("9000.00");
      expect(rows[0].transactionCount).toBe(3);
      expect(rows[0].monthly).toHaveLength(12);
      expect(rows[0].monthly[0]).toBe("3000.00");
      expect(rows[0].monthly[5]).toBe("2500.00");
      expect(rows[0].monthly[11]).toBe("3500.00");
      for (const idx of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
        expect(rows[0].monthly[idx]).toBe("0.00");
      }
      // 2026 IRS threshold is $600 — crossed in the very first month.
      expect(rows[0].crossedAtMonthIdx).toBe(0);
    });

    it("includes the cc share of an NEC line that was paid partly by card and partly by cash", async () => {
      // Vendor B: $1000 NEC line, $400 cc + $600 cash. K should show
      // the cc payment ($400). Combined with the $600 NEC row from the
      // NEC test above, the two reports sum to $1000 — exactly the line
      // amount, with no double-count.
      const kRows = await k1099Mod.k1099Rows({
        year: TAX_YEAR,
        vendorId: vendorNecMixedId,
        threshold: 1,
      });
      expect(kRows).toHaveLength(1);
      expect(kRows[0].grossAmount).toBe("400.00");
      expect(kRows[0].transactionCount).toBe(1);

      const necRows = await nec1099Mod.nec1099Rows({
        year: TAX_YEAR,
        vendorId: vendorNecMixedId,
      });
      // NEC + K must equal the line amount exactly — the contract the
      // task #311 client-side tests pin down.
      expect(
        Number(necRows[0].totalPaid) + Number(kRows[0].grossAmount),
      ).toBe(1000);
    });
  });
});
