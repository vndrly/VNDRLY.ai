import { expect, it } from "vitest";
import {
  FleetRateCardRevisionSchema,
  FleetQuantityEvidenceSchema,
  type FleetRateCardRevision,
} from "@workspace/api-zod";
import {
  calculateFleetCharges,
  selectFleetRateAuthority,
  type FleetChargeCalculation,
} from "./fleet-pricing";
const id = (n: number) =>
  `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;
const at = "2026-10-16T12:00:00Z";
function card(overrides: Partial<FleetRateCardRevision> = {}) {
  return FleetRateCardRevisionSchema.parse({
    id: id(1),
    version: 1,
    vendorId: 7,
    serviceId: 3,
    partnerId: 8,
    billingSiteId: 9,
    approvalRef: { type: "partner_approval", id: "approved-1", revision: "1" },
    basis: "per_barrel",
    unitRate: "10",
    currency: "USD",
    currencyScale: 2,
    currencyRounding: "half_away_from_zero",
    effectiveFrom: "2026-10-01T00:00:00Z",
    effectiveUntil: null,
    approvedByUserId: 4,
    approvedAt: "2026-10-01T00:00:00Z",
    minimum: null,
    detention: null,
    extras: [],
    notes: "Synthetic test agreement",
    ...overrides,
  });
}
function input(rateCard = card(), quantity = "10"): FleetChargeCalculation {
  return {
    rateCard,
    scope: {
      ticketId: 100,
      runId: id(2),
      cycleId: null,
      vendorId: 7,
      partnerId: 8,
      billingSiteId: 9,
      serviceId: 3,
      afeNumber: "SYNTHETIC-AFE",
      workDate: "2026-10-16",
      workAt: at,
      stage: "run_review",
      minimumGroupKey: "synthetic-site-day-agreement",
    },
    description: "Synthetic crude transport",
    taxTreatment: "review_required",
    quantityEvidence: [
      FleetQuantityEvidenceSchema.parse({
        id: id(3),
        cycleId: null,
        kind: "billable",
        quantity,
        unit: rateCard.basis === "per_hour" ? "hour" : "barrel",
        source: "manual",
        evidenceReferences: [],
        capturedAt: at,
        recordedByUserId: 2,
      }),
    ],
    reviewedIntervals: [],
    additionalCharges: [],
    existingCharges: [],
  };
}
it("selects an immutable approved sub-cent rate ahead of a live catalog and refuses ambiguous or out-of-scope authorities", () => {
  const approved = card({ unitRate: "0.0125" }),
    live = card({
      id: id(8),
      unitRate: "0.02",
      approvalRef: { type: "authorized_catalog", id: "live-1", revision: "2" },
    }),
    scope = input().scope;
  const selected = selectFleetRateAuthority([live, approved], scope);
  expect(selected).toEqual({ mode: "priced", rateCard: approved });
  expect(
    selectFleetRateAuthority([approved, card({ id: id(9) })], scope),
  ).toMatchObject({ mode: "unpriced", reason: "agreement_unresolved" });
  expect(
    selectFleetRateAuthority([approved], { ...scope, billingSiteId: 99 }),
  ).toMatchObject({ mode: "unpriced" });
  expect(
    selectFleetRateAuthority([approved], {
      ...scope,
      workAt: "2026-09-01T00:00:00Z",
    }),
  ).toMatchObject({ mode: "unpriced" });
});
it("finalizes a day minimum once across tickets and isolates another day, AFE or site", () => {
  const rate = card({
      billingSiteId: null,
      minimum: { amount: "100", scope: "day" },
    }),
    first = input(rate, "4"),
    second = input(rate, "4");
  second.scope.runId = id(4);
  second.scope.ticketId = 101;
  second.quantityEvidence[0].id = id(5);
  const a = calculateFleetCharges(first),
    b = calculateFleetCharges(second),
    final = {
      ...first,
      scope: { ...first.scope, stage: "day_finalize" as const },
      existingCharges: [...a, ...b],
    };
  const settled = calculateFleetCharges(final),
    topup = settled.find((c) => c.kind === "minimum_top_up")!;
  expect(topup).toMatchObject({
    currencyAmount: "20",
    billingContext: {
      afeNumber: "SYNTHETIC-AFE",
      workDate: "2026-10-16",
      billingSiteId: 9,
    },
  });
  expect(
    calculateFleetCharges({
      ...second,
      scope: { ...second.scope, stage: "day_finalize" },
      existingCharges: [...a, ...b, topup],
    }).some((c) => c.kind === "minimum_top_up"),
  ).toBe(false);
  const otherDay = calculateFleetCharges({
    ...second,
    scope: {
      ...second.scope,
      stage: "day_finalize",
      workDate: "2026-10-17",
      ticketId: 102,
      runId: id(16),
      workAt: "2026-10-17T12:00:00Z",
    },
    existingCharges: [...a, ...b, topup],
  });
  expect(otherDay.find((c) => c.kind === "minimum_top_up")).toMatchObject({
    currencyAmount: "60",
  });
  expect(
    calculateFleetCharges({
      ...second,
      scope: {
        ...second.scope,
        ticketId: 103,
        runId: id(17),
        stage: "day_finalize",
        afeNumber: "ANOTHER",
      },
      existingCharges: [...a, ...b, topup],
    }).find((c) => c.kind === "minimum_top_up"),
  ).toMatchObject({ currencyAmount: "60" });
  expect(
    calculateFleetCharges({
      ...second,
      scope: {
        ...second.scope,
        ticketId: 104,
        runId: id(18),
        stage: "day_finalize",
        billingSiteId: 99,
      },
      existingCharges: [...a, ...b, topup],
    }).find((c) => c.kind === "minimum_top_up"),
  ).toMatchObject({ currencyAmount: "60" });
  const unscoped = JSON.parse(JSON.stringify(a));
  delete unscoped[0].billingContext;
  expect(() =>
    calculateFleetCharges({ ...final, existingCharges: unscoped }),
  ).toThrow("fleet.pricing_minimum_scope_unresolved");
});
it("keeps detention's exact time ratio and requires explicit consistent quantity conversions", () => {
  const original = input(
    card({
      basis: "per_hour",
      unitRate: "1",
      detention: {
        ratePerHour: "1",
        freeMinutes: "0",
        incrementMinutes: "1",
        rounding: "toward_zero",
        allowHourlyOverlap: false,
      },
    }),
    "1",
  );
  original.reviewedIntervals = [
    {
      id: id(10),
      kind: "waiting",
      startAt: at,
      endAt: "2026-10-16T12:01:00Z",
      reviewedByUserId: 4,
      reviewedAt: "2026-10-16T14:00:00Z",
    },
  ];
  expect(
    calculateFleetCharges(original).find((c) => c.kind === "detention"),
  ).toMatchObject({
    currencyAmount: "0.02",
    calculation: {
      kind: "detention_minutes",
      billableMinutes: "1",
      ratePerHour: "1",
      quantityDisplayScale: 9,
      amountDisplayScale: 36,
    },
  });
  const conversion = input();
  conversion.quantityEvidence[0] = {
    ...conversion.quantityEvidence[0],
    source: "reviewed_conversion",
    conversion: {
      originalQuantity: "420",
      originalUnit: "us_gallon",
      factor: "0.02",
      reviewedByUserId: 4,
      reviewedAt: at,
    },
  };
  expect(() => calculateFleetCharges(conversion)).toThrow(
    "fleet.pricing_conversion_mismatch",
  );
  conversion.quantityEvidence[0].conversion!.factor = "0.025";
  conversion.quantityEvidence[0].quantity = "10.5";
  expect(calculateFleetCharges(conversion)[0].currencyAmount).toBe("105");
});
it("keeps independent mixed shared-ticket rates and deterministic retry identities without currency floats", () => {
  const first = input(card({ unitRate: "10" }), "1"),
    second = input(
      card({
        version: 2,
        unitRate: "12",
        approvalRef: {
          type: "partner_approval",
          id: "approved-1",
          revision: "2",
        },
      }),
      "1",
    );
  second.scope.runId = id(4);
  second.quantityEvidence[0].id = id(5);
  const a = calculateFleetCharges(first),
    b = calculateFleetCharges(second);
  expect(a[0]).toMatchObject({
    unitRate: "10",
    currencyAmount: "10",
    reviewedByUserId: null,
    reviewedAt: null,
  });
  expect(b[0]).toMatchObject({ unitRate: "12", currencyAmount: "12" });
  expect(a[0].id).not.toBe(b[0].id);
  expect(calculateFleetCharges({ ...first, existingCharges: a })).toEqual(a);
  const precise = calculateFleetCharges(
    input(card({ unitRate: "0.000125" }), "123.456789"),
  )[0];
  expect(precise).toMatchObject({
    exactAmount: "0.015432098625",
    currencyAmount: "0.02",
  });
});
it("applies scoped minimum top-ups once at the proper finalization boundary", () => {
  const rate = card({ minimum: { amount: "100", scope: "ticket" } }),
    first = input(rate, "4"),
    second = input(rate, "4");
  second.scope.runId = id(4);
  second.quantityEvidence[0].id = id(5);
  const a = calculateFleetCharges(first),
    b = calculateFleetCharges(second);
  expect([...a, ...b].some((c) => c.kind === "minimum_top_up")).toBe(false);
  const final = calculateFleetCharges({
    ...second,
    scope: { ...second.scope, stage: "ticket_finalize" },
    existingCharges: [...a, ...b],
  });
  expect(final.filter((c) => c.kind === "minimum_top_up")).toEqual([
    expect.objectContaining({ currencyAmount: "20", runId: null }),
  ]);
  expect(
    calculateFleetCharges({
      ...second,
      scope: { ...second.scope, stage: "ticket_finalize" },
      existingCharges: [...a, ...final],
    }),
  ).toEqual(final);
  const above = calculateFleetCharges({
    ...input(card({ minimum: { amount: "100", scope: "run" } }), "12"),
  });
  expect(above.some((c) => c.kind === "minimum_top_up")).toBe(false);
  expect(
    calculateFleetCharges(
      input(card({ minimum: { amount: "100", scope: "run" } }), "8"),
    ),
  ).toEqual([
    expect.objectContaining({ kind: "primary", currencyAmount: "80" }),
    expect.objectContaining({ kind: "minimum_top_up", currencyAmount: "20" }),
  ]);
});
it("unions waiting time, applies free time once, and excludes hourly overlap unless explicitly agreed", () => {
  const rate = card({
      basis: "per_hour",
      unitRate: "60",
      detention: {
        ratePerHour: "60",
        freeMinutes: "30",
        incrementMinutes: "1",
        rounding: "toward_zero",
        allowHourlyOverlap: false,
      },
    }),
    original = input(rate, "1");
  original.reviewedIntervals = [
    {
      id: id(10),
      kind: "waiting",
      startAt: at,
      endAt: "2026-10-16T13:30:00Z",
      reviewedByUserId: 4,
      reviewedAt: "2026-10-16T14:00:00Z",
    },
  ];
  expect(
    calculateFleetCharges(original).find((c) => c.kind === "detention"),
  ).toMatchObject({ currencyAmount: "60" });
  original.reviewedIntervals.push({
    ...original.reviewedIntervals[0],
    id: id(11),
  });
  expect(
    calculateFleetCharges(original).find((c) => c.kind === "detention"),
  ).toMatchObject({ currencyAmount: "60" });
  original.reviewedIntervals.push({
    id: id(12),
    kind: "hourly_service",
    startAt: "2026-10-16T13:00:00Z",
    endAt: "2026-10-16T13:30:00Z",
    reviewedByUserId: 4,
    reviewedAt: "2026-10-16T14:00:00Z",
  });
  expect(
    calculateFleetCharges(original).find((c) => c.kind === "detention"),
  ).toMatchObject({ currencyAmount: "30" });
  expect(
    calculateFleetCharges({
      ...original,
      rateCard: {
        ...rate,
        detention: { ...rate.detention!, allowHourlyOverlap: true },
      },
    }).find((c) => c.kind === "detention"),
  ).toMatchObject({ currencyAmount: "60" });
});
it("calculates only agreed named surcharge bases, excluding unrelated reimbursements", () => {
  const rate = card({
      extras: [
        {
          code: "receipt",
          kind: "reimbursement",
          basis: "flat",
          rate: "20",
          unit: null,
          eligibleChargeCodes: [],
          requiresApproval: true,
          agreementReference: "Synthetic receipt allowance",
        },
        {
          code: "fuel",
          kind: "fuel_surcharge",
          basis: "percent",
          rate: "10",
          unit: null,
          eligibleChargeCodes: ["primary"],
          requiresApproval: false,
          agreementReference: "Synthetic fuel clause",
        },
      ],
    }),
    original = input(rate);
  original.additionalCharges = [
    {
      code: "receipt",
      quantity: "1",
      evidenceIds: [id(6)],
      approvedByUserId: 4,
      approvedAt: at,
    },
    {
      code: "fuel",
      quantity: "1",
      evidenceIds: [],
      approvedByUserId: null,
      approvedAt: null,
    },
  ];
  const charges = calculateFleetCharges(original);
  expect(charges.find((c) => c.code === "fuel")).toMatchObject({
    currencyAmount: "10",
    eligibleChargeIds: [charges[0].id],
  });
  expect(charges.find((c) => c.code === "receipt")).toMatchObject({
    currencyAmount: "20",
  });
  original.additionalCharges[0].approvedByUserId = null;
  original.additionalCharges[0].approvedAt = null;
  expect(() => calculateFleetCharges(original)).toThrow(
    "fleet.pricing_approval_required",
  );
});
it("refuses circular charges, missing billable quantities, ambiguous facts and input price/identity substitutions", () => {
  const rate = card({
      extras: [
        {
          code: "a",
          kind: "fuel_surcharge",
          basis: "percent",
          rate: "10",
          unit: null,
          eligibleChargeCodes: ["b"],
          requiresApproval: false,
          agreementReference: "Synthetic a",
        },
        {
          code: "b",
          kind: "fuel_surcharge",
          basis: "percent",
          rate: "10",
          unit: null,
          eligibleChargeCodes: ["a"],
          requiresApproval: false,
          agreementReference: "Synthetic b",
        },
      ],
    }),
    original = input(rate);
  original.additionalCharges = [
    {
      code: "a",
      quantity: "1",
      evidenceIds: [],
      approvedByUserId: null,
      approvedAt: null,
    },
    {
      code: "b",
      quantity: "1",
      evidenceIds: [],
      approvedByUserId: null,
      approvedAt: null,
    },
  ];
  expect(() => calculateFleetCharges(original)).toThrow(
    "fleet.pricing_dependency_cycle",
  );
  expect(() =>
    calculateFleetCharges({ ...input(), quantityEvidence: [] }),
  ).toThrow("fleet.pricing_quantity_unresolved");
  const duplicate = input();
  duplicate.quantityEvidence.push({
    ...duplicate.quantityEvidence[0],
    id: id(15),
  });
  expect(() => calculateFleetCharges(duplicate)).toThrow(
    "fleet.pricing_quantity_unresolved",
  );
  expect(() =>
    calculateFleetCharges({
      ...input(),
      scope: { ...input().scope, vendorId: 999 },
    }),
  ).toThrow("fleet.pricing_scope_mismatch");
  const priced = input(),
    saved = calculateFleetCharges(priced);
  priced.rateCard.unitRate = "11";
  expect(() =>
    calculateFleetCharges({ ...priced, existingCharges: saved }),
  ).toThrow("fleet.pricing_existing_charge_changed");
});
