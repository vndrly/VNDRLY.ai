import type {
  LateFeeRule,
  InvoiceLineType,
  InvoiceLineIncomeCategory,
  IncomeCategoryOverrideMap,
} from "@workspace/db";
import { INVOICE_LINE_INCOME_CATEGORIES } from "@workspace/db";

// Pure, deterministic invoice generation. No I/O. All money in fixed-precision
// strings to avoid float drift. The orchestrator (invoice-generator.ts) loads
// data from the DB and feeds it to buildInvoiceLinesForTicket, then persists
// the returned lines.
//
// Phase-1 (Rate Cards) was not delivered; rates here come from
// ticket_check_ins.hourly_rate_at_time first, then ticket_assignment_rates as
// fallback, then 0. Materials/equipment/per-diem/etc. come from
// ticket_line_items.
//
// Overtime rules:
//   * dailyOtHours and weeklyOtHours come from the vendor row (numeric strings)
//   * Default 8 daily / 40 weekly when the vendor has no override
//   * Daily OT applies first, weekly OT second; whichever produces more OT wins
//     for any given hour bucket — a worker who pulls 12h on a 60h week gets the
//     correct OT regardless of order
//   * OT lines use overtimeMultiplier (default 1.5) on top of the base rate
//
// Tax:
//   * Tax state = site.state. If null, tax_rate = 0 and tax_state = null
//   * Per-line `taxable` defaults to true for labor, materials, equipment;
//     false for mileage, per-diem, discount; markup mirrors its target.

export type EngineVendor = {
  id: number;
  name: string;
  dailyOtHours: string | null;
  weeklyOtHours: string | null;
};

export type EngineSite = {
  id: number;
  name: string;
  state: string | null;
};

export type EnginePartner = {
  id: number;
  name: string;
};

export type EngineTaxRate = {
  state: string;
  rate: string; // numeric string from tax_rates.rate
};

export type EngineCheckIn = {
  id: number;
  ticketId: number;
  employeeId: number;
  employeeName: string | null;
  checkInAt: Date;
  checkOutAt: Date | null;
  hourlyRateAtTime: string | null;
};

export type EngineAssignmentRate = {
  ticketId: number;
  employeeId: number;
  hourlyRate: string;
};

export type EngineLineItem = {
  id: number;
  ticketId: number;
  type: string; // "equipment" | "materials" | "mileage" | "per_diem" | "markup" | "discount" | "other" | ...
  description: string;
  quantity: string;
  unitPrice: string;
};

export type EngineBillingSettings = {
  cadence: "per_ticket" | "weekly" | "monthly";
  paymentTermsDays: number;
  remitToAddress: string | null;
  remitToName: string | null;
  mileageAutoSuggest: boolean;
  mileageRate: string | null;
  overtimeMultiplier: string; // default "1.50"
  lateFeeRule: LateFeeRule | null;
  // Per-line-type 1099 income_category override map. When a generated line's
  // lineType has an entry here, that category wins over the engine's built-in
  // default. Unknown keys / unknown values are ignored (treated as no
  // override). Manual per-line overrides made in the UI are NOT this — those
  // are persisted with is_manual_override=true and the generator never
  // touches them.
  incomeCategoryOverrides: IncomeCategoryOverrideMap | null;
};

export type EngineTicketContext = {
  ticketId: number;
  approvedAt: Date;
  afe: string | null;
  workTypeName: string | null;
  workTypeCategory: string | null;
  vendor: EngineVendor;
  site: EngineSite;
  partner: EnginePartner;
  taxRate: EngineTaxRate | null; // for site.state, or null when no rate seeded
  billing: EngineBillingSettings;
  checkIns: EngineCheckIn[];
  assignmentRates: EngineAssignmentRate[];
  lineItems: EngineLineItem[];
  totalGpsMiles: number | null; // for mileage_auto_suggest
};

