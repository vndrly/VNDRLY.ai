import { z } from "zod/v4";
import { FleetComplianceEvaluationInputSchema, FleetCompliancePolicySchema, FleetPartnerComplianceSnapshotSchema, fleetComplianceSubjectKey, type FleetApplicabilityFacts, type FleetComplianceAssessment, type FleetComplianceEvidence, type FleetComplianceFinding, type FleetCompliancePolicy, type FleetRequirementVersion } from "./fleet-compliance";

type Applicability = true | false | "unknown";
function applies(requirement: FleetRequirementVersion, facts: FleetApplicabilityFacts): Applicability {
  const alternatives = requirement.applicability.anyOf.map(group => {
    const values = group.allOf.map(predicate => {
      const fact = facts[predicate.fact];
      if (fact === null || fact === undefined) return "unknown" as const;
      switch (predicate.operator) {
        case "present": return true;
        case "eq": return !Array.isArray(fact) && typeof fact === typeof predicate.value ? fact === predicate.value : "unknown" as const;
        case "neq": return !Array.isArray(fact) && typeof fact === typeof predicate.value ? fact !== predicate.value : "unknown" as const;
        case "gte": return typeof fact === "number" && typeof predicate.value === "number" ? fact >= predicate.value : "unknown" as const;
        case "lte": return typeof fact === "number" && typeof predicate.value === "number" ? fact <= predicate.value : "unknown" as const;
        case "in": return Array.isArray(predicate.value) && !Array.isArray(fact) && predicate.value.some(value => typeof value === typeof fact) ? predicate.value.some(value => value === fact) : "unknown" as const;
        case "includes": return Array.isArray(fact) ? fact.some(value => value === predicate.value) : "unknown" as const;
      }
    });
    return values.includes(false) ? false : values.includes("unknown") ? "unknown" as const : true;
  });
  return alternatives.includes(true) ? true : alternatives.includes("unknown") ? "unknown" : false;
}
function restrictionStatus(evidence: FleetComplianceEvidence, facts: FleetApplicabilityFacts, assetId: string | number): "excluded" | "unverified" | null {
  const comparisons: Array<[unknown[] | undefined, unknown]> = [[evidence.restrictions.states, facts.state], [evidence.restrictions.cargoCodes, facts.cargoCode], [evidence.restrictions.carrierIds, facts.carrierId], [evidence.restrictions.equipmentIds, typeof assetId === "string" ? assetId : facts.vehicleAssetId]];
  let unknown = false;
  for (const [allowed, actual] of comparisons) {
    if (!allowed?.length) continue;
    if (actual === null || actual === undefined) { unknown = true; continue; }
    if (!allowed.includes(actual)) return "excluded";
  }
  return unknown ? "unverified" : null;
}
const reasonLabels: Record<FleetComplianceFinding["reason"], string> = { missing: "Required evidence missing", expired: "Recorded requirement expired", revoked: "Recorded credential revoked", failed: "Recorded requirement not satisfied", unverified: "Requirement not verified", excluded: "Recorded coverage or scope does not match this work" };

