// Integration coverage for the invoice creation / regeneration / concurrency
// surface. The pure engine in `invoice-engine.test.ts` covers line math, and
// `invoice-generator.test.ts` already covers a few orchestrator-level cases
// (income-category persistence + cluster-safe parallel generations against
// the orchestrator's exported function). What was missing — and is the
// reason this file exists — is REST-level coverage of:
//
//   1. POST /tickets/:id/approve creates exactly one draft invoice via the
//      enqueueInvoiceGenerationForTicket background hook.
//   2. Re-approving the same ticket is a no-op (the `ne(status, "approved")`
//      gate inside the approve handler prevents a second enqueue).
//   3. POST /invoices/:id/regenerate preserves manual-override lines while
//      replacing engine-derived ones.
//   4. Two concurrent POST /tickets/:id/approve calls for the same ticket
//      result in exactly one draft (idempotency via the status guard, and
//      the generator's 23505 retry path is exercised by a separate
//      same-period weekly-cadence concurrency case).
//   5. POST /invoices/:id/regenerate returns 409 with code
//      `invoice.regenerate_target_changed` when the live ticket data shifts
//      between the route's preflight and the generator's inner re-resolution.
//
// Like the sibling integration files in this directory, the suite is gated
// on a real Postgres being reachable via DATABASE_URL — when the unit-only
// CI runs against the placeholder URL written by `src/test/setup.ts`, the
// describe is skipped instead of erroring.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

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

// Mock the invoice-generator module so the target_changed test can stub
// `computeTargetPeriodForTicket` (used by the regenerate route's preflight)
// while leaving every other export — including `generateInvoiceForTicket`
// and the per-process coalescer — running real, against the same real DB.
// vi.fn(actual.fn) wraps the real impl, so unmocked calls behave exactly
// like the unmocked module.
vi.mock("../lib/invoice-generator", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/invoice-generator")
  >("../lib/invoice-generator");
  return {
    ...actual,
    computeTargetPeriodForTicket: vi.fn(actual.computeTargetPeriodForTicket),
  };
});