export type EngineLine = {
  ticketId: number;
  sourceType:
    | "check_in_labor"
    | "check_in_overtime"
    | "ticket_line_item"
    | "mileage_auto"
    | "manual";
  sourceId: number | null;
  afe: string | null;
  lineType: InvoiceLineType;
  description: string;
  quantity: string; // numeric string
  unit: string | null;
  unitPrice: string; // numeric string
  amount: string; // numeric string, 2-dp
  taxable: boolean;
  taxState: string | null;
  taxRate: string | null;
  taxAmount: string; // 2-dp
  // 1099 income category. Pre-picked here using lineType-aware defaults
  // (overridable per (vendor, partner) via billing.incomeCategoryOverrides).
  // Persisted to invoice_lines.income_category. Drives 1099-NEC vs
  // 1099-MISC box mapping in the year-end reports. End users can still
  // override per-line in the invoice-detail UI; that persists with
  // is_manual_override=true and survives regeneration.
  incomeCategory: InvoiceLineIncomeCategory;
  sortOrder: number;
};

export type EngineSnapshot = {
  vendorId: number;
  partnerId: number;
  siteId: number;
  siteState: string | null;
  taxRate: string | null;
  taxRateSource: "tax_rates_table" | "none";
  overtimeMultiplier: string;
  dailyOtHours: string;
  weeklyOtHours: string;
  rateLookups: Array<{
    employeeId: number;
    rate: string;
    source: "ticket_check_ins" | "ticket_assignment_rates" | "fallback_zero";
  }>;
  capturedAt: string; // ISO
  engineVersion: string;
};

export type EngineResult = {
  lines: EngineLine[];
  snapshot: EngineSnapshot;
};

// ──────────────────────────────────────────────────────────────────
// Decimal utilities (string-based, banker-free, 4-dp precision)
// ──────────────────────────────────────────────────────────────────

const SCALE = 10000n; // 4 decimal places of internal precision

export function toFixedUnits(s: string | number | null | undefined): bigint {
  if (s == null || s === "") return 0n;
  const str = String(s).trim();
  if (str === "") return 0n;
  const neg = str.startsWith("-");
  const body = neg ? str.slice(1) : str;
  const [intPart, fracPart = ""] = body.split(".");
  const fracPadded = (fracPart + "0000").slice(0, 4);
  const v = BigInt(intPart || "0") * SCALE + BigInt(fracPadded || "0");
  return neg ? -v : v;
}

function unitsToString4(units: bigint): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const intPart = v / SCALE;
  const fracPart = v % SCALE;
  const frac = fracPart.toString().padStart(4, "0");
  return `${neg ? "-" : ""}${intPart.toString()}.${frac}`;
}

export function unitsToString2(units: bigint): string {
  // Round half-away-from-zero to 2 decimal places.
  const neg = units < 0n;
  const v = neg ? -units : units;
  const remainder = v % 100n;
  let rounded = v - remainder;
  if (remainder >= 50n) rounded += 100n;
  const intPart = rounded / SCALE;
  const fracPart = (rounded % SCALE) / 100n;
  return `${neg ? "-" : ""}${intPart.toString()}.${fracPart.toString().padStart(2, "0")}`;
}

export function mulUnits(a: bigint, b: bigint): bigint {
  // (a/SCALE) * (b/SCALE) = (a*b) / (SCALE^2); we want result in same SCALE
  return (a * b) / SCALE;
}

function fixedRound2(s: string): string {
  return unitsToString2(toFixedUnits(s));
}

// ──────────────────────────────────────────────────────────────────
// Rate lookup
// ──────────────────────────────────────────────────────────────────

function lookupHourlyRate(
  ctx: EngineTicketContext,
  checkIn: EngineCheckIn,
): { rate: string; source: "ticket_check_ins" | "ticket_assignment_rates" | "fallback_zero" } {
  if (checkIn.hourlyRateAtTime != null && checkIn.hourlyRateAtTime !== "") {
    return { rate: checkIn.hourlyRateAtTime, source: "ticket_check_ins" };
  }
  const fallback = ctx.assignmentRates.find(
    (r) => r.ticketId === checkIn.ticketId && r.employeeId === checkIn.employeeId,
  );
  if (fallback) {
    return { rate: fallback.hourlyRate, source: "ticket_assignment_rates" };
  }
  return { rate: "0", source: "fallback_zero" };
}