export function evaluateFleetCompliance(input: unknown): FleetComplianceAssessment[] {
  const value = FleetComplianceEvaluationInputSchema.parse(input), now = Date.parse(value.at);
  return value.members.map(member => {
    const facts = { ...value.facts, ...member.facts };
    const assessment: FleetComplianceAssessment = { subject: member.subject, status: "green", findings: [], evaluatedAt: value.at, ruleVersions: [], evidenceRefs: [], dueSoon: [], freshness: value.freshness };
    const candidateRules = value.requirements.filter(rule => rule.subjectKinds.includes(member.subject.kind));
    const currentRules = candidateRules.filter(rule => Date.parse(rule.effectiveFrom) <= now && (rule.effectiveUntil === null || now < Date.parse(rule.effectiveUntil)));
    const latest = new Map<string, FleetRequirementVersion>();
    for (const rule of currentRules) if (!latest.has(rule.id) || latest.get(rule.id)!.version < rule.version) latest.set(rule.id, rule);
    const add = (rule: Pick<FleetRequirementVersion, "id" | "version" | "category">, reason: FleetComplianceFinding["reason"]) => assessment.findings.push({ requirementId: rule.id, requirementVersion: rule.version, subject: member.subject, category: rule.category, reason, explanation: reasonLabels[reason], evaluatedAt: value.at });
    if (!currentRules.length) add({ id: "requirements_unconfigured", version: 1, category: "other" }, "unverified");
    for (const rule of latest.values()) {
      assessment.ruleVersions.push({ id: rule.id, version: rule.version });
      const applicability = applies(rule, facts);
      if (applicability === false) continue;
      if (applicability === "unknown") { add(rule, "unverified"); continue; }
      if (Date.parse(rule.source.reviewedAt) > now) { add(rule, "unverified"); continue; }
      const candidates = value.evidence.filter(row => fleetComplianceSubjectKey(row.subject) === fleetComplianceSubjectKey(member.subject) && row.requirementId === rule.id && row.requirementVersion === rule.version);
      if (new Set(candidates.map(row => row.id)).size > 1) { add(rule, "unverified"); continue; }
      const evidence = [...candidates].sort((a, b) => b.revision - a.revision || a.id.localeCompare(b.id))[0];
      if (!evidence) { add(rule, "missing"); continue; }
      assessment.evidenceRefs.push({ id: evidence.id, revision: evidence.revision });
      if (evidence.status === "revoked" || evidence.status === "failed") { add(rule, evidence.status); continue; }
      if (evidence.validUntil && Date.parse(evidence.validUntil) <= now) { add(rule, "expired"); continue; }
      if (evidence.status !== "verified" || (evidence.validFrom && Date.parse(evidence.validFrom) > now) || (evidence.verifiedAt && Date.parse(evidence.verifiedAt) > now)) { add(rule, "unverified"); continue; }
      if (rule.renewalDays !== null && evidence.validUntil === null) { add(rule, "unverified"); continue; }
      const restriction = restrictionStatus(evidence, facts, member.subject.id);
      if (restriction) { add(rule, restriction); continue; }
      if (evidence.validUntil && Date.parse(evidence.validUntil) - now <= rule.dueSoonDays * 86400000) assessment.dueSoon.push({ requirementId: rule.id, dueAt: evidence.validUntil });
    }
    if (value.freshness === "unverified" && !assessment.findings.length) add({ id: "evidence_freshness", version: 1, category: "other" }, "unverified");
    assessment.status = assessment.findings.length ? "red" : "green";
    return assessment;
  });
}
export function fleetDetailComplianceStatus(assessments: ReadonlyArray<FleetComplianceAssessment>): "green" | "red" {
  return assessments.length > 0 && assessments.every(row => row.status === "green") ? "green" : "red";
}
export function projectFleetComplianceForPartner(assessment: FleetComplianceAssessment) {
  return FleetPartnerComplianceSnapshotSchema.parse({ subject: assessment.subject, status: assessment.status, evaluatedAt: assessment.evaluatedAt, freshness: assessment.freshness, reasons: assessment.findings.map(row => ({ requirementId: row.requirementId, requirementVersion: row.requirementVersion, category: row.category, reason: row.reason, label: reasonLabels[row.reason] })), dueSoon: assessment.dueSoon.map(row => ({ requirementId: row.requirementId, dueAt: row.dueAt })) });
}
export const projectFleetComplianceForDispatch = projectFleetComplianceForPartner;

const policyQuery = z.object({ partnerId: z.number().int().positive(), siteId: z.number().int().positive().nullable(), contractId: z.string().nullable(), workTypeId: z.number().int().positive().nullable(), at: z.iso.datetime({ offset: true }), policies: z.array(FleetCompliancePolicySchema) }).strict();
export function resolveFleetCompliancePolicy(input: unknown): FleetCompliancePolicy {
  const query = policyQuery.parse(input), now = Date.parse(query.at);
  const matches = query.policies.filter(policy => policy.scope.partnerId === query.partnerId && (policy.scope.siteId === null || policy.scope.siteId === query.siteId) && (policy.scope.contractId === null || policy.scope.contractId === query.contractId) && (policy.scope.workTypeId === null || policy.scope.workTypeId === query.workTypeId) && Date.parse(policy.effectiveFrom) <= now && (policy.effectiveUntil === null || now < Date.parse(policy.effectiveUntil)));
  const specificity = (policy: FleetCompliancePolicy) => [policy.scope.siteId, policy.scope.contractId, policy.scope.workTypeId].filter(value => value !== null).length;
  matches.sort((a, b) => specificity(b) - specificity(a) || Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom) || b.version - a.version || a.id.localeCompare(b.id));
  if (matches.length > 1 && specificity(matches[0]) === specificity(matches[1]) && matches[0].effectiveFrom === matches[1].effectiveFrom && matches[0].version === matches[1].version && matches[0].id !== matches[1].id) throw new Error("Ambiguous active Fleet compliance policies");
  if (matches.length) return matches[0];
  return { id: "00000000-0000-4000-8000-000000000001", version: 1, mode: "warn_only", scope: { partnerId: query.partnerId, siteId: null, contractId: null, workTypeId: null }, effectiveFrom: "1970-01-01T00:00:00Z", effectiveUntil: null, checkpoints: ["detail", "reservation", "dispatch", "accept", "start", "replace", "route_change", "close", "office_submit"], activatedByUserId: null, notice: "Initial recorded-compliance warning policy", existingWorkTreatment: "preserve_capture_policy" };
}
