import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Coverage for POST /invoices/backfill-1099-categories — the one-shot admin
// endpoint that re-derives income_category on existing draft invoice lines
// using the lineType-aware engine defaults + per-(vendor, partner) overrides.
//
// Like the year-end 1099 suite, this requires a real Postgres with the schema
// pushed; without one, the suite is skipped so unit-test CI still passes.
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

const MARKER = `bf1099-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface SeedIds {
  adminUserId: number;
  vendorOverrideId: number;
  vendorDefaultId: number;
  partnerId: number;
  draftInvoiceOverrideId: number;
  draftInvoiceDefaultId: number;
  sentInvoiceId: number;
  // Specific line ids we assert on by category outcome.
  draftMileageLineId: number;
  draftEquipmentLineId: number;
  draftLaborLineId: number;
  draftEquipmentManualOverrideLineId: number;
  draftEquipmentOverrideMappedLineId: number; // vendorOverride: equipment→nec
  sentMileageLineId: number;
  draftSupplementalRootInvoiceId: number;
  draftSupplementalInvoiceId: number;
  draftSupplementalMileageLineId: number;
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
    vendorPartnerBillingSettingsTable,
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

  const [vendorDefault] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Default Vendor`,
      contactName: "Owner",
      contactEmail: `${MARKER}-default@example.com`,
      billingAddress: "1 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  const [vendorOverride] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-Override Vendor`,
      contactName: "Owner",
      contactEmail: `${MARKER}-override@example.com`,
      billingAddress: "2 Vendor St",
    })
    .returning({ id: vendorsTable.id });

  // Override vendor maps equipment → nec (instead of engine default
  // 'misc_rents'), so we can assert the override path is honored.
  await db.insert(vendorPartnerBillingSettingsTable).values({
    vendorId: vendorOverride.id,
    partnerId: partner.id,
    defaultIncomeCategoryOverrides: { equipment: "nec" },
  });

  // Draft invoice for the default vendor — should pick up engine defaults.
  const [draftInvoiceDefault] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-DRAFT-DEFAULT`,
      vendorId: vendorDefault.id,
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

  // Three "broken" draft lines defaulted to 'nec' across the board (the
  // pre-fix legacy state) plus one manual-override line that must NOT be
  // touched.
  const insertedDraftDefault = await db
    .insert(invoiceLinesTable)
    .values([
      {
        invoiceId: draftInvoiceDefault.id,
        sourceType: "manual",
        lineType: "mileage",
        description: "Mileage",
        quantity: "10.0000",
        unitPrice: "0.6700",
        amount: "6.70",
        incomeCategory: "nec", // wrong; should become 'none'
      },
      {
        invoiceId: draftInvoiceDefault.id,
        sourceType: "manual",
        lineType: "equipment",
        description: "Compressor",
        quantity: "1.0000",
        unitPrice: "500.0000",
        amount: "500.00",
        incomeCategory: "nec", // wrong; should become 'misc_rents'
      },
      {
        invoiceId: draftInvoiceDefault.id,
        sourceType: "manual",
        lineType: "labor_regular",
        description: "Labor",
        quantity: "8.0000",
        unitPrice: "75.0000",
        amount: "600.00",
        incomeCategory: "nec", // already correct; should be SKIPPED
      },
      {
        invoiceId: draftInvoiceDefault.id,
        sourceType: "manual",
        lineType: "equipment",
        description: "Manually set to nec",
        quantity: "1.0000",
        unitPrice: "100.0000",
        amount: "100.00",
        incomeCategory: "nec", // user override; must NOT be touched
        isManualOverride: true,
      },
    ])
    .returning({
      id: invoiceLinesTable.id,
      lineType: invoiceLinesTable.lineType,
      isManualOverride: invoiceLinesTable.isManualOverride,
    });

  const draftMileageLineId = insertedDraftDefault.find(
    (l) => l.lineType === "mileage",
  )!.id;
  const draftEquipmentLineId = insertedDraftDefault.find(
    (l) => l.lineType === "equipment" && !l.isManualOverride,
  )!.id;
  const draftLaborLineId = insertedDraftDefault.find(
    (l) => l.lineType === "labor_regular",
  )!.id;
  const draftEquipmentManualOverrideLineId = insertedDraftDefault.find(
    (l) => l.lineType === "equipment" && l.isManualOverride,
  )!.id;

  // Draft invoice for the override vendor — equipment maps to 'nec' here,
  // not the engine default 'misc_rents'.
  const [draftInvoiceOverride] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-DRAFT-OVERRIDE`,
      vendorId: vendorOverride.id,
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

  const insertedDraftOverride = await db
    .insert(invoiceLinesTable)
    .values([
      {
        invoiceId: draftInvoiceOverride.id,
        sourceType: "manual",
        lineType: "equipment",
        description: "Compressor (override vendor)",
        quantity: "1.0000",
        unitPrice: "500.0000",
        amount: "500.00",
        // Engine default 'misc_rents' would be wrong; the override's 'nec'
        // is what the resolver should pick. Currently 'misc_rents', so
        // backfill should change it to 'nec'.
        incomeCategory: "misc_rents",
      },
    ])
    .returning({ id: invoiceLinesTable.id });
  const draftEquipmentOverrideMappedLineId = insertedDraftOverride[0].id;

  // Sent invoice — its lines must NOT be touched even if misclassified.
  const [sentInvoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-SENT`,
      vendorId: vendorDefault.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "sent",
      periodStart: new Date(Date.UTC(2026, 5, 1)),
      periodEnd: new Date(Date.UTC(2026, 5, 30)),
      subtotal: "100.00",
      taxTotal: "0.00",
      total: "100.00",
      sentAt: new Date(Date.UTC(2026, 5, 30)),
    })
    .returning({ id: invoicesTable.id });

  const insertedSent = await db
    .insert(invoiceLinesTable)
    .values({
      invoiceId: sentInvoice.id,
      sourceType: "manual",
      lineType: "mileage",
      description: "Mileage on sent invoice",
      quantity: "10.0000",
      unitPrice: "10.0000",
      amount: "100.00",
      incomeCategory: "nec", // wrong, but immutable post-send
    })
    .returning({ id: invoiceLinesTable.id });
  const sentMileageLineId = insertedSent[0].id;

  // Supplemental invoice — even though its status is 'draft', it amends an
  // already-sent root invoice and its lines must NOT be touched by the
  // backfill. We seed both the root and the supplemental so the FK is real.
  const [supplementalRoot] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-SUPP-ROOT`,
      vendorId: vendorDefault.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "sent",
      periodStart: new Date(Date.UTC(2026, 5, 1)),
      periodEnd: new Date(Date.UTC(2026, 5, 30)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
      sentAt: new Date(Date.UTC(2026, 5, 30)),
    })
    .returning({ id: invoicesTable.id });

  const [supplemental] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: `${MARKER}-SUPP-DRAFT`,
      vendorId: vendorDefault.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      supplementalOfInvoiceId: supplementalRoot.id,
      periodStart: new Date(Date.UTC(2026, 6, 1)),
      periodEnd: new Date(Date.UTC(2026, 6, 30)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    })
    .returning({ id: invoicesTable.id });

  const insertedSupplemental = await db
    .insert(invoiceLinesTable)
    .values({
      invoiceId: supplemental.id,
      sourceType: "manual",
      lineType: "mileage",
      description: "Mileage on draft supplemental",
      quantity: "10.0000",
      unitPrice: "0.6700",
      amount: "6.70",
      incomeCategory: "nec", // wrong; would normally be re-derived to 'none'
    })
    .returning({ id: invoiceLinesTable.id });
  const draftSupplementalMileageLineId = insertedSupplemental[0].id;

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
    vendorOverrideId: vendorOverride.id,
    vendorDefaultId: vendorDefault.id,
    partnerId: partner.id,
    draftInvoiceOverrideId: draftInvoiceOverride.id,
    draftInvoiceDefaultId: draftInvoiceDefault.id,
    sentInvoiceId: sentInvoice.id,
    draftMileageLineId,
    draftEquipmentLineId,
    draftLaborLineId,
    draftEquipmentManualOverrideLineId,
    draftEquipmentOverrideMappedLineId,
    sentMileageLineId,
    draftSupplementalRootInvoiceId: supplementalRoot.id,
    draftSupplementalInvoiceId: supplemental.id,
    draftSupplementalMileageLineId,
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
    sql`delete from vendor_partner_billing_settings where vendor_id in (select id from vendors where name like ${MARKER + "-%"})`,
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