// ──────────────────────────────────────────────────────────────────
// Overtime split
// ──────────────────────────────────────────────────────────────────

type DaySlice = { date: string; hours: bigint; startMs: number }; // hours in SCALE-units; startMs = epoch ms of slice start

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekKey(d: Date): string {
  // ISO week start (Monday). Returns YYYY-Www string.
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - day + 1);
  return x.toISOString().slice(0, 10);
}

// Slice a single shift across day boundaries (UTC). Returns one entry per day
// with the hours worked on that day. Used so OT thresholds (per-day, per-week)
// can be applied accurately even on overnight shifts.
function sliceByDay(start: Date, end: Date): DaySlice[] {
  const slices: DaySlice[] = [];
  let cursor = new Date(start.getTime());
  while (cursor < end) {
    const dayEndUtc = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      ),
    );
    const sliceEnd = dayEndUtc < end ? dayEndUtc : end;
    const ms = sliceEnd.getTime() - cursor.getTime();
    if (ms > 0) {
      const hours = (BigInt(ms) * SCALE) / 3600000n;
      slices.push({ date: dayKey(cursor), hours, startMs: cursor.getTime() });
    }
    cursor = sliceEnd;
  }
  return slices;
}

type EmployeeShift = {
  checkInId: number;
  employeeId: number;
  employeeName: string | null;
  rate: string;
  rateSource: "ticket_check_ins" | "ticket_assignment_rates" | "fallback_zero";
  daySlices: DaySlice[];
};

