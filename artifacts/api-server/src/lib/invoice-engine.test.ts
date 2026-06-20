import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  buildInvoiceLinesForTicket,
  defaultIncomeCategoryForLineType,
  resolveIncomeCategory,
  totalLines,
  type EngineTicketContext,
} from "./invoice-engine";

const VENDOR = {
  id: 3,
  name: "Winchester",
  dailyOtHours: "8",
  weeklyOtHours: "40",
};
const PARTNER = { id: 19, name: "Mach Resources" };
const SITE_TX = { id: 50, name: "Pad A", state: "TX" };
const SITE_NM = { id: 60, name: "Pad B", state: "NM" };
const TX_RATE = { state: "TX", rate: "0.0625" };

const DEFAULT_BILLING = {
  cadence: "per_ticket" as const,
  paymentTermsDays: 30,
  remitToAddress: null,
  remitToName: null,
  mileageAutoSuggest: false,
  mileageRate: null,
  overtimeMultiplier: "1.50",
  lateFeeRule: null,
  incomeCategoryOverrides: null,
};

function makeCtx(overrides: Partial<EngineTicketContext> = {}): EngineTicketContext {
  return {
    ticketId: 100,
    approvedAt: new Date("2026-04-25T18:00:00Z"),
    afe: "AFE-2026-001",
    workTypeName: "Wireline",
    workTypeCategory: "operations",
    workTypeTaxTreatment: null,
    vendorWorkTypeTaxTreatment: null,
    partnerWorkTypeTaxTreatment: null,
    effectiveTaxTreatment: "exempt_labor",
    vendor: VENDOR,
    site: SITE_TX,
    partner: PARTNER,
    taxRate: TX_RATE,
    taxJurisdiction: null,
    billing: DEFAULT_BILLING,
    checkIns: [],
    assignmentRates: [],
    lineItems: [],
    totalGpsMiles: null,
    ...overrides,
  };
}