describe.runIf(haveRealDb)("POST /invoices/backfill-1099-categories", () => {
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

  it("rejects non-admin callers", async () => {
    const res = await request(app)
      .post("/invoices/backfill-1099-categories")
      .set("Cookie", vendorCookie(seeded!.adminUserId, seeded!.vendorDefaultId));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.admin_only");
  });

  it("rejects unauthenticated callers", async () => {
    const res = await request(app).post(
      "/invoices/backfill-1099-categories",
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.not_authenticated");
  });

  it(
    "rewrites engine-owned draft lines, honors overrides, and leaves sent + manual rows alone",
    async () => {
      const { db, invoiceLinesTable, invoiceLineCategoryBackfillAuditLogTable } =
        dbModule;
      const res = await request(app)
        .post("/invoices/backfill-1099-categories")
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      expect(res.body.ok).toBe(true);
      // Each invocation returns a fresh runId so the admin UI can deep-
      // link into the per-run detail view immediately.
      expect(res.body.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // The per-line audit log captures every line the run actually
      // mutated. Since other dev-DB rows could interleave with our
      // seeded data, scope the assertion by runId.
      const auditRows = await db
        .select()
        .from(invoiceLineCategoryBackfillAuditLogTable)
        .where(sql`run_id = ${res.body.runId}`);
      const auditByLineId = new Map(auditRows.map((a) => [a.lineId, a]));

      const mileageAudit = auditByLineId.get(seeded!.draftMileageLineId);
      expect(mileageAudit).toBeDefined();
      expect(mileageAudit!.oldIncomeCategory).toBe("nec");
      expect(mileageAudit!.newIncomeCategory).toBe("none");
      expect(mileageAudit!.invoiceId).toBe(seeded!.draftInvoiceDefaultId);
      expect(mileageAudit!.vendorId).toBe(seeded!.vendorDefaultId);
      expect(mileageAudit!.partnerId).toBe(seeded!.partnerId);
      expect(mileageAudit!.actorUserId).toBe(seeded!.adminUserId);
      expect(mileageAudit!.actorRole).toBe("admin");

      const equipmentAudit = auditByLineId.get(seeded!.draftEquipmentLineId);
      expect(equipmentAudit).toBeDefined();
      expect(equipmentAudit!.oldIncomeCategory).toBe("nec");
      expect(equipmentAudit!.newIncomeCategory).toBe("misc_rents");

      const overrideEqAudit = auditByLineId.get(
        seeded!.draftEquipmentOverrideMappedLineId,
      );
      expect(overrideEqAudit).toBeDefined();
      expect(overrideEqAudit!.oldIncomeCategory).toBe("misc_rents");
      expect(overrideEqAudit!.newIncomeCategory).toBe("nec");
      expect(overrideEqAudit!.vendorId).toBe(seeded!.vendorOverrideId);

      // Lines that were skipped (already correct, manual override,
      // sent invoice, supplemental) must NOT show up in the audit log.
      expect(auditByLineId.has(seeded!.draftLaborLineId)).toBe(false);
      expect(
        auditByLineId.has(seeded!.draftEquipmentManualOverrideLineId),
      ).toBe(false);
      expect(auditByLineId.has(seeded!.sentMileageLineId)).toBe(false);
      expect(auditByLineId.has(seeded!.draftSupplementalMileageLineId)).toBe(
        false,
      );

      // The draft mileage line should now be 'none'.
      const [mileage] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.draftMileageLineId}`);
      expect(mileage.incomeCategory).toBe("none");
      // Backfill must NOT mark the line as a manual override — a future
      // regenerate should still own this row.
      expect(mileage.isManualOverride).toBe(false);

      // The draft equipment line on the default vendor should now be
      // 'misc_rents' (engine default for equipment).
      const [equipment] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.draftEquipmentLineId}`);
      expect(equipment.incomeCategory).toBe("misc_rents");
      expect(equipment.isManualOverride).toBe(false);

      // The draft labor line was already correct ('nec') — must not change
      // and must not count as updated.
      const [labor] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.draftLaborLineId}`);
      expect(labor.incomeCategory).toBe("nec");
      expect(labor.isManualOverride).toBe(false);

      // The manually-overridden draft equipment line is sacred — its
      // category must remain 'nec' even though the engine default is
      // 'misc_rents'.
      const [manualOverride] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.draftEquipmentManualOverrideLineId}`);
      expect(manualOverride.incomeCategory).toBe("nec");
      expect(manualOverride.isManualOverride).toBe(true);

      // Override-vendor's equipment line: per-(vendor, partner) override
      // says equipment→nec, so resolver returns 'nec' even though the
      // engine default is 'misc_rents'.
      const [overrideEq] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.draftEquipmentOverrideMappedLineId}`);
      expect(overrideEq.incomeCategory).toBe("nec");
      expect(overrideEq.isManualOverride).toBe(false);

      // The SENT invoice's line must remain untouched even though it's
      // mileage that was misclassified as 'nec'. This is the immutability
      // guarantee for already-sent invoices.
      const [sent] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.sentMileageLineId}`);
      expect(sent.incomeCategory).toBe("nec");
      expect(sent.isManualOverride).toBe(false);

      // The DRAFT SUPPLEMENTAL invoice's line must also remain untouched.
      // Even though status='draft' and is_manual_override=false, the line
      // belongs to a supplemental that amends an already-sent root, so the
      // backfill is required to skip it for 1099-reporting integrity.
      const [supplemental] = await db
        .select()
        .from(invoiceLinesTable)
        .where(sql`id = ${seeded!.draftSupplementalMileageLineId}`);
      expect(supplemental.incomeCategory).toBe("nec");
      expect(supplemental.isManualOverride).toBe(false);

      // Per-line-type counts (and the response body shape) reflect what
      // we changed. Filter on the line types this suite seeded; other
      // dev-DB rows shouldn't trip the assertion.
      const counts = res.body.countsByLineType as Record<
        string,
        Record<string, number>
      >;
      expect(counts.mileage?.none).toBeGreaterThanOrEqual(1);
      expect(counts.equipment?.misc_rents).toBeGreaterThanOrEqual(1);
      // Override-mapped equipment → nec must also be counted.
      expect(counts.equipment?.nec).toBeGreaterThanOrEqual(1);
      // Labor that was already correct should NOT appear here at all
      // (or at least not because of *our* labor line).
      //
      // Of the 7 lines this suite seeds, only 4 are eligible candidates
      // for the route's scan (it filters out is_manual_override=true,
      // status != 'draft', and supplemental invoices in the candidate
      // SELECT itself):
      //   • mileage (default vendor)        → updated to 'none'
      //   • equipment (default vendor)      → updated to 'misc_rents'
      //   • labor_regular (default vendor)  → already correct, skipped
      //   • equipment (override vendor)     → updated to 'nec'
      // The manual-override equipment line, the sent invoice's mileage
      // line, and the supplemental draft's mileage line are correctly
      // excluded from `scanned`, so the floor here is 4 — not 5.
      expect(res.body.scanned).toBeGreaterThanOrEqual(4);
      expect(res.body.updated).toBeGreaterThanOrEqual(3);
      expect(res.body.skippedAlreadyCorrect).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it("exposes admin GET /runs and /runs/:runId for the audit log", async () => {
    // The first test in the suite seeded one real run; query the list
    // and verify our run shows up with sensible aggregates.
    const listRes = await request(app)
      .get("/invoices/backfill-1099-categories/runs")
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(listRes, 200);
    expect(Array.isArray(listRes.body.rows)).toBe(true);

    // Find the most recent run our admin user produced. There should
    // be at least one because the previous test ran the backfill.
    const ours = (
      listRes.body.rows as Array<{
        runId: string;
        actorUserId: number | null;
        linesChanged: number;
        invoicesTouched: number;
      }>
    ).find((r) => r.actorUserId === seeded!.adminUserId);
    expect(ours).toBeDefined();
    expect(ours!.linesChanged).toBeGreaterThanOrEqual(3);
    expect(ours!.invoicesTouched).toBeGreaterThanOrEqual(2);

    // Detail view returns the per-line breakdown for that run.
    const detailRes = await request(app)
      .get(`/invoices/backfill-1099-categories/runs/${ours!.runId}`)
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(detailRes, 200);
    expect(detailRes.body.runId).toBe(ours!.runId);
    expect(detailRes.body.total).toBeGreaterThanOrEqual(3);
    const detailRows = detailRes.body.rows as Array<{
      lineId: number | null;
      vendorId: number | null;
      vendorName: string | null;
      partnerId: number | null;
      partnerName: string | null;
      lineType: string;
      oldIncomeCategory: string;
      newIncomeCategory: string;
      invoiceNumber: string | null;
    }>;
    const mileageDetail = detailRows.find(
      (r) => r.lineId === seeded!.draftMileageLineId,
    );
    expect(mileageDetail).toBeDefined();
    expect(mileageDetail!.lineType).toBe("mileage");
    expect(mileageDetail!.oldIncomeCategory).toBe("nec");
    expect(mileageDetail!.newIncomeCategory).toBe("none");
    expect(mileageDetail!.vendorName).toContain(MARKER);
    expect(mileageDetail!.partnerName).toContain(MARKER);
    expect(mileageDetail!.invoiceNumber).toContain(MARKER);

    // Vendor filter narrows the result set — answer the motivating
    // question "which lines were flipped for the override vendor?".
    const filteredRes = await request(app)
      .get(
        `/invoices/backfill-1099-categories/runs/${ours!.runId}?vendorId=${seeded!.vendorOverrideId}`,
      )
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(filteredRes, 200);
    const filteredRows = filteredRes.body.rows as Array<{
      vendorId: number | null;
      lineType: string;
      newIncomeCategory: string;
    }>;
    expect(filteredRows.length).toBeGreaterThanOrEqual(1);
    for (const r of filteredRows) {
      expect(r.vendorId).toBe(seeded!.vendorOverrideId);
    }
  });

  it("blocks non-admin callers from the audit endpoints", async () => {
    const listRes = await request(app)
      .get("/invoices/backfill-1099-categories/runs")
      .set("Cookie", vendorCookie(seeded!.adminUserId, seeded!.vendorDefaultId));
    expect(listRes.status).toBe(403);
    expect(listRes.body.code).toBe("auth.admin_only");
    const detailRes = await request(app)
      .get(
        "/invoices/backfill-1099-categories/runs/00000000-0000-0000-0000-000000000000",
      )
      .set("Cookie", vendorCookie(seeded!.adminUserId, seeded!.vendorDefaultId));
    expect(detailRes.status).toBe(403);
    expect(detailRes.body.code).toBe("auth.admin_only");
  });

  it("is idempotent — a second run produces zero updates for our rows", async () => {
    const res = await request(app)
      .post("/invoices/backfill-1099-categories")
      .set("Cookie", adminCookie(seeded!.adminUserId));
    expectStatus(res, 200);
    // We can't assert updated === 0 absolutely (the dev DB may contain
    // unrelated lines), but our specific lines should not move further.
    const { db, invoiceLinesTable } = dbModule;
    const [mileage] = await db
      .select()
      .from(invoiceLinesTable)
      .where(sql`id = ${seeded!.draftMileageLineId}`);
    expect(mileage.incomeCategory).toBe("none");
    const [overrideEq] = await db
      .select()
      .from(invoiceLinesTable)
      .where(sql`id = ${seeded!.draftEquipmentOverrideMappedLineId}`);
    expect(overrideEq.incomeCategory).toBe("nec");
  });
});
