import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkComplianceFloor } from "./vendor-tier";

// Test rows mutated per-case and consulted by the chained DB mock below.
let relRow: { status: string } | null = null;
let workTypeAnyRow: { id: number } | null = null;
let workTypeForVendorRow: { id: number } | null = null;
let vendorRow: any | null = null;
// Task #849 — the batched helper reads multi-row sets per table instead
// of a single row. Tests stage these directly; if left unset the chained
// mock falls back to wrapping the single-row vars above.
let relRowsBatch: { vendorId: number; status: string }[] | null = null;
let workTypeRowsBatch: { vendorId: number }[] | null = null;

// drizzle's chained query builder. We track which `.from(table)` was used so
// we can return different rows for the relationship table vs. the
// vendor_work_types table within the same handler. The chain supports both
// the single-row helpers (which terminate in `.where(...).limit(1)` or
// `.where(...)` awaited directly) and the batched helper (which terminates
// in `.from(...).where(...)` awaited directly, with no `.limit()`).
function makeChain(rowsByTable: Record<string, any[]>) {
  let table: string | null = null;
  const chain: any = {
    from: (t: any) => {
      table = t.__name ?? null;
      return chain;
    },
    where: (_w: any) => {
      const next: any = {
        then: (resolve: any) =>
          Promise.resolve(rowsByTable[table ?? ""] ?? []).then(resolve),
        limit: () =>
          Promise.resolve(rowsByTable[table ?? ""] ?? []),
      };
      return next;
    },
  };
  return chain;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      {
        get: (_t, k: string) => {
          if (k === "__name") return name;
          return { __table: name, __col: k };
        },
      },
    );
  const rowsByTable = () => ({
    partner_vendor_relationships:
      relRowsBatch ?? (relRow ? [relRow] : []),
    // Both the "any work type for vendor" probe in getVendorTier and the
    // "specific work type for vendor" probe in isDirectAwardEligible
    // hit the same table; tests target one helper at a time so we
    // resolve them via the same key. The batched helper stages
    // workTypeRowsBatch directly.
    vendor_work_types:
      workTypeRowsBatch ??
      (workTypeAnyRow
        ? [workTypeAnyRow]
        : workTypeForVendorRow
          ? [workTypeForVendorRow]
          : []),
    vendors: vendorRow ? [vendorRow] : [],
  });
  const db: any = {
    select: () => makeChain(rowsByTable()),
    // The batched helper uses selectDistinct for the work-types side.
    selectDistinct: () => makeChain(rowsByTable()),
  };
  return {
    db,
    partnerVendorRelationshipsTable: tableTag("partner_vendor_relationships"),
    vendorWorkTypesTable: tableTag("vendor_work_types"),
    vendorsTable: tableTag("vendors"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

beforeEach(() => {
  relRow = null;
  workTypeAnyRow = null;
  workTypeForVendorRow = null;
  vendorRow = null;
  relRowsBatch = null;
  workTypeRowsBatch = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getVendorTier", () => {
  // We import inside each test so the @workspace/db mock above is in place
  // by the time the helper resolves its imports.
  it("returns 'approved' when partner_vendor_relationships row exists with status approved", async () => {
    relRow = { status: "approved" };
    const { getVendorTier } = await import("./vendor-tier");
    expect(await getVendorTier(1, 2)).toBe("approved");
  });

  it("returns 'approved' when relationship status is preferred", async () => {
    relRow = { status: "preferred" };
    const { getVendorTier } = await import("./vendor-tier");
    expect(await getVendorTier(1, 2)).toBe("approved");
  });

  it("returns 'unapproved' when no relationship row but vendor has work types", async () => {
    relRow = null;
    workTypeAnyRow = { id: 99 };
    const { getVendorTier } = await import("./vendor-tier");
    expect(await getVendorTier(1, 2)).toBe("unapproved");
  });

  it("returns 'pre_onboarded' when no relationship row and no work types", async () => {
    relRow = null;
    workTypeAnyRow = null;
    const { getVendorTier } = await import("./vendor-tier");
    expect(await getVendorTier(1, 2)).toBe("pre_onboarded");
  });

  it("ignores non-approved relationship statuses (treats as unapproved when work types exist)", async () => {
    // Defensive: schema only allows 'preferred' | 'approved', but if some
    // future status (e.g. 'declined') is added we should not treat it as
    // approved.
    relRow = { status: "declined" } as any;
    workTypeAnyRow = { id: 1 };
    const { getVendorTier } = await import("./vendor-tier");
    expect(await getVendorTier(1, 2)).toBe("unapproved");
  });
});

describe("getVendorTiersBatch", () => {
  // Task #849 — the Direct Award candidates endpoint used to call
  // `getVendorTier` once per vendor in a sequential `await` loop, which
  // burned ~2N round-trips for partners with many in-radius vendors.
  // The batched helper does the same work with two queries total and
  // returns a `Map<vendorId, tier>` the route reads in memory.

  it("returns an empty map for an empty input array (skips all DB work)", async () => {
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([], 2);
    expect(m.size).toBe(0);
  });

  it("filters out non-positive / non-finite ids before querying", async () => {
    // Defensive: if a caller hands us a Number(undefined) or a stale 0,
    // we should not include them in the IN-list (or in the result map).
    relRowsBatch = [];
    workTypeRowsBatch = [];
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([0, -1, NaN, 5], 2);
    expect([...m.keys()]).toEqual([5]);
    expect(m.get(5)).toBe("pre_onboarded");
  });

  it("dedupes repeated ids and returns one entry per unique vendor", async () => {
    relRowsBatch = [];
    workTypeRowsBatch = [{ vendorId: 5 }];
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([5, 5, 5], 2);
    expect(m.size).toBe(1);
    expect(m.get(5)).toBe("unapproved");
  });

  it("classifies each vendor by the same rules as getVendorTier", async () => {
    // vendor 1 → approved (preferred status overrides everything)
    // vendor 2 → approved (approved status, also has work types)
    // vendor 3 → unapproved (no rel row, has work types)
    // vendor 4 → pre_onboarded (no rel row, no work types)
    // vendor 5 → unapproved (declined rel row should NOT count as approved)
    relRowsBatch = [
      { vendorId: 1, status: "preferred" },
      { vendorId: 2, status: "approved" },
      { vendorId: 5, status: "declined" },
    ];
    workTypeRowsBatch = [
      { vendorId: 2 },
      { vendorId: 3 },
      { vendorId: 5 },
    ];
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([1, 2, 3, 4, 5], 99);
    expect(m.get(1)).toBe("approved");
    expect(m.get(2)).toBe("approved");
    expect(m.get(3)).toBe("unapproved");
    expect(m.get(4)).toBe("pre_onboarded");
    expect(m.get(5)).toBe("unapproved");
  });

  it("seeds every requested id at pre_onboarded even when no rows come back", async () => {
    // Contract: callers can `map.get(id) ?? 'pre_onboarded'` defensively,
    // but the map should already contain the id so the default is unused.
    relRowsBatch = [];
    workTypeRowsBatch = [];
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([10, 11, 12], 2);
    expect(m.size).toBe(3);
    expect(m.get(10)).toBe("pre_onboarded");
    expect(m.get(11)).toBe("pre_onboarded");
    expect(m.get(12)).toBe("pre_onboarded");
  });

  it("ignores rows for vendors not in the input set (defensive)", async () => {
    // If the relationship table somehow returns a row for a vendor we
    // didn't ask about (shouldn't happen given the WHERE clause, but
    // we guard against it), it must not pollute the returned map.
    relRowsBatch = [{ vendorId: 999, status: "approved" }];
    workTypeRowsBatch = [{ vendorId: 999 }];
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([1, 2], 2);
    expect(m.has(999)).toBe(false);
    expect(m.get(1)).toBe("pre_onboarded");
    expect(m.get(2)).toBe("pre_onboarded");
  });

  it("approved rel row wins over work-types row (matches getVendorTier short-circuit)", async () => {
    // The single-vendor helper checks the relationship FIRST and returns
    // 'approved' regardless of work-type coverage. The batched helper
    // must produce the same result for the same inputs.
    relRowsBatch = [{ vendorId: 7, status: "approved" }];
    workTypeRowsBatch = [{ vendorId: 7 }];
    const { getVendorTiersBatch } = await import("./vendor-tier");
    const m = await getVendorTiersBatch([7], 2);
    expect(m.get(7)).toBe("approved");
  });
});

describe("checkComplianceFloor", () => {
  const today = new Date("2026-04-27T12:00:00Z");

  it("passes when COI url, future expiration, and federal tax id are all present", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r.eligible).toBe(true);
  });

  it("rejects when coiDocumentUrl is missing", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: null,
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r).toMatchObject({
      eligible: false,
      reason: "missing_coi_document",
    });
  });

  it("rejects when coiDocumentUrl is whitespace-only", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "   ",
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r).toMatchObject({
      eligible: false,
      reason: "missing_coi_document",
    });
  });

  it("rejects when insuranceExpirationDate is null", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: null,
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r).toMatchObject({
      eligible: false,
      reason: "missing_insurance_expiration",
    });
  });

  it("rejects when insuranceExpirationDate is unparseable", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "not-a-date",
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r).toMatchObject({
      eligible: false,
      reason: "missing_insurance_expiration",
    });
  });

  it("rejects when insurance expired yesterday", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2026-04-26",
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r).toMatchObject({
      eligible: false,
      reason: "expired_insurance",
    });
  });

  it("accepts when insurance expires today (boundary day is still valid)", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2026-04-27",
        federalTaxId: "12-3456789",
      },
      today,
    );
    expect(r.eligible).toBe(true);
  });

  it("rejects when federalTaxId is missing", () => {
    const r = checkComplianceFloor(
      {
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: null,
      },
      today,
    );
    expect(r).toMatchObject({
      eligible: false,
      reason: "missing_federal_tax_id",
    });
  });

  describe("isDirectAwardEligible (DB-backed)", () => {
    // The Proxy-based @workspace/db mock at the top of this file already
    // routes `select().from(vendorsTable)` to vendorRow and
    // `select().from(vendorWorkTypesTable)` to workTypeForVendorRow, so
    // we just stage rows per-case and exercise the full helper.
    const today = new Date("2026-04-27T12:00:00.000Z");

    it("returns vendor_not_found when the vendor row is missing", async () => {
      vendorRow = null;
      const { isDirectAwardEligible } = await import("./vendor-tier");
      const r = await isDirectAwardEligible(1, 7, { today });
      expect(r).toMatchObject({ eligible: false, reason: "vendor_not_found" });
    });

    it("returns missing_work_type when vendor exists but lacks the matching work type row", async () => {
      vendorRow = {
        id: 1,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: "12-3456789",
      };
      workTypeForVendorRow = null;
      const { isDirectAwardEligible } = await import("./vendor-tier");
      const r = await isDirectAwardEligible(1, 7, { today });
      expect(r).toMatchObject({ eligible: false, reason: "missing_work_type" });
    });

    it("returns expired_insurance when work type matches but COI is past", async () => {
      vendorRow = {
        id: 1,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2026-04-26",
        federalTaxId: "12-3456789",
      };
      workTypeForVendorRow = { id: 999 };
      const { isDirectAwardEligible } = await import("./vendor-tier");
      const r = await isDirectAwardEligible(1, 7, { today });
      expect(r).toMatchObject({ eligible: false, reason: "expired_insurance" });
    });

    it("returns missing_coi_document when vendor has no COI url", async () => {
      vendorRow = {
        id: 1,
        coiDocumentUrl: "",
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: "12-3456789",
      };
      workTypeForVendorRow = { id: 999 };
      const { isDirectAwardEligible } = await import("./vendor-tier");
      const r = await isDirectAwardEligible(1, 7, { today });
      expect(r).toMatchObject({
        eligible: false,
        reason: "missing_coi_document",
      });
    });

    it("returns eligible:true when vendor row, work type, and COI floor all pass", async () => {
      vendorRow = {
        id: 1,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: "2027-01-01",
        federalTaxId: "12-3456789",
      };
      workTypeForVendorRow = { id: 999 };
      const { isDirectAwardEligible } = await import("./vendor-tier");
      const r = await isDirectAwardEligible(1, 7, { today });
      expect(r).toEqual({ eligible: true });
    });
  });

  // Regression — `new Date("YYYY-MM-DD")` is UTC-midnight, but
  // `setHours(0,0,0,0)` is local midnight. On a UTC+offset host the
  // boundary day comparison was off-by-one (insurance "valid until today"
  // would read as expired in the morning UTC). Both sides now use UTC.
  it("evaluates the expiration boundary in UTC, not local time", () => {
    // Pick a "today" that's late evening UTC on Apr 27 — which on a
    // UTC+8 (or further west) host falls on a different local calendar
    // day in either direction. The result must depend only on the UTC
    // calendar day.
    const expDay = "2026-04-27";
    // 23:30 UTC on the same day → still valid.
    const lateUtc = new Date("2026-04-27T23:30:00.000Z");
    expect(
      checkComplianceFloor(
        {
          coiDocumentUrl: "https://example.com/coi.pdf",
          insuranceExpirationDate: expDay,
          federalTaxId: "12-3456789",
        },
        lateUtc,
      ).eligible,
    ).toBe(true);
    // 00:30 UTC the next day → expired.
    const nextUtc = new Date("2026-04-28T00:30:00.000Z");
    expect(
      checkComplianceFloor(
        {
          coiDocumentUrl: "https://example.com/coi.pdf",
          insuranceExpirationDate: expDay,
          federalTaxId: "12-3456789",
        },
        nextUtc,
      ),
    ).toMatchObject({ eligible: false, reason: "expired_insurance" });
  });
});