// All seeded rows carry this marker so cleanup can target only what the
// suite created without touching pre-existing data in the dev DB.
const MARKER = `inv-routes-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin",
  });
}

describe.runIf(haveRealDb)("invoices REST — create / regenerate / concurrency", () => {
  let s: typeof import("@workspace/db");
  let db: typeof import("@workspace/db").db;
  let invoiceGen: typeof import("../lib/invoice-generator");
  let app: express.Express;

  // Shared fixture roots — partner / vendor / work-type / two sites (one per
  // partner, the second only used by the target_changed test) / billing
  // settings + an admin user for cookie auth. Per-test data (tickets,
  // check-ins, line items) is created inside each `it` so tests don't leak
  // into one another and we can keep cleanup scoped to the marker.
  let partnerAId = 0;
  let partnerBId = 0;
  let vendorId = 0;
  let workTypeId = 0;
  let siteAId = 0;
  let siteBId = 0;
  let employeeId = 0;
  let adminUserId = 0;

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
    invoiceGen = await import("../lib/invoice-generator");

    const ticketsRouter = (await import("./tickets")).default;
    const invoicesRouter = (await import("./invoices")).default;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(ticketsRouter);
    app.use(invoicesRouter);
    attachTestErrorMiddleware(app, { logErrors: false });

    const [partnerA] = await db
      .insert(s.partnersTable)
      .values({
        name: `${MARKER}-PartnerA`,
        contactName: "Pat A",
        contactEmail: `${MARKER}-pa@example.com`,
      })
      .returning({ id: s.partnersTable.id });
    partnerAId = partnerA.id;

    const [partnerB] = await db
      .insert(s.partnersTable)
      .values({
        name: `${MARKER}-PartnerB`,
        contactName: "Pat B",
        contactEmail: `${MARKER}-pb@example.com`,
      })
      .returning({ id: s.partnersTable.id });
    partnerBId = partnerB.id;

    const [vendor] = await db
      .insert(s.vendorsTable)
      .values({
        name: `${MARKER}-Vendor`,
        contactName: "Vance Vendor",
        contactEmail: `${MARKER}-v@example.com`,
        dailyOtHours: "8",
        weeklyOtHours: "40",
      })
      .returning({ id: s.vendorsTable.id });
    vendorId = vendor.id;

    const [workType] = await db
      .insert(s.workTypesTable)
      .values({
        name: `${MARKER}-WT`,
        category: "operations",
      })
      .returning({ id: s.workTypesTable.id });
    workTypeId = workType.id;

    const [siteA] = await db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partnerAId,
        name: `${MARKER}-SiteA`,
        address: "1 Test Way",
        latitude: 30.0,
        longitude: -97.0,
        state: "TX",
        siteCode: `${MARKER.slice(0, 28)}-SA`,
      })
      .returning({ id: s.siteLocationsTable.id });
    siteAId = siteA.id;

    const [siteB] = await db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partnerBId,
        name: `${MARKER}-SiteB`,
        address: "2 Test Way",
        latitude: 31.0,
        longitude: -97.0,
        state: "TX",
        siteCode: `${MARKER.slice(0, 28)}-SB`,
      })
      .returning({ id: s.siteLocationsTable.id });
    siteBId = siteB.id;

    // Per-ticket cadence on partnerA keeps tests 1–4 simple (one invoice
    // per ticket via invoice_ticket_links). PartnerB is intentionally on
    // weekly cadence so the target_changed test can move a ticket from
    // partnerB→partnerA between preflight and write — the cadence change
    // forces resolveTargetInvoice down a different lookup path that lands
    // on a brand-new invoice id, which is what triggers the TOCTOU
    // mismatch the route guards against.
    await db.insert(s.vendorPartnerBillingSettingsTable).values([
      {
        vendorId,
        partnerId: partnerAId,
        cadence: "per_ticket",
        paymentTermsDays: 30,
      },
      {
        vendorId,
        partnerId: partnerBId,
        cadence: "weekly",
        paymentTermsDays: 30,
      },
    ]);

    const [employee] = await db
      .insert(s.vendorPeopleTable)
      .values({
        vendorId,
        firstName: "Test",
        lastName: "Worker",
        email: `${MARKER}-w@example.com`,
      })
      .returning({ id: s.vendorPeopleTable.id });
    employeeId = employee.id;

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
    // Cascade cleanup. invoices cascade to invoice_lines / ticket_links /
    // snapshots; tickets cascade to check-ins / line items / assignment
    // rates / status history. We delete by marker against the few root
    // tables so any stragglers from a half-failed test still get removed.
    await db.execute(
      sql`delete from invoices where vendor_id = ${vendorId}`,
    );
    await db.execute(
      sql`delete from tickets where vendor_id = ${vendorId}`,
    );
    await db.execute(
      sql`delete from vendor_partner_billing_settings where vendor_id = ${vendorId}`,
    );
    await db.execute(
      sql`delete from vendor_people where vendor_id = ${vendorId}`,
    );
    await db.execute(
      sql`delete from site_locations where partner_id in (${partnerAId}, ${partnerBId})`,
    );
    await db.execute(
      sql`delete from work_types where id = ${workTypeId}`,
    );
    await db.execute(
      sql`delete from vendors where id = ${vendorId}`,
    );
    await db.execute(
      sql`delete from partners where id in (${partnerAId}, ${partnerBId})`,
    );
    await db.execute(
      sql`delete from users where id = ${adminUserId}`,
    );
  });

  // Helper: create a fresh ticket on partnerA in `submitted` state with one
  // 8h labor check-in and one equipment line item, ready for an approve
  // call. The approvedAt is left null — the approve handler stamps it on
  // transition.
  async function seedTicket(opts: {
    siteLocationId?: number;
    checkInAt: Date;
    checkOutAt: Date;
  }): Promise<{ ticketId: number; equipmentLineItemId: number }> {
    const [ticket] = await db
      .insert(s.ticketsTable)
      .values({
        siteLocationId: opts.siteLocationId ?? siteAId,
        vendorId,
        workTypeId,
        status: "submitted",
        checkInTime: opts.checkInAt,
        checkOutTime: opts.checkOutAt,
      })
      .returning({ id: s.ticketsTable.id });

    await db.insert(s.ticketCheckInsTable).values({
      ticketId: ticket.id,
      employeeId,
      checkInAt: opts.checkInAt,
      checkOutAt: opts.checkOutAt,
      hourlyRateAtTime: "75.00",
    });

    const [eq] = await db
      .insert(s.ticketLineItemsTable)
      .values({
        ticketId: ticket.id,
        type: "equipment",
        description: "Wireline truck",
        quantity: "1",
        unitPrice: "500.00",
      })
      .returning({ id: s.ticketLineItemsTable.id });

    return { ticketId: ticket.id, equipmentLineItemId: eq.id };
  }

  // Helper: list every invoice that has a ticket_link to this ticket.
  // The invariant for per_ticket cadence is one row total (and one draft).
  async function invoicesForTicket(ticketId: number): Promise<
    (typeof s.invoicesTable.$inferSelect)[]
  > {
    const links = await db
      .select({ invoiceId: s.invoiceTicketLinksTable.invoiceId })
      .from(s.invoiceTicketLinksTable)
      .where(eq(s.invoiceTicketLinksTable.ticketId, ticketId));
    if (links.length === 0) return [];
    return db
      .select()
      .from(s.invoicesTable)
      .where(
        inArray(
          s.invoicesTable.id,
          links.map((l) => l.invoiceId),
        ),
      );
  }

  // ────────────────────────────────────────────────────────────────
  // (a) approve creates exactly one draft invoice
  // ────────────────────────────────────────────────────────────────
  it("POST /tickets/:id/approve creates exactly one draft invoice with the expected lines", async () => {
    const { ticketId } = await seedTicket({
      checkInAt: new Date("2026-05-01T13:00:00Z"),
      checkOutAt: new Date("2026-05-01T21:00:00Z"),
    });

    const res = await request(app)
      .post(`/tickets/${ticketId}/approve`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expectStatus(res, 200);
    expect(res.body.status).toBe("approved");

    // The approve handler enqueues generation in the background. Calling the
    // coalescer here returns the in-flight promise (or, if the background
    // already finished, runs an idempotent regeneration that lands on the
    // same per_ticket invoice). Either way we have a deterministic point at
    // which the invoice exists.
    const result = await invoiceGen.runInvoiceGenerationCoalesced(ticketId);
    expect(result.ok).toBe(true);

    const invoices = await invoicesForTicket(ticketId);
    expect(invoices).toHaveLength(1);
    const invoice = invoices[0];
    expect(invoice.status).toBe("draft");
    expect(invoice.cadence).toBe("per_ticket");
    expect(invoice.vendorId).toBe(vendorId);
    expect(invoice.partnerId).toBe(partnerAId);

    const lines = await db
      .select()
      .from(s.invoiceLinesTable)
      .where(eq(s.invoiceLinesTable.invoiceId, invoice.id));
    // Sanity: one labor_regular row (8h, no OT) plus one equipment row.
    const labor = lines.find((l) => l.lineType === "labor_regular");
    const equipment = lines.find((l) => l.lineType === "equipment");
    expect(labor, "labor_regular line missing").toBeDefined();
    expect(equipment, "equipment line missing").toBeDefined();
    for (const l of lines) {
      expect(l.isManualOverride).toBe(false);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // (b) re-approving the same ticket is a no-op
  // ────────────────────────────────────────────────────────────────
  it("re-approving an already-approved ticket does not create a second invoice", async () => {
    const { ticketId } = await seedTicket({
      checkInAt: new Date("2026-05-02T13:00:00Z"),
      checkOutAt: new Date("2026-05-02T21:00:00Z"),
    });

    // First approve: transitions submitted → approved and enqueues
    // generation. We await the coalesced promise so the invoice is
    // guaranteed to exist before the second call.
    const first = await request(app)
      .post(`/tickets/${ticketId}/approve`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expectStatus(first, 200);
    const firstGen = await invoiceGen.runInvoiceGenerationCoalesced(ticketId);
    expect(firstGen.ok).toBe(true);
    if (!firstGen.ok) return;
    const firstInvoiceId = firstGen.invoiceId;

    // Capture the post-first-approve approvedAt timestamp so we can confirm
    // the second call did NOT overwrite it (the immutable accounting
    // timestamp is what the engine pivots on for period resolution).
    const [ticketAfterFirst] = await db
      .select({ approvedAt: s.ticketsTable.approvedAt })
      .from(s.ticketsTable)
      .where(eq(s.ticketsTable.id, ticketId));
    expect(ticketAfterFirst.approvedAt).not.toBeNull();
    const originalApprovedAt = ticketAfterFirst.approvedAt!.getTime();

    // Capture line ids so we can assert the engine-derived rows did NOT get
    // re-emitted (a second enqueued generation would delete + re-insert
    // every non-manual-override row, replacing their ids).
    const linesBefore = await db
      .select()
      .from(s.invoiceLinesTable)
      .where(eq(s.invoiceLinesTable.invoiceId, firstInvoiceId));
    const idsBefore = new Set(linesBefore.map((l) => l.id));

    // Second approve: handler's `ne(status, "approved")` guard means no row
    // is returned by the UPDATE, so enqueueInvoiceGenerationForTicket is
    // never called. The endpoint still 200s with the current ticket shape.
    const second = await request(app)
      .post(`/tickets/${ticketId}/approve`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expectStatus(second, 200);

    // No second enqueue means no in-flight promise to await; query the DB
    // directly and assert nothing changed.
    const invoices = await invoicesForTicket(ticketId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(firstInvoiceId);

    const [ticketAfterSecond] = await db
      .select({ approvedAt: s.ticketsTable.approvedAt })
      .from(s.ticketsTable)
      .where(eq(s.ticketsTable.id, ticketId));
    expect(ticketAfterSecond.approvedAt!.getTime()).toBe(originalApprovedAt);

    const linesAfter = await db
      .select()
      .from(s.invoiceLinesTable)
      .where(eq(s.invoiceLinesTable.invoiceId, firstInvoiceId));
    const idsAfter = new Set(linesAfter.map((l) => l.id));
    expect(idsAfter.size).toBe(idsBefore.size);
    for (const id of idsBefore) {
      expect(idsAfter.has(id)).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // (d) two concurrent approvals → still one draft
  // ────────────────────────────────────────────────────────────────
  it("two concurrent POST /approve calls for the same ticket result in one draft invoice", async () => {
    const { ticketId } = await seedTicket({
      checkInAt: new Date("2026-05-03T13:00:00Z"),
      checkOutAt: new Date("2026-05-03T21:00:00Z"),
    });

    // Both POSTs see `status='submitted'` initially; the row-level lock on
    // the UPDATE inside the approve handler's transaction serializes them.
    // The second tx, on commit of the first, sees `status='approved'` and
    // its `ne(status, "approved")` filter drops the row — so only one
    // enqueue happens.
    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/tickets/${ticketId}/approve`)
        .set("Cookie", adminCookie(adminUserId))
        .send({}),
      request(app)
        .post(`/tickets/${ticketId}/approve`)
        .set("Cookie", adminCookie(adminUserId))
        .send({}),
    ]);
    expectStatus(r1, 200);
    expectStatus(r2, 200);

    // Drain the in-flight generation if one is still running, then assert
    // exactly one invoice via the link table.
    await invoiceGen.runInvoiceGenerationCoalesced(ticketId);
    const invoices = await invoicesForTicket(ticketId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe("draft");
  });

  // ────────────────────────────────────────────────────────────────
  // (c) regenerate preserves manual-override lines
  // ────────────────────────────────────────────────────────────────
  it("POST /invoices/:id/regenerate preserves manual-override lines while re-emitting engine-derived ones", async () => {
    const { ticketId, equipmentLineItemId } = await seedTicket({
      checkInAt: new Date("2026-05-05T13:00:00Z"),
      checkOutAt: new Date("2026-05-05T21:00:00Z"),
    });

    const approveRes = await request(app)
      .post(`/tickets/${ticketId}/approve`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expectStatus(approveRes, 200);
    const gen = await invoiceGen.runInvoiceGenerationCoalesced(ticketId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const invoiceId = gen.invoiceId;

    // Flip the equipment line to a user-edited row with a different
    // amount + manual-override flag. The orchestrator must NOT clobber
    // this row on regenerate.
    const [equipBefore] = await db
      .select()
      .from(s.invoiceLinesTable)
      .where(
        and(
          eq(s.invoiceLinesTable.invoiceId, invoiceId),
          eq(s.invoiceLinesTable.sourceType, "ticket_line_item"),
          eq(s.invoiceLinesTable.sourceId, equipmentLineItemId),
        ),
      );
    expect(equipBefore).toBeDefined();
    const equipManualId = equipBefore.id;

    await db
      .update(s.invoiceLinesTable)
      .set({
        isManualOverride: true,
        amount: "1234.56",
        unitPrice: "1234.5600",
        description: "User-edited equipment",
        incomeCategory: "misc_attorney",
      })
      .where(eq(s.invoiceLinesTable.id, equipManualId));

    // Capture the labor row id so we can confirm the regenerate actually
    // ran (engine-derived row is replaced, not no-op'd).
    const [laborBefore] = await db
      .select()
      .from(s.invoiceLinesTable)
      .where(
        and(
          eq(s.invoiceLinesTable.invoiceId, invoiceId),
          eq(s.invoiceLinesTable.lineType, "labor_regular"),
        ),
      );
    expect(laborBefore).toBeDefined();
    const laborOldId = laborBefore.id;

    const regen = await request(app)
      .post(`/invoices/${invoiceId}/regenerate`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expectStatus(regen, 200);
    expect(regen.body.invoice.id).toBe(invoiceId);

    const linesAfter = await db
      .select()
      .from(s.invoiceLinesTable)
      .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));

    // Manual override survived intact — same id, same edited values.
    const equipAfter = linesAfter.find((l) => l.id === equipManualId);
    expect(equipAfter, "manual equipment line was deleted").toBeDefined();
    expect(equipAfter!.isManualOverride).toBe(true);
    expect(equipAfter!.amount).toBe("1234.56");
    expect(equipAfter!.description).toBe("User-edited equipment");
    expect(equipAfter!.incomeCategory).toBe("misc_attorney");

    // Generator suppressed its own equipment line for the same source key
    // so we don't double-bill.
    const equipmentRows = linesAfter.filter(
      (l) =>
        l.sourceType === "ticket_line_item" &&
        l.sourceId === equipmentLineItemId,
    );
    expect(equipmentRows).toHaveLength(1);

    // labor_regular was deleted + re-inserted — new id proves the
    // regeneration actually executed against engine-derived rows.
    const laborAfter = linesAfter.find((l) => l.lineType === "labor_regular");
    expect(laborAfter).toBeDefined();
    expect(laborAfter!.id).not.toBe(laborOldId);
    expect(laborAfter!.isManualOverride).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────
  // (e) ticket reassignment between preflight and write → 409
  // ────────────────────────────────────────────────────────────────
  it("POST /invoices/:id/regenerate returns 409 invoice.regenerate_target_changed when live data shifts after the preflight", async () => {
    // Approve a weekly-cadence ticket on partnerB so the resulting invoice
    // is keyed by (vendor, partnerB, weekly, period_start). When we later
    // move this ticket to partnerA's site (per_ticket cadence), the
    // generator's truthful re-resolution lands on a brand-new per_ticket
    // invoice id — that mismatch is what surfaces target_changed.
    const { ticketId } = await seedTicket({
      siteLocationId: siteBId,
      checkInAt: new Date("2026-05-06T13:00:00Z"),
      checkOutAt: new Date("2026-05-06T21:00:00Z"),
    });

    const approveRes = await request(app)
      .post(`/tickets/${ticketId}/approve`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expectStatus(approveRes, 200);
    const gen = await invoiceGen.runInvoiceGenerationCoalesced(ticketId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const invoiceId = gen.invoiceId;

    // Capture the real (vendor, partnerB, weekly, period_start) tuple of
    // the just-created invoice so the preflight mock can lie convincingly.
    const [invoice] = await db
      .select()
      .from(s.invoicesTable)
      .where(eq(s.invoicesTable.id, invoiceId));
    expect(invoice.cadence).toBe("weekly");
    expect(invoice.partnerId).toBe(partnerBId);

    // Mock the route's preflight (computeTargetPeriodForTicket) to return
    // the ORIGINAL partnerB+weekly tuple — so the preflight loop sees no
    // mismatch and proceeds into the write phase. The generator does NOT
    // go through this mocked function: it re-loads the ticket from the
    // database and computes the period itself, which is where the truth
    // catches up.
    vi.mocked(invoiceGen.computeTargetPeriodForTicket).mockResolvedValueOnce({
      ok: true,
      vendorId,
      partnerId: partnerBId,
      cadence: "weekly",
      periodStart: invoice.periodStart as Date,
      periodEnd: invoice.periodEnd as Date,
    });

    // Shift the ticket onto partnerA's site (per_ticket cadence) BEFORE
    // hitting the regenerate endpoint. Inside the route's outer tx, the
    // generator re-reads the ticket → partnerA → resolveTargetInvoice
    // takes the per_ticket branch, finds no existing link for this ticket,
    // INSERTs a fresh partnerA per_ticket invoice, and that id will not
    // match `expectedInvoiceId` (the original partnerB invoice id), so it
    // returns ok:false reason "target_changed:..." which the route maps
    // to a 409 `invoice.regenerate_target_changed`.
    await db
      .update(s.ticketsTable)
      .set({ siteLocationId: siteAId })
      .where(eq(s.ticketsTable.id, ticketId));

    const regen = await request(app)
      .post(`/invoices/${invoiceId}/regenerate`)
      .set("Cookie", adminCookie(adminUserId))
      .send({});
    expect(regen.status).toBe(409);
    expect(regen.body.code).toBe("invoice.regenerate_target_changed");
    expect(Array.isArray(regen.body.tickets)).toBe(true);
    expect(regen.body.tickets[0].ticketId).toBe(ticketId);
    expect(regen.body.tickets[0].reason).toMatch(/^target_changed:/);

    // Atomic regeneration invariant: the failed write rolled back, so no
    // partnerA per_ticket invoice was persisted for this ticket and the
    // original partnerB invoice is unchanged (still draft, still linked).
    const partnerAInvoices = await db
      .select()
      .from(s.invoicesTable)
      .where(
        and(
          eq(s.invoicesTable.vendorId, vendorId),
          eq(s.invoicesTable.partnerId, partnerAId),
          eq(s.invoicesTable.cadence, "per_ticket"),
        ),
      );
    // The other tests in this suite create partnerA per_ticket invoices,
    // so just assert that none of them are linked to THIS ticket.
    if (partnerAInvoices.length > 0) {
      const links = await db
        .select()
        .from(s.invoiceTicketLinksTable)
        .where(
          and(
            eq(s.invoiceTicketLinksTable.ticketId, ticketId),
            inArray(
              s.invoiceTicketLinksTable.invoiceId,
              partnerAInvoices.map((i) => i.id),
            ),
          ),
        );
      expect(links).toHaveLength(0);
    }

    const links = await db
      .select()
      .from(s.invoiceTicketLinksTable)
      .where(eq(s.invoiceTicketLinksTable.ticketId, ticketId));
    expect(links).toHaveLength(1);
    expect(links[0].invoiceId).toBe(invoiceId);
  });
});

describe.skipIf(haveRealDb)(
  "invoices REST — create / regenerate / concurrency (skipped: no real DB)",
  () => {
    it("is skipped when DATABASE_URL is unavailable", () => {
      expect(true).toBe(true);
    });
  },
);
