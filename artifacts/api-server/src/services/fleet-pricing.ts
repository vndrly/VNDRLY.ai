import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetRateCardRevisionSchema,
  FleetQuantityEvidenceSchema,
  FleetChargeSchema,
  FleetExactDecimalSchema,
  type FleetRateCardRevision,
  type FleetPricingIntent,
  type FleetCharge,
} from "@workspace/api-zod";
import {
  parseExactDecimal as decimal,
  addExact,
  subtractExact,
  multiplyExact,
  divideExact,
  roundExact,
  formatExact,
  type ExactDecimal,
} from "@workspace/db/format";

/** These are pure candidates, not authorization or office approval. The server
 * resolver must provide canonical approved snapshots and reviewed source facts. */
export class FleetPricingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new FleetPricingError(`fleet.pricing_${code}`);
}
const timestamp = z.iso.datetime({ offset: true }),
  positive = z.number().int().positive(),
  nonnegative = FleetExactDecimalSchema.refine(
    (v) => decimal(v).coefficient >= 0n,
  );
const scopeSchema = z
  .object({
    ticketId: positive,
    runId: z.uuid(),
    cycleId: z.uuid().nullable(),
    vendorId: positive,
    partnerId: positive,
    billingSiteId: positive,
    serviceId: positive,
    afeNumber: z.string().max(200),
    workDate: z.iso.date(),
    workAt: timestamp,
    stage: z.enum(["run_review", "ticket_finalize", "day_finalize"]),
    minimumGroupKey: z.string().min(1).max(500),
  })
  .strict();
const intervalSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["waiting", "hourly_service"]),
    startAt: timestamp,
    endAt: timestamp,
    reviewedByUserId: positive,
    reviewedAt: timestamp,
  })
  .strict()
  .refine(
    (v) => Date.parse(v.endAt) > Date.parse(v.startAt),
    "Interval end must follow start",
  );
const additionalSchema = z
  .object({
    code: z.string().min(1).max(100),
    quantity: nonnegative,
    evidenceIds: z.array(z.uuid()),
    approvedByUserId: positive.nullable(),
    approvedAt: timestamp.nullable(),
  })
  .strict()
  .refine(
    (v) => (v.approvedByUserId === null) === (v.approvedAt === null),
    "Approval requires actor and time",
  );
const calculationSchema = z
  .object({
    rateCard: FleetRateCardRevisionSchema,
    scope: scopeSchema,
    description: z.string().trim().min(1).max(1800),
    taxTreatment: z.string().trim().min(1).max(100),
    quantityEvidence: z.array(FleetQuantityEvidenceSchema),
    reviewedIntervals: z.array(intervalSchema),
    additionalCharges: z.array(additionalSchema),
    existingCharges: z.array(FleetChargeSchema),
  })
  .strict();
export type FleetChargeCalculation = z.infer<typeof calculationSchema>;
function cardMatches(
  card: FleetRateCardRevision,
  scope: Pick<
    FleetChargeCalculation["scope"],
    "vendorId" | "partnerId" | "billingSiteId" | "serviceId" | "workAt"
  >,
) {
  const time = Date.parse(scope.workAt);
  return (
    card.vendorId === scope.vendorId &&
    card.serviceId === scope.serviceId &&
    (card.partnerId === null || card.partnerId === scope.partnerId) &&
    (card.billingSiteId === null ||
      card.billingSiteId === scope.billingSiteId) &&
    time >= Date.parse(card.effectiveFrom) &&
    (card.effectiveUntil === null || time < Date.parse(card.effectiveUntil)) &&
    Date.parse(card.approvedAt) <= time
  );
}
/** Selection is over trusted saved candidates; a client-supplied card is never
 * evidence that the company/partner actually approved that authority. */
