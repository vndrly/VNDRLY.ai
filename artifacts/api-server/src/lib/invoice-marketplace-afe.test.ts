import { beforeEach, expect, it, vi } from "vitest";

// Replace only persistence. The invoice orchestrator, acceptance snapshot loader,
// engine and persisted invoice-line projection all run unchanged.
const state = vi.hoisted(() => ({
  jobOfferId: 7 as number | null, acceptedAfe: "ACCEPTED-AFE" as string | null,
  assignmentAfe: "ASSIGNMENT-AFE" as string | null, siteAfe: "SITE-AFE",
  lines: [] as Record<string, unknown>[],
}));
vi.mock("@workspace/db", async original => {
  const actual = await original<typeof import("@workspace/db")>();
  const { getTableName } = await import("drizzle-orm");
  const rows = (name: string): unknown[] => {
    switch (name) {
      case "tickets": return [{ id: 5, jobOfferId: state.jobOfferId, vendorId: 2, siteLocationId: 3, workTypeId: 4, status: "approved", approvedAt: new Date("2026-10-18") }];
      case "job_offer_acceptance_snapshots": return [{ terms: { unitPrice: "125", unit: "hour", currency: "USD", billingRules: { dailyOtHours: "8", weeklyOtHours: "40", overtimeMultiplier: "1.5" } }, scope: { afeCode: state.acceptedAfe } }];
      case "site_locations": return [{ id: 3, partnerId: 1, name: "Site", afe: state.siteAfe, state: null }];
      case "vendors": return [{ id: 2, name: "Vendor" }];
      case "partners": return [{ id: 1, name: "Partner" }];
      case "work_types": return [{ id: 4, name: "Gate", category: "operations" }];
      case "site_work_assignments": return [{ afe: state.assignmentAfe }];
      case "ticket_line_items": return [{ id: 8, ticketId: 5, type: "equipment", description: "Equipment", quantity: "1", unitPrice: "25" }];
      case "invoices": return [{ invoices: { id: 9, status: "draft" } }];
      default: return [];
    }
  };
  const database: any = {
    select: () => {
      let table = "";
      const chain: any = { from: (value: any) => { table = getTableName(value); return chain; }, then: (resolve: any, reject: any) => Promise.resolve(rows(table)).then(resolve, reject) };
      for (const key of ["where", "innerJoin", "leftJoin", "orderBy", "limit"]) chain[key] = () => chain;
      return chain;
    },
    execute: async () => ({ rows: [] }),
    transaction: async (run: any) => run(database),
    delete: () => ({ where: async () => { state.lines = []; } }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: (table: any) => ({ values: (value: any) => {
      if (getTableName(table) === "invoice_lines") state.lines = value;
      return { then: (resolve: any) => Promise.resolve().then(resolve), onConflictDoNothing: async () => {} };
    } }),
  };
  return { ...actual, db: database };
});
import { generateInvoiceForTicket } from "./invoice-generator";

beforeEach(() => Object.assign(state, { jobOfferId: 7, acceptedAfe: "ACCEPTED-AFE", assignmentAfe: "ASSIGNMENT-AFE", siteAfe: "SITE-AFE", lines: [] }));

it("persists accepted AFE on invoice lines despite conflicting and later edited assignment/site AFEs", async () => {
  expect(await generateInvoiceForTicket(5)).toMatchObject({ ok: true, lineCount: 1 });
  expect(state.lines[0]?.afe).toBe("ACCEPTED-AFE");
  state.assignmentAfe = "EDITED-ASSIGNMENT";
  state.siteAfe = "EDITED-SITE";
  await generateInvoiceForTicket(5);
  expect(state.lines[0]?.afe).toBe("ACCEPTED-AFE");
});
it("preserves an accepted absent AFE without filling it from mutable defaults", async () => {
  state.acceptedAfe = null;
  await generateInvoiceForTicket(5);
  expect(state.lines[0]?.afe).toBeNull();
});
it("preserves non-marketplace assignment and site fallback behavior", async () => {
  state.jobOfferId = null;
  await generateInvoiceForTicket(5);
  expect(state.lines[0]?.afe).toBe("ASSIGNMENT-AFE");
  state.assignmentAfe = null;
  await generateInvoiceForTicket(5);
  expect(state.lines[0]?.afe).toBe("SITE-AFE");
});