// Apply daily + weekly OT thresholds. Returns regularHours and overtimeHours,
// in SCALE-units, per shift.
function splitOvertime(
  shifts: EmployeeShift[],
  dailyOtHoursStr: string,
  weeklyOtHoursStr: string,
): Array<{ shift: EmployeeShift; regular: bigint; overtime: bigint }> {
  const dailyThreshold = toFixedUnits(dailyOtHoursStr);
  const weeklyThreshold = toFixedUnits(weeklyOtHoursStr);

  // Per-employee, per-day: cap at dailyThreshold for regular, rest is OT.
  // Then sweep per-employee, per-week: cap regular at weeklyThreshold; any
  // additional hours flip from regular to OT.

  // First pass: per-day OT.
  const perDayRegular = new Map<string, bigint>(); // key: empId|day -> regular hrs
  const perDayOt = new Map<string, bigint>();

  for (const shift of shifts) {
    for (const slice of shift.daySlices) {
      const k = `${shift.employeeId}|${slice.date}`;
      const existing = perDayRegular.get(k) ?? 0n;
      const remainingThreshold = dailyThreshold - existing;
      const regForSlice = slice.hours > remainingThreshold
        ? remainingThreshold > 0n ? remainingThreshold : 0n
        : slice.hours;
      const otForSlice = slice.hours - regForSlice;
      perDayRegular.set(k, existing + regForSlice);
      perDayOt.set(k, (perDayOt.get(k) ?? 0n) + otForSlice);
    }
  }

  // Second pass: per-week OT — accumulate REGULAR hours per week per employee
  // and convert any beyond the weekly threshold from regular to OT.
  const perWeekRegular = new Map<string, bigint>();
  const dayToWeek = new Map<string, string>();

  for (const k of perDayRegular.keys()) {
    const [empId, day] = k.split("|");
    const wk = weekKey(new Date(`${day}T00:00:00Z`));
    const wkKey = `${empId}|${wk}`;
    dayToWeek.set(k, wkKey);
    perWeekRegular.set(wkKey, (perWeekRegular.get(wkKey) ?? 0n) + (perDayRegular.get(k) ?? 0n));
  }

  // Compute the conversion: per week, if regular > threshold, the surplus
  // becomes OT. We distribute the surplus proportionally across that week's
  // days — but for accounting we can just compress to per-shift totals at the
  // end. To keep this deterministic and simple, we recompute per-shift OT
  // by re-walking shifts and flipping the LATEST hours within the week to OT
  // until the surplus is consumed.

  const surplusByWeek = new Map<string, bigint>();
  for (const [wk, total] of perWeekRegular.entries()) {
    if (total > weeklyThreshold) surplusByWeek.set(wk, total - weeklyThreshold);
  }

  // Walk shifts in chronological order; consume surplus from the end (latest
  // hours first) by reverse-walking.
  const perShiftRegular = new Map<number, bigint>();
  const perShiftOt = new Map<number, bigint>();
  for (const s of shifts) {
    perShiftRegular.set(s.checkInId, 0n);
    perShiftOt.set(s.checkInId, 0n);
  }

  // Distribute per-day regular/OT back to shifts: each shift contributes
  // proportionally to its day-slice. Track per (shift, day) regular share.
  type ShiftDayShare = {
    shiftIdx: number;
    employeeId: number;
    dayKey: string;
    weekKey: string;
    startMs: number; // exact slice start, drives reverse-walk ordering
    regular: bigint; // SCALE-units
    ot: bigint;
  };
  const shares: ShiftDayShare[] = [];
  for (let i = 0; i < shifts.length; i++) {
    const shift = shifts[i];
    for (const slice of shift.daySlices) {
      const k = `${shift.employeeId}|${slice.date}`;
      const dayReg = perDayRegular.get(k) ?? 0n;
      const dayOt = perDayOt.get(k) ?? 0n;
      const dayTotal = dayReg + dayOt;
      // Proportional split of this shift's portion of the day.
      let regShare = 0n;
      let otShare = 0n;
      if (dayTotal > 0n) {
        // Find total hours from THIS shift on THIS day:
        // we already have it as slice.hours (since each shift has at most one
        // slice per day in our slicer).
        const portion = slice.hours; // SCALE-units
        // regShare = dayReg * (portion / dayTotal)
        regShare = (dayReg * portion) / dayTotal;
        otShare = (dayOt * portion) / dayTotal;
        // Adjustment to ensure regShare+otShare == portion exactly:
        const sum = regShare + otShare;
        if (sum !== portion) regShare += portion - sum; // absorb rounding into regular
      }
      shares.push({
        shiftIdx: i,
        employeeId: shift.employeeId,
        dayKey: slice.date,
        weekKey: weekKey(new Date(`${slice.date}T00:00:00Z`)),
        startMs: slice.startMs,
        regular: regShare,
        ot: otShare,
      });
    }
  }

  // Now apply weekly surplus: for each (employeeId, weekKey) with surplus, walk
  // its shares in REVERSE chronological order and flip regular→OT until
  // surplus is consumed.
  for (const [wkKey, surplusInit] of surplusByWeek.entries()) {
    let surplus = surplusInit;
    // Reverse chronological order using actual slice start time. This makes
    // the "latest hours of the week become OT" rule deterministic when an
    // employee has multiple shifts on the same day with different rates.
    const matching = shares
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => `${s.employeeId}|${s.weekKey}` === wkKey)
      .sort((a, b) => b.s.startMs - a.s.startMs);
    for (const { idx } of matching) {
      if (surplus <= 0n) break;
      const s = shares[idx];
      const move = surplus > s.regular ? s.regular : surplus;
      s.regular -= move;
      s.ot += move;
      surplus -= move;
    }
  }

  // Aggregate back per shift.
  for (const s of shares) {
    const checkInId = shifts[s.shiftIdx].checkInId;
    perShiftRegular.set(checkInId, (perShiftRegular.get(checkInId) ?? 0n) + s.regular);
    perShiftOt.set(checkInId, (perShiftOt.get(checkInId) ?? 0n) + s.ot);
  }

  return shifts.map((shift) => ({
    shift,
    regular: perShiftRegular.get(shift.checkInId) ?? 0n,
    overtime: perShiftOt.get(shift.checkInId) ?? 0n,
  }));
}

