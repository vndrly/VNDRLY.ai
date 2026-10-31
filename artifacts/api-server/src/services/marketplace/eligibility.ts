import { distanceMiles, validCoordinates, type Coordinates } from "./distance";
import { subjectFingerprint } from "../service-matching/candidates";
import type { ServiceSubjectInput } from "../service-matching/types";

/** An active row alone is insufficient if a catalog editor has since changed the classified wording. */
export function mappingMatchesSavedSubject(
  mapping: { evidence: Record<string, unknown> } | null | undefined,
  subject: ServiceSubjectInput,
): boolean {
  const snapshot = mapping?.evidence.serviceMatching;
  return (
    !!snapshot &&
    typeof snapshot === "object" &&
    "subjectFingerprint" in snapshot &&
    typeof snapshot.subjectFingerprint === "string" &&
    snapshot.subjectFingerprint === subjectFingerprint(subject)
  );
}

export interface EligibilityMapping {
  canonicalServiceId: number | null;
  status: string;
  supersededAt: Date | null;
}
export interface EligibilityArea extends Coordinates {
  vendorId: number;
  vendorCapabilityId: number | null;
  radiusMiles: number | string;
  active: boolean;
  verifiedAt: Date | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}
export interface EligibilityInput {
  vendorId: number;
  partnerId: number;
  workTypeId: number;
  authorized: boolean;
  companyActive: boolean;
  capability: {
    id: number;
    vendorId: number;
    active: boolean;
    capacity: number;
  } | null;
  capabilityMapping: EligibilityMapping | null;
  demandMapping: EligibilityMapping | null;
  canonicalServiceActive: boolean;
  offer: {
    id: number;
    vendorCapabilityId: number;
    partnerId: number;
    workTypeId: number;
    active: boolean;
    capacity: number;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
  } | null;
  serviceAreas: EligibilityArea[];
  site: Coordinates | null;
  complianceCurrent: boolean;
  requiredCredentials: string[];
  currentCredentials: string[];
  requestedCapacity: number;
  available: boolean;
  now: Date;
  /** Discovery evaluates capability without requiring negotiated commercial terms. Award callers retain the default. */
  requireOffer?: boolean;
  relationshipRequired?: boolean;
  relationshipApproved?: boolean;
  relationshipStatus?: string | null;
  internalEvidence?: Record<string, unknown>;
}
export type EligibilityReason =
  | "UNAUTHORIZED"
  | "COMPANY_INACTIVE"
  | "CAPABILITY_INACTIVE"
  | "SERVICE_MATCH_INACTIVE"
  | "OFFER_INACTIVE"
  | "SERVICE_AREA_MISSING"
  | "SERVICE_AREA_AMBIGUOUS"
  | "SERVICE_AREA_INVALID"
  | "SITE_COORDINATES_INVALID"
  | "OUT_OF_SERVICE_AREA"
  | "COMPLIANCE_STALE"
  | "CREDENTIAL_MISSING"
  | "INSUFFICIENT_CAPACITY"
  | "UNAVAILABLE"
  | "RELATIONSHIP_REQUIRED"
  | "RELATIONSHIP_RESTRICTED";
export interface EligibilityResult {
  eligible: boolean;
  reasonCodes: EligibilityReason[];
  facts: {
    distanceMiles: number | null;
    radiusMiles: number | null;
    availableCapacity: number;
    requiredCapacity: number;
    missingCredentials: string[];
  };
  internalEvidence: Record<string, unknown>;
}
export function activeServiceMatch(
  a: EligibilityMapping | null,
  b: EligibilityMapping | null,
  canonicalServiceActive: boolean,
): boolean {
  return (
    canonicalServiceActive &&
    a?.status === "active" &&
    b?.status === "active" &&
    a.supersededAt === null &&
    b.supersededAt === null &&
    a.canonicalServiceId !== null &&
    a.canonicalServiceId === b.canonicalServiceId
  );
}
const effective = (
  row: { effectiveFrom: Date; effectiveUntil: Date | null },
  now: Date,
) =>
  row.effectiveFrom <= now &&
  (row.effectiveUntil === null || row.effectiveUntil > now);

