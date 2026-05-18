// Real-DB test for the aging worker. Skips if DATABASE_URL is unset.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

vi.mock("./sendgrid", () => ({
  sendInvoiceReminderEmail: vi.fn(async () => undefined),
}));
vi.mock("../routes/notifications", async () => {
  const actual = await vi.importActual<
    typeof import("../routes/notifications")
  >("../routes/notifications");
  return {
    ...actual,
    notifyUsers: vi.fn(async () => undefined),
  };
});
vi.mock("./invoice-recipients", () => ({
  resolveBillingEmail: vi.fn(
    async (opts: { cachedBillingEmail?: string | null }) =>
      opts.cachedBillingEmail ?? null,
  ),
  resolveBillingLocale: vi.fn(async () => "en" as const),
  findPartnerBillingUserIds: vi.fn(async () => []),
  findVendorUserIds: vi.fn(async () => []),
}));

const DATABASE_URL = process.env.DATABASE_URL;
// Explicit opt-in to running these against a real DB. Without this flag
// the suite is hard-skipped even if DATABASE_URL is set, so a developer
// running `vitest` against a workstation that happens to have a non-test
// DATABASE_URL pointed at staging/prod cannot accidentally exercise the
// destructive INSERT/DELETE paths below. CI sets INVOICE_AGING_REAL_DB_TESTS=1
// alongside a disposable test DATABASE_URL.
const REAL_DB_OPT_IN =
  process.env.INVOICE_AGING_REAL_DB_TESTS === "1" ||
  process.env.INVOICE_AGING_REAL_DB_TESTS === "true";
const haveRealDb = await checkDatabase();

