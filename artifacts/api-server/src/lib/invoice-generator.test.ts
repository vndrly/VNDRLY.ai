// End-to-end coverage for `generateInvoiceForTicket` against a real DB,
// focused on the 1099 income_category column.
//
// The pure-engine tests in `invoice-engine.test.ts` cover the default
// per-line-type mapping and the per-(vendor, partner) override map, but
// they never touch invoice_lines rows. This suite seeds a ticket plus a
// vendor_partner_billing_settings row with an override map, runs the
// orchestrator, and asserts that:
//
//   1. each freshly-emitted invoice_lines row carries the correct
//      `income_category` (default for labor/mileage, override for equipment);
//   2. a regenerate that wipes non-manual lines and re-emits them does NOT
//      clobber a row whose `is_manual_override=true` carries a user-picked
//      `income_category` that disagrees with both the default and the
//      override map.
//
// Skips with a no-op describe when DATABASE_URL is unavailable so CI can
// still run the rest of the unit suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { and, eq } from "drizzle-orm";

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
const MARKER = `inv-gen-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "generateInvoiceForTicket — income_category persistence",
  () => {
    let generateInvoiceForTicket: typeof import("./invoice-generator").generateInvoiceForTicket;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");

    let partnerId = 0;
    let vendorId = 0;
    let workTypeId = 0;
    let siteLocationId = 0;
    let ticketId = 0;
    let equipmentLineItemId = 0;
    let mileageLineItemId = 0;
    let invoiceId = 0;

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      ({ generateInvoiceForTicket } = await import("./invoice-generator"));

      const [partner] = await db
        .insert(s.partnersTable)
        .values({
          name: `${MARKER}-Partner`,
          contactName: "Pat Partner",
          contactEmail: `${MARKER}-p@example.com`,
        })
        .returning({ id: s.partnersTable.id });
      partnerId = partner.id;

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

      const [site] = await db
        .insert(s.siteLocationsTable)
        .values({
          partnerId,
          name: `${MARKER}-Site`,
          address: "1 Test Way",
          latitude: 30.0,
          longitude: -97.0,
          state: "TX",
          siteCode: `${MARKER.slice(0, 30)}-SC`,
        })
        .returning({ id: s.siteLocationsTable.id });
      siteLocationId = site.id;

      // Seed billing settings with a per-(vendor, partner) override that
      // makes equipment land in the medical/health box instead of the
      // engine default ("misc_rents"). Materials kept untouched so we can
      // also assert that an unrelated lineType still receives the default
      // ("nec") when an override map is partially populated.
      await db.insert(s.vendorPartnerBillingSettingsTable).values({
        vendorId,
        partnerId,
        cadence: "per_ticket",
        paymentTermsDays: 30,
        defaultIncomeCategoryOverrides: {
          equipment: "misc_medical_health",
        },
      });

      // Approved ticket. approvedAt is the immutable accounting timestamp
      // the generator uses for period resolution.
      const approvedAt = new Date("2026-04-20T18:00:00Z");
      const [ticket] = await db
        .insert(s.ticketsTable)
        .values({
          siteLocationId,
          vendorId,
          workTypeId,
          status: "approved",
          approvedAt,
          checkInTime: new Date("2026-04-20T13:00:00Z"),
          checkOutTime: new Date("2026-04-20T21:00:00Z"),
        })
        .returning({ id: s.ticketsTable.id });
      ticketId = ticket.id;

      // 8h shift @ $75/hr → one labor_regular line, no OT.
      // Use a vendor person so we can satisfy the FK without bringing in
      // an extra schema; a synthetic name is fine for this test.
      const [employee] = await db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId,
          firstName: "Test",
          lastName: "Worker",
          email: `${MARKER}-w@example.com`,
        })
        .returning({ id: s.vendorPeopleTable.id });

      await db.insert(s.ticketCheckInsTable).values({
        ticketId,
        employeeId: employee.id,
        checkInAt: new Date("2026-04-20T13:00:00Z"),
        checkOutAt: new Date("2026-04-20T21:00:00Z"),
        hourlyRateAtTime: "75.00",
      });

      // Two extras: equipment (override → misc_medical_health) and mileage
      // (default → "none"). The equipment line is the one we'll later flip
      // to is_manual_override=true to cover the regen-survives case.
      const [eqLi] = await db
        .insert(s.ticketLineItemsTable)
        .values({
          ticketId,
          type: "equipment",
          description: "Wireline truck",
          quantity: "1",
          unitPrice: "500.00",
        })
        .returning({ id: s.ticketLineItemsTable.id });
      equipmentLineItemId = eqLi.id;

      const [miLi] = await db
        .insert(s.ticketLineItemsTable)
        .values({
          ticketId,
          type: "mileage",
          description: "Drive",
          quantity: "100",
          unitPrice: "0.65",
        })
        .returning({ id: s.ticketLineItemsTable.id });
      mileageLineItemId = miLi.id;
    });

    afterAll(async () => {
      // Cascade order: invoice rows first (FKs cascade from invoices),
      // then ticket rows (cascade from tickets), then settings, then
      // site/work/vendor/partner roots.
      if (invoiceId) {
        await db
          .delete(s.invoicesTable)
          .where(eq(s.invoicesTable.id, invoiceId));
      }
      if (ticketId) {
        await db
          .delete(s.ticketsTable)
          .where(eq(s.ticketsTable.id, ticketId));
      }
      if (vendorId && partnerId) {
        await db
          .delete(s.vendorPartnerBillingSettingsTable)
          .where(
            and(
              eq(s.vendorPartnerBillingSettingsTable.vendorId, vendorId),
              eq(s.vendorPartnerBillingSettingsTable.partnerId, partnerId),
            ),
          );
      }
      if (siteLocationId) {
        await db
          .delete(s.siteLocationsTable)
          .where(eq(s.siteLocationsTable.id, siteLocationId));
      }
      if (workTypeId) {
        await db
          .delete(s.workTypesTable)
          .where(eq(s.workTypesTable.id, workTypeId));
      }
      if (vendorId) {
        // vendor_people FK cascades on vendor delete; no manual cleanup
        // needed for the synthetic worker row.
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, vendorId));
      }
      if (partnerId) {
        await db
          .delete(s.partnersTable)
          .where(eq(s.partnersTable.id, partnerId));
      }
    });

    it("writes the right income_category on each freshly-emitted line", async () => {
      const result = await generateInvoiceForTicket(ticketId);
      expect(result.ok).toBe(true);
      if (!result.ok) return; // narrow

      invoiceId = result.invoiceId;
      expect(result.lineCount).toBeGreaterThan(0);

      const lines = await db
        .select()
        .from(s.invoiceLinesTable)
        .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));

      const labor = lines.find((l) => l.lineType === "labor_regular");
      const equipment = lines.find((l) => l.lineType === "equipment");
      const mileage = lines.find((l) => l.lineType === "mileage");

      expect(labor, "labor line missing").toBeDefined();
      expect(equipment, "equipment line missing").toBeDefined();
      expect(mileage, "mileage line missing").toBeDefined();

      // labor_regular: no override entry → engine default "nec".
      expect(labor!.incomeCategory).toBe("nec");
      // equipment: per-(vendor, partner) override wins over the built-in
      // default of "misc_rents".
      expect(equipment!.incomeCategory).toBe("misc_medical_health");
      // mileage: engine default "none" — the override map doesn't touch it.
      expect(mileage!.incomeCategory).toBe("none");

      // Sanity-check: every generated line carries is_manual_override=false
      // so the next assertion (manual line survives regen) is meaningful.
      for (const l of lines) {
        expect(l.isManualOverride).toBe(false);
      }
    });

    it("re-reads the per-(vendor, partner) override map on every regenerate", async () => {
      // Regression guard: if the orchestrator ever started caching the
      // billing settings row (or the engine started memoizing the resolver
      // by vendor/partner), an admin EDIT to
      // vendor_partner_billing_settings.default_income_category_overrides
      // between two regenerations would silently keep emitting lines with
      // the OLD income_category — misclassifying months of charges as
      // 1099-NEC vs 1099-MISC. This test flips the override AT THE DB
      // LEVEL (no manual-override line involved) and asserts the next
      // regen picks up the new category.
      await db
        .update(s.vendorPartnerBillingSettingsTable)
        .set({
          defaultIncomeCategoryOverrides: {
            equipment: "misc_royalties",
          },
        })
        .where(
          and(
            eq(s.vendorPartnerBillingSettingsTable.vendorId, vendorId),
            eq(s.vendorPartnerBillingSettingsTable.partnerId, partnerId),
          ),
        );

      const result = await generateInvoiceForTicket(ticketId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // per_ticket cadence → same invoice on regenerate.
      expect(result.invoiceId).toBe(invoiceId);

      const linesAfter = await db
        .select()
        .from(s.invoiceLinesTable)
        .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));

      // Exactly one equipment line for this source (no manual override
      // was created — the new category took effect via the engine's
      // override map lookup, not via a row-level user edit).
      const equipmentLines = linesAfter.filter(
        (l) =>
          l.sourceType === "ticket_line_item" &&
          l.sourceId === equipmentLineItemId,
      );
      expect(equipmentLines).toHaveLength(1);
      const equipment = equipmentLines[0];
      expect(equipment.isManualOverride).toBe(false);
      expect(equipment.incomeCategory).toBe("misc_royalties");

      // Sibling lines unaffected: the override map only touches equipment.
      const labor = linesAfter.find((l) => l.lineType === "labor_regular");
      expect(labor).toBeDefined();
      expect(labor!.isManualOverride).toBe(false);
      expect(labor!.incomeCategory).toBe("nec");

      const mileage = linesAfter.find(
        (l) =>
          l.sourceType === "ticket_line_item" &&
          l.sourceId === mileageLineItemId,
      );
      expect(mileage).toBeDefined();
      expect(mileage!.isManualOverride).toBe(false);
      expect(mileage!.incomeCategory).toBe("none");
    });

    it("preserves a manual-override line's user-picked income_category through regeneration", async () => {
      // Flip the equipment line to a user-picked category that disagrees
      // with BOTH the engine default and the per-vendor override map.
      // If regeneration nuked manual rows by (sourceType, sourceId), or
      // the orchestrator re-emitted on top of them, this category would
      // revert to "misc_medical_health" (the override) below.
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
          incomeCategory: "misc_attorney",
        })
        .where(eq(s.invoiceLinesTable.id, equipManualId));

      // Capture the labor line id so we can assert it WAS replaced (i.e.
      // regeneration actually re-emitted non-manual lines, not just
      // no-op'd because nothing was deleted).
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

      const result2 = await generateInvoiceForTicket(ticketId);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      // per_ticket cadence → same invoice on regenerate.
      expect(result2.invoiceId).toBe(invoiceId);

      const linesAfter = await db
        .select()
        .from(s.invoiceLinesTable)
        .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));

      // Manual override survived intact.
      const equipAfter = linesAfter.find((l) => l.id === equipManualId);
      expect(equipAfter, "manual equipment line was deleted").toBeDefined();
      expect(equipAfter!.isManualOverride).toBe(true);
      expect(equipAfter!.incomeCategory).toBe("misc_attorney");

      // No second equipment line was emitted on top of the manual one
      // (orchestrator suppresses generator lines that match a surviving
      // override's (sourceType, sourceId)).
      const equipmentLines = linesAfter.filter(
        (l) =>
          l.sourceType === "ticket_line_item" &&
          l.sourceId === equipmentLineItemId,
      );
      expect(equipmentLines).toHaveLength(1);

      // labor_regular and mileage were re-emitted (new rows, default cats).
      const laborAfter = linesAfter.find((l) => l.lineType === "labor_regular");
      expect(laborAfter).toBeDefined();
      expect(laborAfter!.id).not.toBe(laborOldId);
      expect(laborAfter!.isManualOverride).toBe(false);
      expect(laborAfter!.incomeCategory).toBe("nec");

      const mileageAfter = linesAfter.find(
        (l) =>
          l.sourceType === "ticket_line_item" &&
          l.sourceId === mileageLineItemId,
      );
      expect(mileageAfter).toBeDefined();
      expect(mileageAfter!.isManualOverride).toBe(false);
      expect(mileageAfter!.incomeCategory).toBe("none");
    });
  },
);

describe.skipIf(haveRealDb)(
  "generateInvoiceForTicket — income_category persistence (skipped: no real DB)",
  () => {
    it("is skipped when DATABASE_URL is unavailable", () => {
      expect(true).toBe(true);
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// Cluster-wide concurrency: two parallel approve/regenerate calls must
// produce exactly ONE set of generated lines.
//
// The in-process `inFlightByTicket` map only protects ONE Node process —
// when the API ever runs replicated, two independent processes can each
// enter generateInvoiceForTicket for the same ticket at the same instant.
// We simulate that by firing two Promise.all generations in parallel and
// asserting:
//   1. both calls succeeded and resolved to the SAME invoice id (both
//      callers see the canonical result, not a duplicate);
//   2. no duplicated invoice lines were inserted (each generated source
//      key appears exactly once).
// The Postgres tx-scoped advisory lock keyed by ticketId is what makes
// this hold — strip it and the test should fail with either a duplicate
// invoice number violation, a duplicate-line dedupe violation, or 2× the
// expected line count.
// ──────────────────────────────────────────────────────────────────

const CONC_MARKER = `inv-gen-conc-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "generateInvoiceForTicket — concurrent approve/regenerate is cluster-safe",
  () => {
    let generateInvoiceForTicket: typeof import("./invoice-generator").generateInvoiceForTicket;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");

    let partnerId = 0;
    let vendorId = 0;
    let workTypeId = 0;
    let siteLocationId = 0;
    let ticketId = 0;
    let invoiceId = 0;

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      ({ generateInvoiceForTicket } = await import("./invoice-generator"));

      const [partner] = await db
        .insert(s.partnersTable)
        .values({
          name: `${CONC_MARKER}-Partner`,
          contactName: "Pat Partner",
          contactEmail: `${CONC_MARKER}-p@example.com`,
        })
        .returning({ id: s.partnersTable.id });
      partnerId = partner.id;

      const [vendor] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${CONC_MARKER}-Vendor`,
          contactName: "Vance Vendor",
          contactEmail: `${CONC_MARKER}-v@example.com`,
          dailyOtHours: "8",
          weeklyOtHours: "40",
        })
        .returning({ id: s.vendorsTable.id });
      vendorId = vendor.id;

      const [workType] = await db
        .insert(s.workTypesTable)
        .values({
          name: `${CONC_MARKER}-WT`,
          category: "operations",
        })
        .returning({ id: s.workTypesTable.id });
      workTypeId = workType.id;

      const [site] = await db
        .insert(s.siteLocationsTable)
        .values({
          partnerId,
          name: `${CONC_MARKER}-Site`,
          address: "1 Test Way",
          latitude: 30.0,
          longitude: -97.0,
          state: "TX",
          siteCode: `${CONC_MARKER.slice(0, 30)}-SC`,
        })
        .returning({ id: s.siteLocationsTable.id });
      siteLocationId = site.id;

      await db.insert(s.vendorPartnerBillingSettingsTable).values({
        vendorId,
        partnerId,
        cadence: "per_ticket",
        paymentTermsDays: 30,
      });

      const approvedAt = new Date("2026-04-22T18:00:00Z");
      const [ticket] = await db
        .insert(s.ticketsTable)
        .values({
          siteLocationId,
          vendorId,
          workTypeId,
          status: "approved",
          approvedAt,
          checkInTime: new Date("2026-04-22T13:00:00Z"),
          checkOutTime: new Date("2026-04-22T21:00:00Z"),
        })
        .returning({ id: s.ticketsTable.id });
      ticketId = ticket.id;

      const [employee] = await db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId,
          firstName: "Race",
          lastName: "Worker",
          email: `${CONC_MARKER}-w@example.com`,
        })
        .returning({ id: s.vendorPeopleTable.id });

      // 8h shift @ $75/hr → exactly one labor_regular line, no OT.
      await db.insert(s.ticketCheckInsTable).values({
        ticketId,
        employeeId: employee.id,
        checkInAt: new Date("2026-04-22T13:00:00Z"),
        checkOutAt: new Date("2026-04-22T21:00:00Z"),
        hourlyRateAtTime: "75.00",
      });

      // One equipment line item — gives us a second generated row keyed
      // by (ticket_line_item, eqLi.id) so the dedupe assertions catch
      // duplicates on a non-labor source too.
      await db
        .insert(s.ticketLineItemsTable)
        .values({
          ticketId,
          type: "equipment",
          description: "Pump",
          quantity: "1",
          unitPrice: "250.00",
        })
        .returning({ id: s.ticketLineItemsTable.id });
    });

    afterAll(async () => {
      // Cascade on invoices removes invoice_lines / ticket_links / snapshots.
      // Cascade on tickets removes check-ins / line items / assignment rates.
      if (invoiceId) {
        await db
          .delete(s.invoicesTable)
          .where(eq(s.invoicesTable.id, invoiceId));
      }
      if (ticketId) {
        await db
          .delete(s.ticketsTable)
          .where(eq(s.ticketsTable.id, ticketId));
      }
      if (vendorId && partnerId) {
        await db
          .delete(s.vendorPartnerBillingSettingsTable)
          .where(
            and(
              eq(s.vendorPartnerBillingSettingsTable.vendorId, vendorId),
              eq(s.vendorPartnerBillingSettingsTable.partnerId, partnerId),
            ),
          );
      }
      if (siteLocationId) {
        await db
          .delete(s.siteLocationsTable)
          .where(eq(s.siteLocationsTable.id, siteLocationId));
      }
      if (workTypeId) {
        await db
          .delete(s.workTypesTable)
          .where(eq(s.workTypesTable.id, workTypeId));
      }
      if (vendorId) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, vendorId));
      }
      if (partnerId) {
        await db
          .delete(s.partnersTable)
          .where(eq(s.partnersTable.id, partnerId));
      }
    });

    it("two parallel generations land on one invoice with one set of lines", async () => {
      // Bypass the in-process coalescing map by calling generateInvoiceForTicket
      // directly (instead of runInvoiceGenerationCoalesced). Each call opens
      // its OWN transaction + advisory lock — exactly the situation two
      // separate replicas would create. If the lock didn't serialize them,
      // both would race past resolveTargetInvoice with no draft yet, both
      // would try to INSERT a fresh per_ticket invoice, and either:
      //   - the unique invoice_number index throws (1 caller errors), or
      //   - both succeed and we end up with 2 invoices for 1 ticket, or
      //   - both insert duplicate invoice_lines for the same source keys
      //     (caught by the new generated-dedupe partial unique index).
      const [r1, r2] = await Promise.all([
        generateInvoiceForTicket(ticketId),
        generateInvoiceForTicket(ticketId),
      ]);

      expect(r1.ok, `first call failed: ${(!r1.ok && r1.reason) || ""}`).toBe(true);
      expect(r2.ok, `second call failed: ${(!r2.ok && r2.reason) || ""}`).toBe(true);
      if (!r1.ok || !r2.ok) return;

      // Both callers must converge on the SAME invoice id — that's the
      // "exactly one draft per per_ticket cadence" invariant.
      expect(r2.invoiceId).toBe(r1.invoiceId);
      invoiceId = r1.invoiceId;

      // Exactly one invoice exists for this ticket via the link table.
      const links = await db
        .select()
        .from(s.invoiceTicketLinksTable)
        .where(eq(s.invoiceTicketLinksTable.ticketId, ticketId));
      expect(links).toHaveLength(1);
      expect(links[0].invoiceId).toBe(invoiceId);

      // No duplicate generated lines: each (sourceType, sourceId) for this
      // ticket appears exactly once. Two pre-lock generations would have
      // duplicated check_in_labor + ticket_line_item (equipment) rows.
      const lines = await db
        .select()
        .from(s.invoiceLinesTable)
        .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));
      const sourceCounts = new Map<string, number>();
      for (const l of lines) {
        const key = `${l.sourceType}|${l.sourceId ?? "null"}`;
        sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of sourceCounts) {
        expect(count, `duplicate generated lines for source ${key}`).toBe(1);
      }
      // Sanity: we expected at least the labor_regular + equipment rows.
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// Weekly-cadence multi-ticket invoice: per-ticket isolation of
// income_category on a SHARED invoice.
//
// The per-ticket suite above only proves that one ticket's regen is
// idempotent on its own invoice. Under weekly/monthly cadence multiple
// tickets land on the SAME invoice, and the orchestrator's regen path
// only deletes lines belonging to the CURRENT ticket
// (invoice_lines.ticket_id = $regenTicket). A regression where one
// ticket's regen accidentally clobbered another ticket's income_category
// — or where the wrong (vendor, partner) override map were applied to
// the second ticket — would not be visible at the per_ticket level.
//
// This suite seeds two approved tickets in the same ISO week for the
// same (vendor, partner) under weekly cadence and asserts that:
//   1. both ticket sets of lines share ONE invoice id;
//   2. each ticket's lines carry the right per-lineType income_category
//      (default for labor/mileage, override-map value for equipment);
//   3. regenerating ticket A leaves ticket B's category values untouched
//      (per-ticket isolation on a shared invoice);
//   4. a manual override on ticket A's equipment line survives a
//      regenerate of ticket B (no cross-ticket clobbering of overrides).
// ──────────────────────────────────────────────────────────────────

const WEEKLY_MARKER = `inv-gen-weekly-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "generateInvoiceForTicket — weekly cadence shares one invoice with per-ticket income_category isolation",
  () => {
    let generateInvoiceForTicket: typeof import("./invoice-generator").generateInvoiceForTicket;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");

    let partnerId = 0;
    let vendorId = 0;
    let workTypeId = 0;
    let siteLocationId = 0;
    let ticketAId = 0;
    let ticketBId = 0;
    let equipmentALineItemId = 0;
    let equipmentBLineItemId = 0;
    let mileageBLineItemId = 0;
    let invoiceId = 0;

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      ({ generateInvoiceForTicket } = await import("./invoice-generator"));

      const [partner] = await db
        .insert(s.partnersTable)
        .values({
          name: `${WEEKLY_MARKER}-Partner`,
          contactName: "Pat Partner",
          contactEmail: `${WEEKLY_MARKER}-p@example.com`,
        })
        .returning({ id: s.partnersTable.id });
      partnerId = partner.id;

      const [vendor] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${WEEKLY_MARKER}-Vendor`,
          contactName: "Vance Vendor",
          contactEmail: `${WEEKLY_MARKER}-v@example.com`,
          dailyOtHours: "8",
          weeklyOtHours: "40",
        })
        .returning({ id: s.vendorsTable.id });
      vendorId = vendor.id;

      const [workType] = await db
        .insert(s.workTypesTable)
        .values({
          name: `${WEEKLY_MARKER}-WT`,
          category: "operations",
        })
        .returning({ id: s.workTypesTable.id });
      workTypeId = workType.id;

      const [site] = await db
        .insert(s.siteLocationsTable)
        .values({
          partnerId,
          name: `${WEEKLY_MARKER}-Site`,
          address: "1 Test Way",
          latitude: 30.0,
          longitude: -97.0,
          state: "TX",
          siteCode: `${WEEKLY_MARKER.slice(0, 30)}-SC`,
        })
        .returning({ id: s.siteLocationsTable.id });
      siteLocationId = site.id;

      // Weekly cadence with an equipment override → misc_medical_health.
      // Both tickets resolve through this exact (vendor, partner) row, so
      // both should pick up the override for equipment lines.
      await db.insert(s.vendorPartnerBillingSettingsTable).values({
        vendorId,
        partnerId,
        cadence: "weekly",
        paymentTermsDays: 30,
        defaultIncomeCategoryOverrides: {
          equipment: "misc_medical_health",
        },
      });

      // Two approved tickets in the SAME ISO week (Mon 2026-04-20 to
      // Sun 2026-04-26 UTC). Ticket A on Monday, ticket B on Wednesday.
      const approvedAtA = new Date("2026-04-20T18:00:00Z");
      const approvedAtB = new Date("2026-04-22T18:00:00Z");

      const [ticketA] = await db
        .insert(s.ticketsTable)
        .values({
          siteLocationId,
          vendorId,
          workTypeId,
          status: "approved",
          approvedAt: approvedAtA,
          checkInTime: new Date("2026-04-20T13:00:00Z"),
          checkOutTime: new Date("2026-04-20T21:00:00Z"),
        })
        .returning({ id: s.ticketsTable.id });
      ticketAId = ticketA.id;

      const [ticketB] = await db
        .insert(s.ticketsTable)
        .values({
          siteLocationId,
          vendorId,
          workTypeId,
          status: "approved",
          approvedAt: approvedAtB,
          checkInTime: new Date("2026-04-22T13:00:00Z"),
          checkOutTime: new Date("2026-04-22T21:00:00Z"),
        })
        .returning({ id: s.ticketsTable.id });
      ticketBId = ticketB.id;

      const [employee] = await db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId,
          firstName: "Weekly",
          lastName: "Worker",
          email: `${WEEKLY_MARKER}-w@example.com`,
        })
        .returning({ id: s.vendorPeopleTable.id });

      // Each ticket: 8h shift @ $75/hr → one labor_regular line, no OT.
      await db.insert(s.ticketCheckInsTable).values({
        ticketId: ticketAId,
        employeeId: employee.id,
        checkInAt: new Date("2026-04-20T13:00:00Z"),
        checkOutAt: new Date("2026-04-20T21:00:00Z"),
        hourlyRateAtTime: "75.00",
      });
      await db.insert(s.ticketCheckInsTable).values({
        ticketId: ticketBId,
        employeeId: employee.id,
        checkInAt: new Date("2026-04-22T13:00:00Z"),
        checkOutAt: new Date("2026-04-22T21:00:00Z"),
        hourlyRateAtTime: "75.00",
      });

      // Ticket A: equipment line item — will eventually be flipped to a
      // manual override to cover the cross-ticket override-survives case.
      const [eqA] = await db
        .insert(s.ticketLineItemsTable)
        .values({
          ticketId: ticketAId,
          type: "equipment",
          description: "Wireline truck A",
          quantity: "1",
          unitPrice: "500.00",
        })
        .returning({ id: s.ticketLineItemsTable.id });
      equipmentALineItemId = eqA.id;

      // Ticket B: equipment + mileage so we can prove BOTH the override-map
      // category and the default ("none" for mileage) are applied per-ticket
      // and survive an unrelated regeneration of ticket A.
      const [eqB] = await db
        .insert(s.ticketLineItemsTable)
        .values({
          ticketId: ticketBId,
          type: "equipment",
          description: "Wireline truck B",
          quantity: "1",
          unitPrice: "750.00",
        })
        .returning({ id: s.ticketLineItemsTable.id });
      equipmentBLineItemId = eqB.id;

      const [miB] = await db
        .insert(s.ticketLineItemsTable)
        .values({
          ticketId: ticketBId,
          type: "mileage",
          description: "Drive B",
          quantity: "100",
          unitPrice: "0.65",
        })
        .returning({ id: s.ticketLineItemsTable.id });
      mileageBLineItemId = miB.id;
    });

    afterAll(async () => {
      if (invoiceId) {
        await db
          .delete(s.invoicesTable)
          .where(eq(s.invoicesTable.id, invoiceId));
      }
      if (ticketAId) {
        await db
          .delete(s.ticketsTable)
          .where(eq(s.ticketsTable.id, ticketAId));
      }
      if (ticketBId) {
        await db
          .delete(s.ticketsTable)
          .where(eq(s.ticketsTable.id, ticketBId));
      }
      if (vendorId && partnerId) {
        await db
          .delete(s.vendorPartnerBillingSettingsTable)
          .where(
            and(
              eq(s.vendorPartnerBillingSettingsTable.vendorId, vendorId),
              eq(s.vendorPartnerBillingSettingsTable.partnerId, partnerId),
            ),
          );
      }
      if (siteLocationId) {
        await db
          .delete(s.siteLocationsTable)
          .where(eq(s.siteLocationsTable.id, siteLocationId));
      }
      if (workTypeId) {
        await db
          .delete(s.workTypesTable)
          .where(eq(s.workTypesTable.id, workTypeId));
      }
      if (vendorId) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, vendorId));
      }
      if (partnerId) {
        await db
          .delete(s.partnersTable)
          .where(eq(s.partnersTable.id, partnerId));
      }
    });

    it(
      "shares one invoice across both tickets and applies the right income_category to each ticket's lines",
      async () => {
        const r1 = await generateInvoiceForTicket(ticketAId);
        expect(r1.ok, `ticket A failed: ${(!r1.ok && r1.reason) || ""}`).toBe(
          true,
        );
        if (!r1.ok) return;
        const r2 = await generateInvoiceForTicket(ticketBId);
        expect(r2.ok, `ticket B failed: ${(!r2.ok && r2.reason) || ""}`).toBe(
          true,
        );
        if (!r2.ok) return;

        // Both ticket generations resolved into the SAME weekly invoice
        // because their approvedAt timestamps fall in the same ISO week
        // for the same (vendor, partner).
        expect(r2.invoiceId).toBe(r1.invoiceId);
        invoiceId = r1.invoiceId;

        const links = await db
          .select()
          .from(s.invoiceTicketLinksTable)
          .where(eq(s.invoiceTicketLinksTable.invoiceId, invoiceId));
        expect(links).toHaveLength(2);
        const linkedTicketIds = links.map((l) => l.ticketId).sort();
        expect(linkedTicketIds).toEqual([ticketAId, ticketBId].sort());

        const allLines = await db
          .select()
          .from(s.invoiceLinesTable)
          .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));

        const linesA = allLines.filter((l) => l.ticketId === ticketAId);
        const linesB = allLines.filter((l) => l.ticketId === ticketBId);

        // Ticket A: labor_regular (default "nec") and equipment (override
        // → "misc_medical_health").
        const laborA = linesA.find((l) => l.lineType === "labor_regular");
        const equipmentA = linesA.find(
          (l) =>
            l.sourceType === "ticket_line_item" &&
            l.sourceId === equipmentALineItemId,
        );
        expect(laborA, "ticket A labor line missing").toBeDefined();
        expect(equipmentA, "ticket A equipment line missing").toBeDefined();
        expect(laborA!.incomeCategory).toBe("nec");
        expect(equipmentA!.incomeCategory).toBe("misc_medical_health");

        // Ticket B: labor_regular (default "nec"), equipment (override
        // → "misc_medical_health"), mileage (default "none" — override
        // map doesn't touch it).
        const laborB = linesB.find((l) => l.lineType === "labor_regular");
        const equipmentB = linesB.find(
          (l) =>
            l.sourceType === "ticket_line_item" &&
            l.sourceId === equipmentBLineItemId,
        );
        const mileageB = linesB.find(
          (l) =>
            l.sourceType === "ticket_line_item" &&
            l.sourceId === mileageBLineItemId,
        );
        expect(laborB, "ticket B labor line missing").toBeDefined();
        expect(equipmentB, "ticket B equipment line missing").toBeDefined();
        expect(mileageB, "ticket B mileage line missing").toBeDefined();
        expect(laborB!.incomeCategory).toBe("nec");
        expect(equipmentB!.incomeCategory).toBe("misc_medical_health");
        expect(mileageB!.incomeCategory).toBe("none");
      },
    );

    it(
      "regenerating ticket A does not change ticket B's lines or their income_category",
      async () => {
        // Snapshot ticket B's lines (id + category) so we can prove they
        // are byte-for-byte unchanged after ticket A regenerates. ID
        // equality is the strongest check: the orchestrator should only
        // be deleting/re-inserting rows whose ticket_id = A.
        const before = await db
          .select()
          .from(s.invoiceLinesTable)
          .where(
            and(
              eq(s.invoiceLinesTable.invoiceId, invoiceId),
              eq(s.invoiceLinesTable.ticketId, ticketBId),
            ),
          );
        const beforeById = new Map(
          before.map((l) => [
            l.id,
            { lineType: l.lineType, incomeCategory: l.incomeCategory },
          ]),
        );

        const r = await generateInvoiceForTicket(ticketAId);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.invoiceId).toBe(invoiceId);

        const after = await db
          .select()
          .from(s.invoiceLinesTable)
          .where(
            and(
              eq(s.invoiceLinesTable.invoiceId, invoiceId),
              eq(s.invoiceLinesTable.ticketId, ticketBId),
            ),
          );

        // Same row count and same ids — ticket B's lines were not deleted.
        expect(after).toHaveLength(before.length);
        for (const l of after) {
          const prev = beforeById.get(l.id);
          expect(prev, `ticket B line ${l.id} replaced by regen of A`)
            .toBeDefined();
          expect(l.lineType).toBe(prev!.lineType);
          expect(l.incomeCategory).toBe(prev!.incomeCategory);
        }
      },
    );

    it(
      "a manual income_category override on ticket A survives a regenerate of ticket B",
      async () => {
        // Flip ticket A's equipment line to a user-picked category that
        // disagrees with both the engine default ("misc_rents") and the
        // active override map ("misc_medical_health"). If a regen of
        // ticket B accidentally widened its delete to all lines on the
        // shared invoice — or re-loaded the override map and stomped
        // every equipment line — this category would revert below.
        const [equipABefore] = await db
          .select()
          .from(s.invoiceLinesTable)
          .where(
            and(
              eq(s.invoiceLinesTable.invoiceId, invoiceId),
              eq(s.invoiceLinesTable.ticketId, ticketAId),
              eq(s.invoiceLinesTable.sourceType, "ticket_line_item"),
              eq(s.invoiceLinesTable.sourceId, equipmentALineItemId),
            ),
          );
        expect(equipABefore).toBeDefined();
        const equipManualId = equipABefore.id;

        await db
          .update(s.invoiceLinesTable)
          .set({
            isManualOverride: true,
            incomeCategory: "misc_attorney",
          })
          .where(eq(s.invoiceLinesTable.id, equipManualId));

        // Capture ticket B's labor id so we can confirm regen of B
        // actually re-emitted B's non-manual lines (i.e. the test isn't
        // a no-op because nothing was deleted).
        const [laborBBefore] = await db
          .select()
          .from(s.invoiceLinesTable)
          .where(
            and(
              eq(s.invoiceLinesTable.invoiceId, invoiceId),
              eq(s.invoiceLinesTable.ticketId, ticketBId),
              eq(s.invoiceLinesTable.lineType, "labor_regular"),
            ),
          );
        expect(laborBBefore).toBeDefined();
        const laborBOldId = laborBBefore.id;

        const r = await generateInvoiceForTicket(ticketBId);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.invoiceId).toBe(invoiceId);

        const all = await db
          .select()
          .from(s.invoiceLinesTable)
          .where(eq(s.invoiceLinesTable.invoiceId, invoiceId));

        // Ticket A's manual override row is intact with its user-picked
        // category — regen of B did not touch ticket A's lines at all.
        const equipAAfter = all.find((l) => l.id === equipManualId);
        expect(
          equipAAfter,
          "ticket A manual override line was deleted by regen of B",
        ).toBeDefined();
        expect(equipAAfter!.isManualOverride).toBe(true);
        expect(equipAAfter!.incomeCategory).toBe("misc_attorney");
        expect(equipAAfter!.ticketId).toBe(ticketAId);

        // No duplicate equipment line was inserted on ticket A by the B
        // regen (the per-ticket delete must not have widened to A).
        const equipALines = all.filter(
          (l) =>
            l.ticketId === ticketAId &&
            l.sourceType === "ticket_line_item" &&
            l.sourceId === equipmentALineItemId,
        );
        expect(equipALines).toHaveLength(1);

        // Ticket B's labor row WAS replaced (proves B actually regenerated)
        // and its income_category is still the default "nec".
        const laborBAfter = all.find(
          (l) => l.ticketId === ticketBId && l.lineType === "labor_regular",
        );
        expect(laborBAfter).toBeDefined();
        expect(laborBAfter!.id).not.toBe(laborBOldId);
        expect(laborBAfter!.isManualOverride).toBe(false);
        expect(laborBAfter!.incomeCategory).toBe("nec");

        // Ticket B's equipment line still picks up the override map, and
        // its mileage still uses the default "none".
        const equipBAfter = all.find(
          (l) =>
            l.ticketId === ticketBId &&
            l.sourceType === "ticket_line_item" &&
            l.sourceId === equipmentBLineItemId,
        );
        expect(equipBAfter).toBeDefined();
        expect(equipBAfter!.isManualOverride).toBe(false);
        expect(equipBAfter!.incomeCategory).toBe("misc_medical_health");

        const mileageBAfter = all.find(
          (l) =>
            l.ticketId === ticketBId &&
            l.sourceType === "ticket_line_item" &&
            l.sourceId === mileageBLineItemId,
        );
        expect(mileageBAfter).toBeDefined();
        expect(mileageBAfter!.isManualOverride).toBe(false);
        expect(mileageBAfter!.incomeCategory).toBe("none");
      },
    );
  },
);

describe.skipIf(haveRealDb)(
  "generateInvoiceForTicket — weekly cadence shared invoice (skipped: no real DB)",
  () => {
    it("is skipped when DATABASE_URL is unavailable", () => {
      expect(true).toBe(true);
    });
  },
);