/** Pure evaluation of authoritative saved facts. Callers load these on the server; never accept an HTTP eligibility snapshot. */
export async function evaluateMarketplaceEligibility(
  input: EligibilityInput,
): Promise<EligibilityResult> {
  const reasons: EligibilityReason[] = [];
  const add = (condition: boolean, reason: EligibilityReason) => {
    if (condition) reasons.push(reason);
  };
  const capability = input.capability;
  const offer = input.offer;
  add(!input.authorized, "UNAUTHORIZED");
  add(!input.companyActive, "COMPANY_INACTIVE");
  add(
    !capability?.active || capability.vendorId !== input.vendorId,
    "CAPABILITY_INACTIVE",
  );
  add(
    !activeServiceMatch(
      input.capabilityMapping,
      input.demandMapping,
      input.canonicalServiceActive,
    ),
    "SERVICE_MATCH_INACTIVE",
  );
  const offerActive =
    !!offer &&
    offer.active &&
    offer.vendorCapabilityId === capability?.id &&
    offer.partnerId === input.partnerId &&
    offer.workTypeId === input.workTypeId &&
    effective(offer, input.now);
  add(input.requireOffer !== false && !offerActive, "OFFER_INACTIVE");
  const scoped = input.serviceAreas.filter(
    (row) =>
      row.vendorId === input.vendorId &&
      row.active &&
      effective(row, input.now),
  );
  const overrides = scoped.filter(
    (row) => row.vendorCapabilityId === capability?.id,
  );
  const areas = overrides.length
    ? overrides
    : scoped.filter((row) => row.vendorCapabilityId === null);
  add(areas.length === 0, "SERVICE_AREA_MISSING");
  add(areas.length > 1, "SERVICE_AREA_AMBIGUOUS");
  const area = areas.length === 1 ? areas[0] : null;
  const radius = area ? Number(area.radiusMiles) : null;
  const areaValid =
    area !== null &&
    validCoordinates(area) &&
    area.verifiedAt instanceof Date &&
    Number.isFinite(area.verifiedAt.getTime()) &&
    area.verifiedAt <= input.now &&
    radius !== null &&
    Number.isFinite(radius) &&
    radius > 0;
  add(area !== null && !areaValid, "SERVICE_AREA_INVALID");
  const siteValid = validCoordinates(input.site);
  add(!siteValid, "SITE_COORDINATES_INVALID");
  const distance =
    areaValid && siteValid ? distanceMiles(area, input.site!) : null;
  // No display rounding or configurable grace distance before this inclusive comparison.
  add(distance !== null && distance > radius!, "OUT_OF_SERVICE_AREA");
  add(!input.complianceCurrent, "COMPLIANCE_STALE");
  const current = new Set(
    input.currentCredentials.map((x) => x.trim().toLowerCase()),
  );
  const missing = input.requiredCredentials.filter(
    (x) => !current.has(x.trim().toLowerCase()),
  );
  add(missing.length > 0, "CREDENTIAL_MISSING");
  const capacity = Math.max(
    0,
    Math.min(capability?.capacity ?? 0, offerActive ? offer!.capacity : input.requireOffer === false ? capability?.capacity ?? 0 : 0),
  );
  add(
    !Number.isSafeInteger(input.requestedCapacity) ||
      input.requestedCapacity <= 0 ||
      ((offerActive || input.requireOffer === false) && capacity < input.requestedCapacity),
    "INSUFFICIENT_CAPACITY",
  );
  add(!input.available, "UNAVAILABLE");
  add(isMarketplaceRelationshipRestricted(input.relationshipStatus), "RELATIONSHIP_RESTRICTED");
  add(
    input.relationshipRequired === true && input.relationshipApproved !== true,
    "RELATIONSHIP_REQUIRED",
  );
  return {
    eligible: reasons.length === 0,
    reasonCodes: reasons,
    facts: {
      distanceMiles: distance,
      radiusMiles: areaValid ? radius : null,
      availableCapacity: capacity,
      requiredCapacity: input.requestedCapacity,
      missingCredentials: missing,
    },
    internalEvidence: input.internalEvidence ?? {},
  };
}

/** Absence is not a restriction; revocation requires deliberate partner re-engagement. */
export function isMarketplaceRelationshipRestricted(status: string | null | undefined): boolean {
  return ["revoked", "rejected", "suspended"].includes(status ?? "");
}
