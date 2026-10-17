import { z } from "zod/v4";
import {
  FleetInsuranceCoverageSchema,
  FleetInsuranceWorkScopeSchema,
  FleetCoverageAssessmentSchema,
  FleetInsuranceOperationalProjectionSchema,
  type FleetInsuranceCoverage,
  type FleetInsuranceWorkScope,
  type FleetCoverageAssessment,
} from "./fleet-insurance";
import {
  parseExactDecimal,
  subtractExact,
  addExact,
  formatExact,
  type ExactDecimal,
} from "@workspace/db/format";
const input = z
  .object({
    work: FleetInsuranceWorkScopeSchema,
    records: z.array(FleetInsuranceCoverageSchema).max(500),
  })
  .strict();
const compare = (a: string | ExactDecimal, b: string | ExactDecimal) =>
  subtractExact(
    typeof a === "string" ? parseExactDecimal(a) : a,
    typeof b === "string" ? parseExactDecimal(b) : b,
  ).coefficient;
function restrictions(
  record: FleetInsuranceCoverage,
  work: FleetInsuranceWorkScope,
): FleetCoverageAssessment["reasons"] {
  const reasons: FleetCoverageAssessment["reasons"] = [];
  if (
    record.policyNumber === null ||
    record.insuredLegalEntity === null ||
    record.limitUSD === null ||
    work.insuredLegalEntity === null
  )
    reasons.push("unverified");
  if (
    record.insuredLegalEntity !== null &&
    work.insuredLegalEntity !== null &&
    record.insuredLegalEntity.trim().toUpperCase() !==
      work.insuredLegalEntity.trim().toUpperCase()
  )
    reasons.push("insured_entity_mismatch");
  if (
    record.state === "revoked" ||
    record.state === "cancelled" ||
    record.state === "failed"
  )
    reasons.push(record.state);
  else if (
    record.state !== "verified" ||
    record.reviewedByUserId === null ||
    record.reviewedAt === null ||
    Date.parse(record.reviewedAt) > Date.parse(work.evaluatedAt) ||
    !record.scopesReviewed
  )
    reasons.push("unverified");
  if (record.validFrom === null || record.validUntil === null)
    reasons.push("unverified");
  else {
    if (Date.parse(record.validFrom) > Date.parse(work.startAt))
      reasons.push("not_yet_effective");
    if (
      Date.parse(record.validUntil) <= Date.parse(work.startAt) ||
      (work.endAt && Date.parse(record.validUntil) <= Date.parse(work.endAt))
    )
      reasons.push("expired");
  }
  if (
    record.carrierIds === null ||
    record.states === null ||
    record.cargoCodes === null ||
    record.equipmentIds === null
  )
    reasons.push("unverified");
  if (record.carrierIds && !record.carrierIds.includes(work.carrierId))
    reasons.push("carrier_mismatch");
  if (
    record.states?.length &&
    work.states.some((state) => !record.states!.includes(state))
  )
    reasons.push("territory_mismatch");
  if (record.cargoCodes?.length && !record.cargoCodes.includes(work.cargoCode))
    reasons.push("cargo_mismatch");
  if (
    record.equipmentIds?.length &&
    work.equipmentIds.some((id) => !record.equipmentIds!.includes(id))
  )
    reasons.push("equipment_mismatch");
  if (
    work.filingRequired &&
    (record.filingStatus !== "accepted" ||
      record.filingVerifiedAt === null ||
      Date.parse(record.filingVerifiedAt) > Date.parse(work.evaluatedAt))
  )
    reasons.push("filing_unverified");
  return [...new Set(reasons)];
}
/** Pure recorded assessment, not permission to operate or legal certification.
 * Enforcement and stop-work authority remain separate. Unknown facts stay red. */
export function evaluateFleetInsuranceCoverage(
  raw: unknown,
): FleetCoverageAssessment {
  const { work, records } = input.parse(raw),
    base = {
      evaluatedAt: work.evaluatedAt,
      requirementReference: work.requirementReference,
    };
  const red = (
    reasons: FleetCoverageAssessment["reasons"],
    limitUSD: string | null = null,
    recordIds: string[] = [],
  ) =>
    FleetCoverageAssessmentSchema.parse({
      ...base,
      status: "red",
      reasons: [...new Set(reasons)],
      limitUSD,
      recordIds,
      recordRefs: recordIds.map((id) => ({
        id,
        revision: records.find((record) => record.id === id)!.revision,
      })),
    });
  if (new Set(records.map((record) => record.id)).size !== records.length)
    return red(["evidence_identity_conflict"]);
  if (work.endAt === null) return red(["run_window_unverified"]);
  if (!records.length) return red(["missing"]);
  const failures: FleetCoverageAssessment["reasons"] = [],
    eligible = records.filter((record) => {
      const reasons = restrictions(record, work);
      failures.push(...reasons);
      return !reasons.length;
    });
  let highest: ExactDecimal | null = null,
    highestIds: string[] = [];
  for (const primary of eligible.filter(
    (record) =>
      record.coverageType === work.coverageType &&
      record.underlyingPolicyId === null,
  )) {
    const walk = (
      record: FleetInsuranceCoverage,
      limit: ExactDecimal,
      ids: string[],
    ) => {
      if (highest === null || compare(limit, highest) > 0n) {
        highest = limit;
        highestIds = ids;
      }
      for (const excess of eligible.filter(
        (row) =>
          row.coverageType === "excess" &&
          row.underlyingPolicyId === record.id &&
          !ids.includes(row.id),
      )) {
        if (
          excess.limitUSD === null ||
          !excess.followFormReviewed ||
          excess.attachmentPointUSD === null ||
          compare(excess.attachmentPointUSD, limit) !== 0n
        ) {
          failures.push("layer_unverified");
          continue;
        }
        walk(excess, addExact(limit, parseExactDecimal(excess.limitUSD)), [
          ...ids,
          excess.id,
        ]);
      }
    };
    if (primary.limitUSD === null) continue;
    walk(primary, parseExactDecimal(primary.limitUSD), [primary.id]);
  }
  if (highest !== null && compare(highest, work.requiredLimitUSD) >= 0n)
    return FleetCoverageAssessmentSchema.parse({
      ...base,
      status: "green",
      reasons: [],
      limitUSD: formatExact(highest),
      recordIds: highestIds,
      recordRefs: highestIds.map((id) => ({
        id,
        revision: records.find((record) => record.id === id)!.revision,
      })),
    });
  return red(
    [...failures, highest === null ? "unverified" : "insufficient_limit"],
    highest === null ? null : formatExact(highest),
    highestIds,
  );
}
export function projectFleetInsuranceCoverage(
  rawRecord: unknown,
  rawAssessment: unknown,
) {
  const record = FleetInsuranceCoverageSchema.parse(rawRecord),
    assessment = FleetCoverageAssessmentSchema.parse(rawAssessment);
  return FleetInsuranceOperationalProjectionSchema.parse({
    recordId: record.id,
    revision: record.revision,
    coverageType: record.coverageType,
    status: assessment.recordRefs.some(
      (ref) => ref.id === record.id && ref.revision === record.revision,
    )
      ? assessment.status
      : "red",
    reasons: assessment.recordRefs.some(
      (ref) => ref.id === record.id && ref.revision === record.revision,
    )
      ? assessment.reasons
      : ["unverified"],
    evaluatedAt: assessment.evaluatedAt,
  });
}