async function checkDatabase(): Promise<boolean> {
  if (!REAL_DB_OPT_IN) return false;
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

const MARKER = `aging-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const day = (n: number) => n * 24 * 60 * 60 * 1000;

describe.runIf(haveRealDb)("invoice-aging-worker", () => {
  let runInvoiceAgingScan: typeof import("./invoice-aging-worker").runInvoiceAgingScan;
  let runInvoiceAgingScanWithLock: typeof import("./invoice-aging-worker").runInvoiceAgingScanWithLock;
  let db: typeof import("@workspace/db").db;
  let pool: typeof import("@workspace/db").pool;
  let invoicesTable: typeof import("@workspace/db").invoicesTable;
  let invoiceReminderLogTable: typeof import("@workspace/db").invoiceReminderLogTable;
  let vendorsTable: typeof import("@workspace/db").vendorsTable;
  let partnersTable: typeof import("@workspace/db").partnersTable;
  let eq: typeof import("drizzle-orm").eq;

  let vendorId = 0;
  let partnerId = 0;
  let invoiceId = 0;
  const dueDate = new Date("2026-04-01T00:00:00Z");

  beforeAll(async () => {
    const dbm = await import("@workspace/db");
    const ormm = await import("drizzle-orm");
    db = dbm.db;
    pool = dbm.pool;
    invoicesTable = dbm.invoicesTable;
    invoiceReminderLogTable = dbm.invoiceReminderLogTable;
    vendorsTable = dbm.vendorsTable;
    partnersTable = dbm.partnersTable;
    eq = ormm.eq;
    ({ runInvoiceAgingScan, runInvoiceAgingScanWithLock } = await import(
      "./invoice-aging-worker"
    ));

    const [v] = await db
      .insert(vendorsTable)
      .values({
        name: `${MARKER}-V`,
        contactName: "V",
        contactEmail: `${MARKER}-v@example.com`,
      })
      .returning({ id: vendorsTable.id });
    const [p] = await db
      .insert(partnersTable)
      .values({
        name: `${MARKER}-P`,
        contactName: "P",
        contactEmail: `${MARKER}-p@example.com`,
      })
      .returning({ id: partnersTable.id });
    vendorId = v.id;
    partnerId = p.id;

    const [inv] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: `${MARKER}-INV`,
        vendorId,
        partnerId,
        cadence: "per_ticket",
        status: "sent",
        periodStart: new Date("2026-03-01T00:00:00Z"),
        periodEnd: new Date("2026-03-31T23:59:59Z"),
        dueDate,
        paymentTermsDays: 30,
        subtotal: "1000.00",
        taxTotal: "0.00",
        total: "1000.00",
        paidAmount: "0",
        creditedAmount: "0",
        billingContactEmail: `${MARKER}-billing@example.com`,
      })
      .returning({ id: invoicesTable.id });
    invoiceId = inv.id;
  });

  afterAll(async () => {
    if (invoiceId) {
      await db
        .delete(invoiceReminderLogTable)
        .where(eq(invoiceReminderLogTable.invoiceId, invoiceId));
      await db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    }
    if (vendorId) {
      await db.delete(vendorsTable).where(eq(vendorsTable.id, vendorId));
    }
    if (partnerId) {
      await db.delete(partnersTable).where(eq(partnersTable.id, partnerId));
    }
  });

  it("does NOT flip to overdue when due_date is on the same UTC day as now", async () => {
    // Same UTC calendar day as the due date — calcDaysPastDueUTC === 0,
    // so the worker must leave status untouched and fire no reminders.
    const sameDay = new Date(
      Date.UTC(
        dueDate.getUTCFullYear(),
        dueDate.getUTCMonth(),
        dueDate.getUTCDate(),
        23,
        59,
        59,
      ),
    );
    const r0 = await runInvoiceAgingScan(sameDay);
    expect(r0.flippedToOverdue).toBe(0);
    expect(r0.remindersFired).toBe(0);

    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId));
    expect(inv.status).not.toBe("overdue");

    const reminders = await db
      .select()
      .from(invoiceReminderLogTable)
      .where(eq(invoiceReminderLogTable.invoiceId, invoiceId));
    expect(reminders.filter((r) => r.kind === "aging")).toHaveLength(0);
  });

  it("flips status to overdue and fires the 1-day reminder, exactly once", async () => {
    const now = new Date(dueDate.getTime() + day(2)); // 2 days past due
    const r1 = await runInvoiceAgingScan(now);

    expect(r1.scanned).toBeGreaterThanOrEqual(1);
    expect(r1.flippedToOverdue).toBeGreaterThanOrEqual(1);
    expect(r1.remindersFired).toBeGreaterThanOrEqual(1);

    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId));
    expect(inv.status).toBe("overdue");

    const reminders1 = await db
      .select()
      .from(invoiceReminderLogTable)
      .where(eq(invoiceReminderLogTable.invoiceId, invoiceId));
    const oneDayKey = `aging:1d:${invoiceId}`;
    expect(reminders1.find((r) => r.dedupeKey === oneDayKey)).toBeTruthy();
    expect(reminders1.filter((r) => r.dedupeKey === oneDayKey)).toHaveLength(1);

    // Re-run identical now: dedupe must hold — no new 1d row, no extra fires.
    const beforeCount = reminders1.length;
    const r2 = await runInvoiceAgingScan(now);
    expect(r2.remindersFired).toBe(0);

    const reminders2 = await db
      .select()
      .from(invoiceReminderLogTable)
      .where(eq(invoiceReminderLogTable.invoiceId, invoiceId));
    expect(reminders2).toHaveLength(beforeCount);
  });

  it("fires 15d and 30d thresholds when the clock advances, still dedupe-safe", async () => {
    const at16 = new Date(dueDate.getTime() + day(16));
    const r3 = await runInvoiceAgingScan(at16);
    expect(r3.remindersFired).toBeGreaterThanOrEqual(1);

    const at31 = new Date(dueDate.getTime() + day(31));
    const r4 = await runInvoiceAgingScan(at31);
    expect(r4.remindersFired).toBeGreaterThanOrEqual(1);

    const reminders = await db
      .select()
      .from(invoiceReminderLogTable)
      .where(eq(invoiceReminderLogTable.invoiceId, invoiceId));
    const keys = reminders.map((r) => r.dedupeKey).sort();
    expect(keys).toContain(`aging:1d:${invoiceId}`);
    expect(keys).toContain(`aging:15d:${invoiceId}`);
    expect(keys).toContain(`aging:30d:${invoiceId}`);

    // Each threshold is unique.
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const [, c] of counts) expect(c).toBe(1);

    // Idempotent third pass at 31d.
    const r5 = await runInvoiceAgingScan(at31);
    expect(r5.remindersFired).toBe(0);
  });

  it("does not fire reminders once the balance is fully paid", async () => {
    await db
      .update(invoicesTable)
      .set({ paidAmount: "1000.00", status: "paid" })
      .where(eq(invoicesTable.id, invoiceId));

    const at60 = new Date(dueDate.getTime() + day(60));
    const r = await runInvoiceAgingScan(at60);
    const reminders = await db
      .select()
      .from(invoiceReminderLogTable)
      .where(eq(invoiceReminderLogTable.invoiceId, invoiceId));
    expect(reminders.filter((x) => x.kind === "aging")).toHaveLength(3);
    expect(r.remindersFired).toBe(0);
  });

  it("honors a vendor-configured custom threshold list", async () => {
    const [v2] = await db
      .insert(vendorsTable)
      .values({
        name: `${MARKER}-V2`,
        contactName: "V2",
        contactEmail: `${MARKER}-v2@example.com`,
        agingThresholdDays: [7],
      })
      .returning({ id: vendorsTable.id });

    const due2 = new Date("2026-04-01T00:00:00Z");
    const [inv2] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: `${MARKER}-INV2`,
        vendorId: v2.id,
        partnerId,
        cadence: "per_ticket",
        status: "sent",
        periodStart: new Date("2026-03-01T00:00:00Z"),
        periodEnd: new Date("2026-03-31T23:59:59Z"),
        dueDate: due2,
        paymentTermsDays: 30,
        subtotal: "500.00",
        taxTotal: "0.00",
        total: "500.00",
        paidAmount: "0",
        creditedAmount: "0",
        billingContactEmail: `${MARKER}-billing2@example.com`,
      })
      .returning({ id: invoicesTable.id });

    try {
      const at5 = new Date(due2.getTime() + day(5));
      await runInvoiceAgingScan(at5);
      let rows = await db
        .select()
        .from(invoiceReminderLogTable)
        .where(eq(invoiceReminderLogTable.invoiceId, inv2.id));
      expect(rows.filter((r) => r.kind === "aging")).toHaveLength(0);

      const at8 = new Date(due2.getTime() + day(8));
      await runInvoiceAgingScan(at8);
      rows = await db
        .select()
        .from(invoiceReminderLogTable)
        .where(eq(invoiceReminderLogTable.invoiceId, inv2.id));
      const keys = rows.map((r) => r.dedupeKey);
      expect(keys).toContain(`aging:7d:${inv2.id}`);
      expect(keys.find((k) => k === `aging:1d:${inv2.id}`)).toBeUndefined();
      expect(keys.find((k) => k === `aging:15d:${inv2.id}`)).toBeUndefined();
    } finally {
      await db
        .delete(invoiceReminderLogTable)
        .where(eq(invoiceReminderLogTable.invoiceId, inv2.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.id, inv2.id));
      await db.delete(vendorsTable).where(eq(vendorsTable.id, v2.id));
    }
  });

  it("applies a flat late fee exactly once when the rule fires", async () => {
    // Fresh fixture: an invoice with a per-invoice flat late-fee rule
    // ($25 after 1 day past due). After two scans 2 days past due, exactly
    // ONE late-fee line should exist, the invoice subtotal/total should
    // include it, and the line should be marked is_manual_override=true so
    // a future regenerate cannot wipe it.
    const dbm = await import("@workspace/db");
    const { invoiceLinesTable } = dbm;
    const due3 = new Date("2026-04-10T00:00:00Z");
    const [inv3] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: `${MARKER}-INV3`,
        vendorId,
        partnerId,
        cadence: "per_ticket",
        status: "sent",
        periodStart: new Date("2026-03-01T00:00:00Z"),
        periodEnd: new Date("2026-03-31T23:59:59Z"),
        dueDate: due3,
        paymentTermsDays: 30,
        subtotal: "1000.00",
        taxTotal: "0.00",
        total: "1000.00",
        paidAmount: "0",
        creditedAmount: "0",
        billingContactEmail: `${MARKER}-billing3@example.com`,
        lateFeeRule: { kind: "flat", amount: "25.00", afterDays: 1 },
      })
      .returning({ id: invoicesTable.id });

    try {
      const at2 = new Date(due3.getTime() + day(2));
      await runInvoiceAgingScan(at2);
      // Re-run: idempotency check.
      await runInvoiceAgingScan(at2);

      const lateRows = await db
        .select()
        .from(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv3.id));
      const fees = lateRows.filter((r) => r.sourceType === "late_fee");
      expect(fees).toHaveLength(1);
      expect(fees[0].amount).toBe("25.00");
      expect(fees[0].isManualOverride).toBe(true);
      expect(fees[0].ticketId).toBeNull();
      expect(fees[0].lineType).toBe("other");

      const [refreshed] = await db
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, inv3.id));
      expect(refreshed.subtotal).toBe("1025.00");
      expect(refreshed.total).toBe("1025.00");
    } finally {
      await db
        .delete(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv3.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.id, inv3.id));
    }
  });

  it("applies a percent late fee against the pre-fee invoice total", async () => {
    // 1.5% of $2000 = $30.00. Verifies the percent branch math + the
    // half-away-from-zero rounding via unitsToString2.
    const dbm = await import("@workspace/db");
    const { invoiceLinesTable } = dbm;
    const due4 = new Date("2026-04-10T00:00:00Z");
    const [inv4] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: `${MARKER}-INV4`,
        vendorId,
        partnerId,
        cadence: "per_ticket",
        status: "sent",
        periodStart: new Date("2026-03-01T00:00:00Z"),
        periodEnd: new Date("2026-03-31T23:59:59Z"),
        dueDate: due4,
        paymentTermsDays: 30,
        subtotal: "2000.00",
        taxTotal: "0.00",
        total: "2000.00",
        paidAmount: "0",
        creditedAmount: "0",
        billingContactEmail: `${MARKER}-billing4@example.com`,
        lateFeeRule: {
          kind: "percent",
          rate: "1.50",
          afterDays: 5,
        },
      })
      .returning({ id: invoicesTable.id });

    try {
      // 4 days past due → below threshold, no fee.
      await runInvoiceAgingScan(new Date(due4.getTime() + day(4)));
      const before = await db
        .select()
        .from(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv4.id));
      expect(before.filter((r) => r.sourceType === "late_fee")).toHaveLength(0);

      // 6 days past due → fee fires.
      await runInvoiceAgingScan(new Date(due4.getTime() + day(6)));
      const after = await db
        .select()
        .from(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv4.id));
      const fees = after.filter((r) => r.sourceType === "late_fee");
      expect(fees).toHaveLength(1);
      expect(fees[0].amount).toBe("30.00");

      const [refreshed] = await db
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, inv4.id));
      expect(refreshed.total).toBe("2030.00");
    } finally {
      await db
        .delete(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv4.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.id, inv4.id));
    }
  });

  it("does not apply a late fee when the per-invoice rule is {kind:'none'}", async () => {
    // An explicit {kind:"none"} on the invoice must override any
    // per-(vendor, partner) default. We don't set a vendor default in
    // this fixture, but the explicit skip behavior is what protects
    // admins who *do* configure a vendor default and then carve out a
    // single invoice.
    const dbm = await import("@workspace/db");
    const { invoiceLinesTable } = dbm;
    const due5 = new Date("2026-04-10T00:00:00Z");
    const [inv5] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: `${MARKER}-INV5`,
        vendorId,
        partnerId,
        cadence: "per_ticket",
        status: "sent",
        periodStart: new Date("2026-03-01T00:00:00Z"),
        periodEnd: new Date("2026-03-31T23:59:59Z"),
        dueDate: due5,
        paymentTermsDays: 30,
        subtotal: "500.00",
        taxTotal: "0.00",
        total: "500.00",
        paidAmount: "0",
        creditedAmount: "0",
        billingContactEmail: `${MARKER}-billing5@example.com`,
        lateFeeRule: { kind: "none" },
      })
      .returning({ id: invoicesTable.id });

    try {
      await runInvoiceAgingScan(new Date(due5.getTime() + day(60)));
      const lines = await db
        .select()
        .from(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv5.id));
      expect(lines.filter((r) => r.sourceType === "late_fee")).toHaveLength(0);

      const [refreshed] = await db
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, inv5.id));
      expect(refreshed.total).toBe("500.00");
    } finally {
      await db
        .delete(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, inv5.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.id, inv5.id));
    }
  });

  it("skips the scan when another instance already holds the advisory lock", async () => {
    // Simulate a peer api-server instance by grabbing a separate
    // pool client and acquiring the SAME (ns, key) advisory lock
    // first. The wrapper must observe the contention via
    // pg_try_advisory_lock returning false, log + return null, and
    // crucially NOT attempt to release a lock it never acquired.
    //
    // The (ns, key) constants here MUST match the worker's. Hard-
    // coding rather than re-importing keeps the test honest: a
    // change to those constants in production code requires a
    // matching update here, which is the exact migration audit the
    // file-level comment asks for.
    const ADVISORY_LOCK_NS_INVOICE_AGING = 0x1949c02;
    const ADVISORY_LOCK_KEY_INVOICE_AGING = 1;

    const peer = await pool.connect();
    try {
      const peerLock = await peer.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
        [ADVISORY_LOCK_NS_INVOICE_AGING, ADVISORY_LOCK_KEY_INVOICE_AGING],
      );
      expect(peerLock.rows[0]?.acquired).toBe(true);

      const result = await runInvoiceAgingScanWithLock(
        new Date(dueDate.getTime() + day(45)),
      );
      expect(result).toBeNull();
    } finally {
      await peer.query(
        "SELECT pg_advisory_unlock($1::int, $2::int)",
        [ADVISORY_LOCK_NS_INVOICE_AGING, ADVISORY_LOCK_KEY_INVOICE_AGING],
      );
      peer.release();
    }

    // After the peer releases the lock, the next wrapper invocation
    // should once again acquire it and run normally — the wrapper
    // must always release on its own happy path.
    const result2 = await runInvoiceAgingScanWithLock(
      new Date(dueDate.getTime() + day(45)),
    );
    expect(result2).not.toBeNull();
  });
});

describe.skipIf(haveRealDb)("invoice-aging-worker (skipped: no real DB)", () => {
  it("is skipped when DATABASE_URL is unavailable", () => {
    expect(true).toBe(true);
  });
});

// Deterministic, no-DB unit tests for the calendar-day diff helper. These
// run on every CI invocation regardless of DB availability and lock in
// the time-of-day / DST behavior the aging worker + reminder route share.
describe("calcDaysPastDueUTC", () => {
  let calc: typeof import("./invoice-aging-worker").calcDaysPastDueUTC;
  beforeAll(async () => {
    ({ calcDaysPastDueUTC: calc } = await import("./invoice-aging-worker"));
  });

  it("returns 0 when due date and now are the same UTC calendar day", () => {
    const due = new Date(Date.UTC(2026, 0, 15, 23, 59, 0));
    const now = new Date(Date.UTC(2026, 0, 15, 0, 0, 1));
    expect(calc(due, now)).toBe(0);
  });

  it("returns 1 when crossing UTC midnight (23:59 due → 00:01 next day)", () => {
    const due = new Date(Date.UTC(2026, 0, 15, 23, 59, 0));
    const now = new Date(Date.UTC(2026, 0, 16, 0, 0, 1));
    expect(calc(due, now)).toBe(1);
  });

  it("is unaffected by US DST spring-forward (Mar 8→9 2026)", () => {
    // Spring-forward in 2026 happens 2026-03-08 02:00 local US time.
    // A naive ms-delta would shave an hour and yield 0 across the
    // boundary; the UTC calendar-day diff must still yield 1.
    const due = new Date(Date.UTC(2026, 2, 8, 12, 0, 0));
    const now = new Date(Date.UTC(2026, 2, 9, 12, 0, 0));
    expect(calc(due, now)).toBe(1);
  });

  it("returns negative for future due dates", () => {
    const due = new Date(Date.UTC(2026, 5, 1));
    const now = new Date(Date.UTC(2026, 4, 30));
    expect(calc(due, now)).toBe(-2);
  });

  it("matches expected day count over a 30-day window", () => {
    const due = new Date(Date.UTC(2026, 0, 1, 8, 0, 0));
    const now = new Date(Date.UTC(2026, 0, 31, 1, 0, 0));
    expect(calc(due, now)).toBe(30);
  });
});