// ──────────────────────────────────────────────────────────────────
// Taxability defaults per line type
// ──────────────────────────────────────────────────────────────────

function defaultTaxableForLineType(lineType: InvoiceLineType): boolean {
  switch (lineType) {
    case "mileage":
    case "per_diem":
    case "discount":
      return false;
    case "labor_regular":
    case "labor_overtime":
    case "equipment":
    case "materials":
    case "markup":
    case "other":
      return true;
  }
}

// Built-in default mapping from invoice line_type → 1099 income_category.
// Source of truth for the auto-suggest behavior. Per-(vendor, partner)
// overrides from billing.incomeCategoryOverrides take precedence — see
// resolveIncomeCategory.
//
// Rationale per line type:
//   labor_regular/labor_overtime  → nec    (1099-NEC Box 1, services)
//   equipment                     → misc_rents (1099-MISC Box 1; covers the
//                                   common case of equipment rentals — users
//                                   whose "equipment" is actually a sale of
//                                   goods can flip the per-vendor override)
//   materials                     → nec    (preserved current behavior — many
//                                   accounting setups still report material
//                                   sales on NEC; users can override)
//   mileage / per_diem            → none   (reimbursements; not 1099 income)
//   markup                        → nec    (treated as a service surcharge)
//   discount                      → none   (negative line; not income)
//   other                         → nec    (safe fallback matching legacy
//                                   default behavior)
export function defaultIncomeCategoryForLineType(
  lineType: InvoiceLineType,
): InvoiceLineIncomeCategory {
  switch (lineType) {
    case "labor_regular":
    case "labor_overtime":
    case "materials":
    case "markup":
    case "other":
      return "nec";
    case "equipment":
      return "misc_rents";
    case "mileage":
    case "per_diem":
    case "discount":
      return "none";
  }
}

// Resolve the income_category for a freshly-emitted line. Override map wins
// when it provides a recognized value; otherwise we fall back to the built-in
// default. Unrecognized values in the override map are ignored so a corrupt
// row in vendor_partner_billing_settings can never poison generation.
export function resolveIncomeCategory(
  lineType: InvoiceLineType,
  overrides: IncomeCategoryOverrideMap | null | undefined,
): InvoiceLineIncomeCategory {
  if (overrides) {
    const candidate = overrides[lineType];
    if (
      candidate &&
      (INVOICE_LINE_INCOME_CATEGORIES as readonly string[]).includes(candidate)
    ) {
      return candidate;
    }
  }
  return defaultIncomeCategoryForLineType(lineType);
}

function classifyLineItemType(t: string): {
  lineType: EngineLine["lineType"];
  defaultUnit: string | null;
} {
  switch (t.toLowerCase()) {
    case "equipment":
      return { lineType: "equipment", defaultUnit: "ea" };
    case "materials":
    case "parts":
      return { lineType: "materials", defaultUnit: "ea" };
    case "mileage":
      return { lineType: "mileage", defaultUnit: "mi" };
    case "per_diem":
    case "perdiem":
      return { lineType: "per_diem", defaultUnit: "day" };
    case "markup":
      return { lineType: "markup", defaultUnit: null };
    case "discount":
      return { lineType: "discount", defaultUnit: null };
    default:
      return { lineType: "other", defaultUnit: null };
  }
}

// ──────────────────────────────────────────────────────────────────
// Public engine
// ──────────────────────────────────────────────────────────────────

export const ENGINE_VERSION = "1.1.0";