describe("invoice-engine", () => {
  it("taxes equipment at combined situs rate while TX crew labor stays exempt", () => {
    const ctx = makeCtx({
      taxJurisdiction: {
        state: "TX",
        postalCode: "79701",
        jurisdictionLabel: "Midland (8.25%)",
        stateTaxRate: "0.0625",
        localTaxRate: "0.0200",
        combinedTaxRate: "0.0825",
        laborTaxRate: "0.0625",
        merchandiseTaxRate: "0.0825",
      },
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T13:00:00Z"),
          checkOutAt: new Date("2026-04-20T21:00:00Z"),
          hourlyRateAtTime: "100.00",
        },
      ],
      lineItems: [
        {
          id: 10,
          ticketId: 100,
          type: "equipment",
          description: "Tool rental",
          quantity: "1",
          unitPrice: "200.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const labor = lines.find((l) => l.lineType === "labor_regular");
    const equip = lines.find((l) => l.lineType === "equipment");
    expect(labor?.taxable).toBe(false);
    expect(labor?.taxAmount).toBe("0.00");
    expect(equip?.taxAmount).toBe("16.50");
  });

  it("emits a regular labor line for a single 8-hour shift, no OT", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T13:00:00Z"),
          checkOutAt: new Date("2026-04-20T21:00:00Z"),
          hourlyRateAtTime: "75.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0].lineType).toBe("labor_regular");
    expect(lines[0].quantity).toBe("8.0000");
    expect(lines[0].unitPrice).toBe("75.0000");
    expect(lines[0].amount).toBe("600.00");
    expect(lines[0].taxable).toBe(false);
    expect(lines[0].taxState).toBe(null);
    expect(lines[0].taxAmount).toBe("0.00");
    expect(lines[0].afe).toBe("AFE-2026-001");
  });

  it("splits a 12-hour single-day shift into 8h regular + 4h OT", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T08:00:00Z"),
          checkOutAt: new Date("2026-04-20T20:00:00Z"),
          hourlyRateAtTime: "100.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    expect(lines).toHaveLength(2);
    const reg = lines.find((l) => l.lineType === "labor_regular")!;
    const ot = lines.find((l) => l.lineType === "labor_overtime")!;
    expect(reg.quantity).toBe("8.0000");
    expect(reg.amount).toBe("800.00");
    expect(ot.quantity).toBe("4.0000");
    expect(ot.unitPrice).toBe("150.0000"); // 100 * 1.5
    expect(ot.amount).toBe("600.00");
  });

  it("computes weekly OT when an employee crosses 40h with no daily OT", () => {
    // 5 weekday shifts of 9h each = 45h total in the same ISO week. None of
    // these hit the 8h daily threshold by itself? 9 does — so 1h/day daily OT
    // would normally appear. Push daily threshold to 12 to isolate weekly OT.
    const ctx = makeCtx({
      vendor: { ...VENDOR, dailyOtHours: "12", weeklyOtHours: "40" },
      checkIns: [0, 1, 2, 3, 4].map((i) => ({
        id: 100 + i,
        ticketId: 100,
        employeeId: 5,
        employeeName: "Matt",
        // ISO week of 2026-04-20 is Mon-Sun: Apr 20-26.
        checkInAt: new Date(`2026-04-${20 + i}T13:00:00Z`),
        checkOutAt: new Date(`2026-04-${20 + i}T22:00:00Z`),
        hourlyRateAtTime: "50.00",
      })),
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const totalReg = lines
      .filter((l) => l.lineType === "labor_regular")
      .reduce((s, l) => s + Number(l.quantity), 0);
    const totalOt = lines
      .filter((l) => l.lineType === "labor_overtime")
      .reduce((s, l) => s + Number(l.quantity), 0);
    expect(totalReg).toBeCloseTo(40, 4);
    expect(totalOt).toBeCloseTo(5, 4);
  });

  it("handles overnight shift across midnight, splitting hours to correct days", () => {
    const ctx = makeCtx({
      vendor: { ...VENDOR, dailyOtHours: "8", weeklyOtHours: "40" },
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          // 18:00 on 04-20 → 06:00 on 04-21 = 12h total split 6h/6h
          checkInAt: new Date("2026-04-20T18:00:00Z"),
          checkOutAt: new Date("2026-04-21T06:00:00Z"),
          hourlyRateAtTime: "100.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const reg = lines.filter((l) => l.lineType === "labor_regular");
    const ot = lines.filter((l) => l.lineType === "labor_overtime");
    expect(reg).toHaveLength(1);
    expect(ot).toHaveLength(0);
    expect(reg[0].quantity).toBe("12.0000");
  });

  it("uses ticket_assignment_rates when hourlyRateAtTime is null", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T13:00:00Z"),
          checkOutAt: new Date("2026-04-20T17:00:00Z"),
          hourlyRateAtTime: null,
        },
      ],
      assignmentRates: [{ ticketId: 100, employeeId: 5, hourlyRate: "65.00" }],
    });
    const { lines, snapshot } = buildInvoiceLinesForTicket(ctx);
    expect(lines[0].unitPrice).toBe("65.0000");
    expect(snapshot.rateLookups[0].source).toBe("ticket_assignment_rates");
  });

  it("falls back to zero with a 'fallback_zero' source when no rate is found", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: null,
          checkInAt: new Date("2026-04-20T13:00:00Z"),
          checkOutAt: new Date("2026-04-20T17:00:00Z"),
          hourlyRateAtTime: null,
        },
      ],
    });
    const { lines, snapshot } = buildInvoiceLinesForTicket(ctx);
    expect(lines[0].unitPrice).toBe("0.0000");
    expect(snapshot.rateLookups[0].source).toBe("fallback_zero");
  });

  it("computes tax only on taxable lines and uses the site state, not vendor's", () => {
    const ctx = makeCtx({
      site: SITE_NM,
      effectiveTaxTreatment: "taxable_all",
      taxRate: { state: "NM", rate: "0.0813" },
      lineItems: [
        // mileage and per_diem are non-taxable by default
        {
          id: 1,
          ticketId: 100,
          type: "mileage",
          description: "Drive",
          quantity: "100",
          unitPrice: "0.65",
        },
        {
          id: 2,
          ticketId: 100,
          type: "per_diem",
          description: "Per diem",
          quantity: "1",
          unitPrice: "75.00",
        },
        {
          id: 3,
          ticketId: 100,
          type: "materials",
          description: "Pipe fitting",
          quantity: "4",
          unitPrice: "25.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const mileage = lines.find((l) => l.lineType === "mileage")!;
    const perDiem = lines.find((l) => l.lineType === "per_diem")!;
    const materials = lines.find((l) => l.lineType === "materials")!;
    expect(mileage.taxable).toBe(false);
    expect(mileage.taxAmount).toBe("0.00");
    expect(perDiem.taxable).toBe(false);
    expect(materials.taxable).toBe(true);
    expect(materials.taxState).toBe("NM");
    // 4 * 25 * 0.0813 = 8.13
    expect(materials.taxAmount).toBe("8.13");
  });

  it("emits zero tax when the site has no state and no tax rate is provided", () => {
    const ctx = makeCtx({
      site: { ...SITE_TX, state: null },
      taxRate: null,
      lineItems: [
        {
          id: 1,
          ticketId: 100,
          type: "materials",
          description: "Widget",
          quantity: "1",
          unitPrice: "100.00",
        },
      ],
    });
    const { lines, snapshot } = buildInvoiceLinesForTicket(ctx);
    expect(lines[0].taxAmount).toBe("0.00");
    expect(snapshot.taxRateSource).toBe("none");
  });

  it("is deterministic — same input produces the same output (idempotency)", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T08:00:00Z"),
          checkOutAt: new Date("2026-04-20T20:00:00Z"),
          hourlyRateAtTime: "100.00",
        },
      ],
      lineItems: [
        {
          id: 9,
          ticketId: 100,
          type: "materials",
          description: "Gasket",
          quantity: "2",
          unitPrice: "12.50",
        },
      ],
    });
    const a = buildInvoiceLinesForTicket(ctx);
    const b = buildInvoiceLinesForTicket(ctx);
    // Strip the snapshot timestamp before comparing
    const stripT = (s: ReturnType<typeof buildInvoiceLinesForTicket>) => ({
      lines: s.lines,
      snapshot: { ...s.snapshot, capturedAt: "<masked>" },
    });
    expect(stripT(a)).toEqual(stripT(b));
  });

  it("emits an auto-mileage line when enabled, with non-taxable mileage", () => {
    const ctx = makeCtx({
      billing: {
        ...DEFAULT_BILLING,
        mileageAutoSuggest: true,
        mileageRate: "0.6700",
      },
      totalGpsMiles: 42.5,
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const mi = lines.find((l) => l.sourceType === "mileage_auto");
    expect(mi).toBeDefined();
    expect(mi!.quantity).toBe("42.5000");
    expect(mi!.unitPrice).toBe("0.6700");
    // 42.5 * 0.67 = 28.475 → rounded to 28.48
    expect(mi!.amount).toBe("28.48");
    expect(mi!.taxable).toBe(false);
  });

  it("does not double-bill mileage when ticket_line_items already has a mileage line", () => {
    const ctx = makeCtx({
      billing: {
        ...DEFAULT_BILLING,
        mileageAutoSuggest: true,
        mileageRate: "0.65",
      },
      totalGpsMiles: 100,
      lineItems: [
        {
          id: 1,
          ticketId: 100,
          type: "mileage",
          description: "Manual mileage",
          quantity: "120",
          unitPrice: "0.70",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const autoMi = lines.find((l) => l.sourceType === "mileage_auto");
    expect(autoMi).toBeUndefined();
    expect(lines.find((l) => l.sourceType === "ticket_line_item")?.quantity).toBe(
      "120.0000",
    );
  });

  it("totalLines aggregates subtotal/tax/total correctly", () => {
    const totals = totalLines([
      { amount: "100.00", taxAmount: "8.25" },
      { amount: "50.50", taxAmount: "0.00" },
      { amount: "10.00", taxAmount: "0.83" },
    ]);
    expect(totals.subtotal).toBe("160.50");
    expect(totals.taxTotal).toBe("9.08");
    expect(totals.total).toBe("169.58");
  });

  // ── 1099 income_category auto-suggest ─────────────────────────

  it("auto-suggests income_category per lineType using built-in defaults", () => {
    expect(defaultIncomeCategoryForLineType("labor_regular")).toBe("nec");
    expect(defaultIncomeCategoryForLineType("labor_overtime")).toBe("nec");
    expect(defaultIncomeCategoryForLineType("equipment")).toBe("misc_rents");
    expect(defaultIncomeCategoryForLineType("materials")).toBe("nec");
    expect(defaultIncomeCategoryForLineType("mileage")).toBe("none");
    expect(defaultIncomeCategoryForLineType("per_diem")).toBe("none");
    expect(defaultIncomeCategoryForLineType("markup")).toBe("nec");
    expect(defaultIncomeCategoryForLineType("discount")).toBe("none");
    expect(defaultIncomeCategoryForLineType("other")).toBe("nec");
  });

  it("emits the right income_category on labor and equipment lines by default", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T08:00:00Z"),
          checkOutAt: new Date("2026-04-20T20:00:00Z"),
          hourlyRateAtTime: "100.00",
        },
      ],
      lineItems: [
        {
          id: 11,
          ticketId: 100,
          type: "equipment",
          description: "Wireline truck",
          quantity: "1",
          unitPrice: "500.00",
        },
        {
          id: 12,
          ticketId: 100,
          type: "mileage",
          description: "Drive",
          quantity: "100",
          unitPrice: "0.65",
        },
        {
          id: 13,
          ticketId: 100,
          type: "per_diem",
          description: "Per diem",
          quantity: "1",
          unitPrice: "75.00",
        },
        {
          id: 14,
          ticketId: 100,
          type: "discount",
          description: "Promo",
          quantity: "1",
          unitPrice: "-25.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    expect(lines.find((l) => l.lineType === "labor_regular")!.incomeCategory).toBe("nec");
    expect(lines.find((l) => l.lineType === "labor_overtime")!.incomeCategory).toBe("nec");
    expect(lines.find((l) => l.lineType === "equipment")!.incomeCategory).toBe("misc_rents");
    expect(lines.find((l) => l.lineType === "mileage")!.incomeCategory).toBe("none");
    expect(lines.find((l) => l.lineType === "per_diem")!.incomeCategory).toBe("none");
    expect(lines.find((l) => l.lineType === "discount")!.incomeCategory).toBe("none");
  });

  it("per-(vendor,partner) override map wins over the built-in default", () => {
    const ctx = makeCtx({
      billing: {
        ...DEFAULT_BILLING,
        // This vendor's "equipment" charges are reimbursable medical
        // equipment, and their "other" line is a royalty.
        incomeCategoryOverrides: {
          equipment: "misc_medical_health",
          other: "misc_royalties",
        },
      },
      lineItems: [
        {
          id: 1,
          ticketId: 100,
          type: "equipment",
          description: "Oxygen rental",
          quantity: "1",
          unitPrice: "500.00",
        },
        {
          id: 2,
          ticketId: 100,
          type: "weird_custom_type",
          description: "Custom",
          quantity: "1",
          unitPrice: "100.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const eq = lines.find((l) => l.lineType === "equipment")!;
    const other = lines.find((l) => l.lineType === "other")!;
    expect(eq.incomeCategory).toBe("misc_medical_health");
    expect(other.incomeCategory).toBe("misc_royalties");
  });

  it("override map for one lineType does not affect other lineTypes", () => {
    const ctx = makeCtx({
      billing: {
        ...DEFAULT_BILLING,
        incomeCategoryOverrides: { equipment: "misc_medical_health" },
      },
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T13:00:00Z"),
          checkOutAt: new Date("2026-04-20T17:00:00Z"),
          hourlyRateAtTime: "75.00",
        },
      ],
      lineItems: [
        {
          id: 1,
          ticketId: 100,
          type: "materials",
          description: "Pipe",
          quantity: "2",
          unitPrice: "10.00",
        },
      ],
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    expect(lines.find((l) => l.lineType === "labor_regular")!.incomeCategory).toBe("nec");
    expect(lines.find((l) => l.lineType === "materials")!.incomeCategory).toBe("nec");
  });

  it("resolveIncomeCategory ignores corrupt override values and falls back", () => {
    // Simulates a malformed value snuck into the JSONB column by an old
    // client. The engine must defensively ignore it rather than emit an
    // invalid income_category that downstream 1099 reports can't classify.
    const overrides = {
      equipment: "totally_bogus_value" as never,
    };
    expect(resolveIncomeCategory("equipment", overrides)).toBe("misc_rents");
    expect(resolveIncomeCategory("equipment", null)).toBe("misc_rents");
    expect(resolveIncomeCategory("equipment", undefined)).toBe("misc_rents");
    expect(resolveIncomeCategory("labor_regular", { equipment: "misc_rents" })).toBe("nec");
  });

  it("auto-mileage line carries income_category 'none' by default", () => {
    const ctx = makeCtx({
      billing: {
        ...DEFAULT_BILLING,
        mileageAutoSuggest: true,
        mileageRate: "0.6700",
      },
      totalGpsMiles: 10,
    });
    const { lines } = buildInvoiceLinesForTicket(ctx);
    const auto = lines.find((l) => l.sourceType === "mileage_auto")!;
    expect(auto.incomeCategory).toBe("none");
  });

  it("snapshot includes engine version and rate-lookup audit trail", () => {
    const ctx = makeCtx({
      checkIns: [
        {
          id: 1,
          ticketId: 100,
          employeeId: 5,
          employeeName: "Matt",
          checkInAt: new Date("2026-04-20T13:00:00Z"),
          checkOutAt: new Date("2026-04-20T17:00:00Z"),
          hourlyRateAtTime: "75.00",
        },
      ],
    });
    const { snapshot } = buildInvoiceLinesForTicket(ctx);
    expect(snapshot.engineVersion).toBe(ENGINE_VERSION);
    expect(snapshot.rateLookups).toHaveLength(1);
    expect(snapshot.taxRateSource).toBe("tax_rates_table");
  });
});