export function selectFleetRateAuthority(
  candidates: FleetRateCardRevision[],
  scope: FleetChargeCalculation["scope"],
): FleetPricingIntent {
  scope = scopeSchema.parse(scope);
  const priority = {
    approved_quote: 0,
    site_agreement: 1,
    partner_approval: 2,
    authorized_catalog: 3,
    legacy: 4,
  };
  const valid = candidates
    .map((c) => FleetRateCardRevisionSchema.parse(c))
    .filter((c) => cardMatches(c, scope))
    .sort(
      (a, b) => priority[a.approvalRef.type] - priority[b.approvalRef.type],
    );
  if (!valid.length)
    return {
      mode: "unpriced",
      reason: "agreement_unresolved",
      serviceId: scope.serviceId,
      approvalRef: null,
    };
  const rank = priority[valid[0].approvalRef.type],
    same = valid.filter((c) => priority[c.approvalRef.type] === rank),
    first = same[0];
  if (same.some((c) => !isDeepStrictEqual(c, first)))
    return {
      mode: "unpriced",
      reason: "agreement_unresolved",
      serviceId: scope.serviceId,
      approvalRef: null,
    };
  return { mode: "priced", rateCard: first };
}
const basisUnit: Record<FleetRateCardRevision["basis"], FleetCharge["unit"]> = {
  per_job: "run",
  per_hour: "hour",
  per_day: "day",
  lump_sum: "flat",
  per_load: "load",
  per_mile: "mile",
  per_barrel: "barrel",
  per_us_gallon: "us_gallon",
  per_short_ton: "short_ton",
};
function stableId(key: string) {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const currency = (v: ExactDecimal) =>
  formatExact(roundExact(v, { scale: 2, rounding: "half_away_from_zero" }));
type Span = readonly [bigint, bigint];
function union(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    ),
    result: Array<[bigint, bigint]> = [];
  for (const [a, b] of sorted) {
    const prior = result.at(-1);
    if (prior && a <= prior[1]) {
      if (b > prior[1]) prior[1] = b;
    } else result.push([a, b]);
  }
  return result;
}
const ticks = (value: string) => BigInt(Date.parse(value)) * 1000000n;
const minuteTicks = (value: string) => {
  const d = decimal(value);
  return (d.coefficient * 60000000000n) / 10n ** BigInt(d.scale);
};
function detentionMinutes(input: FleetChargeCalculation) {
  const terms = input.rateCard.detention;
  if (!terms) return decimal("0");
  const waiting = union(
      input.reviewedIntervals
        .filter((i) => i.kind === "waiting")
        .map((i) => [ticks(i.startAt), ticks(i.endAt)] as const),
    ),
    hourly = terms.allowHourlyOverlap
      ? []
      : union(
          input.reviewedIntervals
            .filter((i) => i.kind === "hourly_service")
            .map((i) => [ticks(i.startAt), ticks(i.endAt)] as const),
        );
  let free = minuteTicks(terms.freeMinutes),
    elapsed = 0n;
  for (const [a, b] of waiting) {
    const used = free < b - a ? free : b - a;
    free -= used;
    let spans: Span[] = [[a + used, b]];
    for (const [x, y] of hourly)
      spans = spans.flatMap(([l, r]): Span[] =>
        y <= l || x >= r
          ? [[l, r]]
          : [
              ...(x > l ? [[l, x] as const] : []),
              ...(y < r ? [[y, r] as const] : []),
            ],
      );
    for (const [l, r] of spans) elapsed += r - l;
  }
  const increments = divideExact(
    { coefficient: elapsed, scale: 0 },
    { coefficient: minuteTicks(terms.incrementMinutes), scale: 0 },
    { scale: 0, rounding: terms.rounding },
  );
  return multiplyExact(increments, decimal(terms.incrementMinutes));
}
export function calculateFleetCharges(
  raw: FleetChargeCalculation,
): FleetCharge[] {
  const input = calculationSchema.parse(raw),
    { rateCard: card, scope } = input;
  if (!cardMatches(card, scope)) fail("scope_mismatch");
  const quantities = input.quantityEvidence.filter(
    (q) => q.kind === "billable" && q.cycleId === scope.cycleId,
  );
  if (quantities.length !== 1 || quantities[0].unit !== basisUnit[card.basis])
    fail("quantity_unresolved");
  if (
    new Set(input.additionalCharges.map((c) => c.code)).size !==
    input.additionalCharges.length
  )
    fail("additional_duplicate");
  const q = quantities[0],
    result: FleetCharge[] = [],
    existing = new Map<string, FleetCharge>();
  if (
    q.conversion &&
    subtractExact(
      multiplyExact(
        decimal(q.conversion.originalQuantity),
        decimal(q.conversion.factor),
      ),
      decimal(q.quantity),
    ).coefficient !== 0n
  )
    fail("conversion_mismatch");
  const billingContext = {
    vendorId: scope.vendorId,
    partnerId: scope.partnerId,
    billingSiteId: scope.billingSiteId,
    afeNumber: scope.afeNumber,
    workDate: scope.workDate,
    minimumGroupKey: scope.minimumGroupKey,
  };
  for (const c of input.existingCharges) {
    if (
      card.minimum &&
      c.rateCardId === card.id &&
      c.serviceId === card.serviceId &&
      !c.billingContext
    )
      fail("minimum_scope_unresolved");
    if (existing.has(c.id) && !isDeepStrictEqual(existing.get(c.id), c))
      fail("existing_charge_changed");
    existing.set(c.id, c);
  }
  const make = (
    code: string,
    kind: FleetCharge["kind"],
    quantity: string,
    unit: FleetCharge["unit"],
    unitRate: string,
    amount: ExactDecimal,
    options: {
      runId?: string | null;
      cycleId?: string | null;
      key?: string;
      evidenceIds?: string[];
      eligibleIds?: string[];
      currencyAmount?: string;
      calculation?: FleetCharge["calculation"];
    } = {},
  ) => {
    const candidate = FleetChargeSchema.parse({
      billingContext,
      ...(options.calculation ? { calculation: options.calculation } : {}),
      id: stableId(
        JSON.stringify([
          scope.vendorId,
          scope.ticketId,
          card.id,
          scope.serviceId,
          options.key ?? scope.runId,
          options.cycleId === undefined ? scope.cycleId : options.cycleId,
          code,
        ]),
      ),
      revision: 1,
      code,
      ticketId: scope.ticketId,
      runId: options.runId === undefined ? scope.runId : options.runId,
      cycleId: options.cycleId === undefined ? scope.cycleId : options.cycleId,
      serviceId: scope.serviceId,
      kind,
      description:
        code === "minimum_top_up"
          ? "Minimum charge"
          : code === "primary"
            ? input.description
            : `${input.description} — ${code}`,
      quantity,
      unit,
      unitRate,
      exactAmount: formatExact(amount),
      currencyAmount: options.currencyAmount ?? currency(amount),
      currency: card.currency,
      rateCardId: card.id,
      rateCardVersion: card.version,
      approvalRef: card.approvalRef,
      quantityEvidenceIds: options.evidenceIds ?? [q.id],
      eligibleChargeIds: options.eligibleIds ?? [],
      adjustsChargeId: null,
      taxTreatment: input.taxTreatment,
      reviewedByUserId: null,
      reviewedAt: null,
    });
    const prior = existing.get(candidate.id);
    if (
      prior &&
      !isDeepStrictEqual(
        { ...prior, reviewedByUserId: null, reviewedAt: null },
        candidate,
      )
    )
      fail("existing_charge_changed");
    result.push(prior ?? candidate);
    return candidate;
  };
  make(
    "primary",
    "primary",
    q.quantity,
    q.unit,
    card.unitRate,
    multiplyExact(decimal(q.quantity), decimal(card.unitRate)),
  );
  if (card.detention) {
    const minutes = detentionMinutes(input);
    if (minutes.coefficient > 0n) {
      const numerator = multiplyExact(
          minutes,
          decimal(card.detention.ratePerHour),
        ),
        amount = divideExact(numerator, decimal("60"), {
          scale: 36,
          rounding: "half_away_from_zero",
        });
      make(
        "detention",
        "detention",
        formatExact(
          divideExact(minutes, decimal("60"), {
            scale: 9,
            rounding: "half_away_from_zero",
          }),
        ),
        "hour",
        card.detention.ratePerHour,
        amount,
        {
          currencyAmount: formatExact(
            divideExact(numerator, decimal("60"), {
              scale: 2,
              rounding: "half_away_from_zero",
            }),
          ),
          evidenceIds: input.reviewedIntervals.map((i) => i.id),
          calculation: {
            kind: "detention_minutes",
            billableMinutes: formatExact(minutes),
            ratePerHour: card.detention.ratePerHour,
            quantityDisplayScale: 9,
            amountDisplayScale: 36,
          },
        },
      );
    }
  }
  if (card.minimum) {
    const minimum = card.minimum,
      finalize =
        minimum.scope === "run" ||
        minimum.scope === "load" ||
        (minimum.scope === "ticket" && scope.stage === "ticket_finalize") ||
        (minimum.scope === "day" && scope.stage === "day_finalize");
    if (finalize) {
      if (minimum.scope === "load" && scope.cycleId === null)
        fail("quantity_unresolved");
      const group = new Map([
          ...existing,
          ...result.map((c) => [c.id, c] as const),
        ]),
        sameGroup = (c: FleetCharge) =>
          c.rateCardId === card.id &&
          c.serviceId === card.serviceId &&
          isDeepStrictEqual(c.billingContext, billingContext) &&
          (minimum.scope === "day" || c.ticketId === scope.ticketId) &&
          (["ticket", "day"].includes(minimum.scope) ||
            c.runId === scope.runId) &&
          (minimum.scope !== "load" || c.cycleId === scope.cycleId),
        eligible = [...group.values()]
          .filter((c) => c.kind === "primary" && sameGroup(c))
          .sort((a, b) => a.id.localeCompare(b.id));
      const subtotal = eligible.reduce(
          (sum, c) => addExact(sum, decimal(c.currencyAmount)),
          decimal("0"),
        ),
        topup = subtractExact(decimal(minimum.amount), subtotal);
      const priorMinimum = [...existing.values()].filter(
        (c) => c.kind === "minimum_top_up" && sameGroup(c),
      );
      if (
        priorMinimum.length > 1 ||
        priorMinimum.some(
          (c) =>
            c.currencyAmount !==
            currency(topup.coefficient > 0n ? topup : decimal("0")),
        )
      )
        fail("existing_charge_changed");
      if (
        topup.coefficient > 0n &&
        !priorMinimum.some((c) => c.ticketId !== scope.ticketId)
      )
        make(
          "minimum_top_up",
          "minimum_top_up",
          "1",
          "flat",
          formatExact(topup),
          topup,
          {
            key:
              minimum.scope === "day"
                ? `day:${scope.minimumGroupKey}`
                : minimum.scope === "ticket"
                  ? "ticket-minimum"
                  : scope.runId,
            runId: ["day", "ticket"].includes(minimum.scope)
              ? null
              : scope.runId,
            cycleId: minimum.scope === "load" ? scope.cycleId : null,
            evidenceIds: [
              ...new Set(eligible.flatMap((c) => c.quantityEvidenceIds)),
            ].sort(),
            eligibleIds: eligible.map((c) => c.id),
          },
        );
    }
  }
  const requested = new Map(input.additionalCharges.map((c) => [c.code, c])),
    visiting = new Set<string>(),
    done = new Set<string>();
  const extra = (code: string) => {
    if (done.has(code)) return;
    if (visiting.has(code)) fail("dependency_cycle");
    visiting.add(code);
    const terms = card.extras.find((c) => c.code === code),
      reported = requested.get(code);
    if (
      !terms ||
      !reported ||
      ["primary", "detention", "minimum_top_up"].includes(code)
    )
      fail("additional_unresolved");
    if (terms.requiresApproval && reported.approvedByUserId === null)
      fail("approval_required");
    for (const dependency of terms.eligibleChargeCodes)
      if (requested.has(dependency)) extra(dependency);
    const base = result
      .filter((c) => terms.eligibleChargeCodes.includes(c.code))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (
      terms.basis === "percent" &&
      terms.eligibleChargeCodes.some((c) => !base.some((row) => row.code === c))
    )
      fail("dependency_unresolved");
    let amount: ExactDecimal,
      quantity = reported.quantity,
      unit: FleetCharge["unit"] = terms.unit ?? "flat";
    if (terms.basis === "percent") {
      const subtotal = base.reduce(
        (sum, c) => addExact(sum, decimal(c.currencyAmount)),
        decimal("0"),
      );
      amount = divideExact(
        multiplyExact(subtotal, decimal(terms.rate)),
        decimal("100"),
        { scale: 36, rounding: "half_away_from_zero" },
      );
      quantity = formatExact(subtotal);
      unit = "flat";
    } else {
      if (
        terms.basis === "flat" &&
        decimal(quantity).coefficient !== 10n ** BigInt(decimal(quantity).scale)
      )
        fail("additional_unresolved");
      amount = multiplyExact(decimal(quantity), decimal(terms.rate));
    }
    make(code, terms.kind, quantity, unit, terms.rate, amount, {
      evidenceIds: reported.evidenceIds,
      eligibleIds: base.map((c) => c.id),
    });
    visiting.delete(code);
    done.add(code);
  };
  for (const code of [...requested.keys()].sort()) extra(code);
  return result;
}