export function buildInvoiceLinesForTicket(ctx: EngineTicketContext): EngineResult {
  const lines: EngineLine[] = [];

  const dailyOtStr =
    ctx.vendor.dailyOtHours && Number(ctx.vendor.dailyOtHours) > 0
      ? ctx.vendor.dailyOtHours
      : "8";
  const weeklyOtStr =
    ctx.vendor.weeklyOtHours && Number(ctx.vendor.weeklyOtHours) > 0
      ? ctx.vendor.weeklyOtHours
      : "40";
  const otMultiplier = ctx.billing.overtimeMultiplier || "1.50";
  const incomeOverrides = ctx.billing.incomeCategoryOverrides ?? null;

  const taxRateStr = ctx.taxRate?.rate ?? "0";
  const taxState = ctx.site.state;
  const taxRateUnits = toFixedUnits(taxRateStr);

  const rateLookups: EngineSnapshot["rateLookups"] = [];

  // ── Labor lines from check-ins ────────────────────────────────
  const ticketCheckIns = ctx.checkIns.filter(
    (c) => c.ticketId === ctx.ticketId && c.checkOutAt != null,
  );

  const shifts: EmployeeShift[] = ticketCheckIns.map((ci) => {
    const r = lookupHourlyRate(ctx, ci);
    rateLookups.push({ employeeId: ci.employeeId, rate: r.rate, source: r.source });
    const slices = sliceByDay(ci.checkInAt, ci.checkOutAt!);
    return {
      checkInId: ci.id,
      employeeId: ci.employeeId,
      employeeName: ci.employeeName,
      rate: r.rate,
      rateSource: r.source,
      daySlices: slices,
    };
  });

  const split = splitOvertime(shifts, dailyOtStr, weeklyOtStr);

  let sortIdx = 0;
  for (const { shift, regular, overtime } of split) {
    const rateUnits = toFixedUnits(shift.rate);
    const otRateUnits = mulUnits(rateUnits, toFixedUnits(otMultiplier));
    const labelEmp = shift.employeeName ?? `Employee #${shift.employeeId}`;
    const taxable = defaultTaxableForLineType("labor_regular");

    if (regular > 0n) {
      const amountUnits = mulUnits(regular, rateUnits);
      const taxAmt = taxable ? mulUnits(amountUnits, taxRateUnits) : 0n;
      lines.push({
        ticketId: ctx.ticketId,
        sourceType: "check_in_labor",
        sourceId: shift.checkInId,
        afe: ctx.afe,
        lineType: "labor_regular",
        description: `${labelEmp} — regular labor`,
        quantity: unitsToString4(regular),
        unit: "hr",
        unitPrice: unitsToString4(rateUnits),
        amount: unitsToString2(amountUnits),
        taxable,
        taxState: taxable ? taxState : null,
        taxRate: taxable && taxState ? unitsToString4(taxRateUnits) : null,
        taxAmount: unitsToString2(taxAmt),
        incomeCategory: resolveIncomeCategory("labor_regular", incomeOverrides),
        sortOrder: sortIdx++,
      });
    }
    if (overtime > 0n) {
      const amountUnits = mulUnits(overtime, otRateUnits);
      const otTaxable = defaultTaxableForLineType("labor_overtime");
      const taxAmt = otTaxable ? mulUnits(amountUnits, taxRateUnits) : 0n;
      lines.push({
        ticketId: ctx.ticketId,
        sourceType: "check_in_overtime",
        sourceId: shift.checkInId,
        afe: ctx.afe,
        lineType: "labor_overtime",
        description: `${labelEmp} — overtime (${otMultiplier}x)`,
        quantity: unitsToString4(overtime),
        unit: "hr",
        unitPrice: unitsToString4(otRateUnits),
        amount: unitsToString2(amountUnits),
        taxable: otTaxable,
        taxState: otTaxable ? taxState : null,
        taxRate: otTaxable && taxState ? unitsToString4(taxRateUnits) : null,
        taxAmount: unitsToString2(taxAmt),
        incomeCategory: resolveIncomeCategory("labor_overtime", incomeOverrides),
        sortOrder: sortIdx++,
      });
    }
  }

  // ── Extras from ticket_line_items ─────────────────────────────
  const ticketLineItems = ctx.lineItems.filter((l) => l.ticketId === ctx.ticketId);
  for (const li of ticketLineItems) {
    const cls = classifyLineItemType(li.type);
    const qtyUnits = toFixedUnits(li.quantity);
    const priceUnits = toFixedUnits(li.unitPrice);
    const amountUnits = mulUnits(qtyUnits, priceUnits);
    const taxable = defaultTaxableForLineType(cls.lineType);
    const taxAmt = taxable ? mulUnits(amountUnits, taxRateUnits) : 0n;
    lines.push({
      ticketId: ctx.ticketId,
      sourceType: "ticket_line_item",
      sourceId: li.id,
      afe: ctx.afe,
      lineType: cls.lineType,
      description: li.description || cls.lineType,
      quantity: unitsToString4(qtyUnits),
      unit: cls.defaultUnit,
      unitPrice: unitsToString4(priceUnits),
      amount: unitsToString2(amountUnits),
      taxable,
      taxState: taxable ? taxState : null,
      taxRate: taxable && taxState ? unitsToString4(taxRateUnits) : null,
      taxAmount: unitsToString2(taxAmt),
      incomeCategory: resolveIncomeCategory(cls.lineType, incomeOverrides),
      sortOrder: sortIdx++,
    });
  }

  // ── Mileage auto-suggest ──────────────────────────────────────
  if (
    ctx.billing.mileageAutoSuggest &&
    ctx.billing.mileageRate &&
    ctx.totalGpsMiles != null &&
    ctx.totalGpsMiles > 0
  ) {
    // Skip if a mileage line already exists from ticket_line_items to avoid
    // double-billing.
    const hasManualMileage = ticketLineItems.some(
      (l) => classifyLineItemType(l.type).lineType === "mileage",
    );
    if (!hasManualMileage) {
      const qtyUnits = toFixedUnits(ctx.totalGpsMiles.toFixed(4));
      const priceUnits = toFixedUnits(ctx.billing.mileageRate);
      const amountUnits = mulUnits(qtyUnits, priceUnits);
      const taxable = defaultTaxableForLineType("mileage");
      lines.push({
        ticketId: ctx.ticketId,
        sourceType: "mileage_auto",
        sourceId: null,
        afe: ctx.afe,
        lineType: "mileage",
        description: "Mileage (auto from GPS)",
        quantity: unitsToString4(qtyUnits),
        unit: "mi",
        unitPrice: unitsToString4(priceUnits),
        amount: unitsToString2(amountUnits),
        taxable,
        taxState: null,
        taxRate: null,
        taxAmount: "0.00",
        incomeCategory: resolveIncomeCategory("mileage", incomeOverrides),
        sortOrder: sortIdx++,
      });
    }
  }

  const snapshot: EngineSnapshot = {
    vendorId: ctx.vendor.id,
    partnerId: ctx.partner.id,
    siteId: ctx.site.id,
    siteState: taxState,
    taxRate: ctx.taxRate?.rate ?? null,
    taxRateSource: ctx.taxRate ? "tax_rates_table" : "none",
    overtimeMultiplier: otMultiplier,
    dailyOtHours: dailyOtStr,
    weeklyOtHours: weeklyOtStr,
    rateLookups,
    capturedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
  };

  return { lines, snapshot };
}

// Helper used by the orchestrator and the API: total an array of lines.
export function totalLines(lines: Array<{
  amount: string;
  taxAmount: string;
}>): { subtotal: string; taxTotal: string; total: string } {
  let sub = 0n;
  let tax = 0n;
  for (const l of lines) {
    sub += toFixedUnits(l.amount);
    tax += toFixedUnits(l.taxAmount);
  }
  return {
    subtotal: unitsToString2(sub),
    taxTotal: unitsToString2(tax),
    total: unitsToString2(sub + tax),
  };
}

// Re-export decimal helpers for tests.
export const _internal = {
  toFixedUnits,
  unitsToString2,
  unitsToString4,
  mulUnits,
  fixedRound2,
  sliceByDay,
  splitOvertime,
};
