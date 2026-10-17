import { z } from "zod/v4";
import { FleetInsuranceWorkScopeSchema } from "./fleet-insurance";

const timestamp = z.iso.datetime({ offset: true });
const positiveId = z.number().int().positive();
export const FleetComplianceSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("carrier"), id: positiveId }).strict(),
  z.object({ kind: z.literal("driver"), id: positiveId }).strict(),
  z.object({ kind: z.literal("vehicle"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("component"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("trip"), id: z.uuid() }).strict(),
]);
export type FleetComplianceSubject = z.infer<typeof FleetComplianceSubjectSchema>;
export const fleetComplianceSubjectKey = (subject: FleetComplianceSubject): string => `${subject.kind}:${subject.id}`;
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
export const FleetApplicabilityFactsSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/), z.union([scalar, z.array(scalar).max(100), z.null()]));
export type FleetApplicabilityFacts = z.infer<typeof FleetApplicabilityFactsSchema>;
const predicate = z.object({ fact: z.string().min(1).max(100), operator: z.enum(["eq", "neq", "gte", "lte", "in", "includes", "present"]), value: z.union([scalar, z.array(scalar).max(100)]).optional() }).strict().superRefine((value, ctx) => {
  if (value.operator !== "present" && value.value === undefined) ctx.addIssue({ code: "custom", path: ["value"], message: "Predicate value is required" });
  if (value.operator === "in" && !Array.isArray(value.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Membership requires a list" });
  if (["gte", "lte"].includes(value.operator) && typeof value.value !== "number") ctx.addIssue({ code: "custom", path: ["value"], message: "Numeric comparison requires a number" });
});
export const FleetRequirementVersionSchema = z.object({
  id: z.string().trim().min(1).max(160), version: positiveId, category: z.enum(["authority", "vehicle_registration", "vehicle_inspection", "maintenance", "tank_test", "insurance", "driver_license", "driver_qualification", "driver_medical", "driver_testing", "training", "duty", "permit", "cargo", "customer", "other"]),
  label: z.string().trim().min(1).max(200), subjectKinds: z.array(z.enum(["carrier", "driver", "vehicle", "component", "trip"])).min(1).max(5),
  jurisdiction: z.enum(["federal", "OK", "TX", "carrier", "customer"]), classification: z.enum(["legal", "contract", "company"]),
  effectiveFrom: timestamp, effectiveUntil: timestamp.nullable(), applicability: z.object({ anyOf: z.array(z.object({ allOf: z.array(predicate).max(50) }).strict()).min(1).max(50) }).strict(),
  coverage: z.object({coverageType:FleetInsuranceWorkScopeSchema.shape.coverageType,requiredLimitUSD:FleetInsuranceWorkScopeSchema.shape.requiredLimitUSD,filingRequired:z.boolean()}).strict().optional(),
  expiryRequired: z.boolean().optional(),
  renewalDays: z.number().int().positive().nullable(), dueSoonDays: z.number().int().nonnegative().max(365),
  source: z.object({ url: z.url().refine(url => /^https:\/\//i.test(url), "HTTPS source required"), section: z.string().trim().min(1).max(500), reviewedAt: timestamp, reviewedByUserId: positiveId }).strict(),
}).strict().superRefine((value, ctx) => {
  if(value.coverage&&value.category!=="insurance")ctx.addIssue({code:"custom",path:["coverage"],message:"Coverage terms require an insurance requirement"});
  if (value.effectiveUntil && Date.parse(value.effectiveUntil) <= Date.parse(value.effectiveFrom)) ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "Requirement end must follow start" });
});
export type FleetRequirementVersion = z.infer<typeof FleetRequirementVersionSchema>;
export const FleetComplianceEvidenceSchema = z.object({
  id: z.uuid(), revision: positiveId, subject: FleetComplianceSubjectSchema,
  requirementId: z.string().trim().min(1).max(160), requirementVersion: positiveId,
  status: z.enum(["document_received", "reviewed", "verified", "revoked", "failed"]),
  validFrom: timestamp.nullable(), validUntil: timestamp.nullable(), verifiedAt: timestamp.nullable(), verifiedByUserId: positiveId.nullable(),
  source: z.string().trim().min(1).max(500), privateDocumentRef: z.string().trim().min(1).max(1000).nullable(),
  restrictions: z.object({ states: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).optional(), cargoCodes: z.array(z.string().trim().min(1).max(100)).max(100).optional(), carrierIds: z.array(positiveId).max(100).optional(), equipmentIds: z.array(z.uuid()).max(500).optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "verified" && (value.verifiedAt === null || value.verifiedByUserId === null)) ctx.addIssue({ code: "custom", path: ["verifiedAt"], message: "Verification needs a reviewer and source time" });
  if (value.validFrom && value.validUntil && Date.parse(value.validUntil) <= Date.parse(value.validFrom)) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Evidence end must follow start" });
});
export type FleetComplianceEvidence = z.infer<typeof FleetComplianceEvidenceSchema>;
export const FleetComplianceFindingSchema = z.object({ requirementId: z.string().min(1).max(160), requirementVersion: positiveId, subject: FleetComplianceSubjectSchema, category: FleetRequirementVersionSchema.shape.category, reason: z.enum(["missing", "expired", "revoked", "failed", "unverified", "excluded"]), explanation: z.string().min(1).max(500), evaluatedAt: timestamp }).strict();
export type FleetComplianceFinding = z.infer<typeof FleetComplianceFindingSchema>;
export const FleetComplianceAssessmentSchema = z.object({
  subject: FleetComplianceSubjectSchema, status: z.enum(["green", "red"]), findings: z.array(FleetComplianceFindingSchema), evaluatedAt: timestamp,
  ruleVersions: z.array(z.object({ id: z.string(), version: positiveId }).strict()), evidenceRefs: z.array(z.object({ id: z.uuid(), revision: positiveId }).strict()),
  dueSoon: z.array(z.object({ requirementId: z.string(), dueAt: timestamp }).strict()), freshness: z.enum(["current", "cached", "unverified"]),
}).strict();
export type FleetComplianceAssessment = z.infer<typeof FleetComplianceAssessmentSchema>;
export const FleetPartnerComplianceSnapshotSchema = z.object({ subject: FleetComplianceSubjectSchema, status: z.enum(["green", "red"]), evaluatedAt: timestamp, freshness: z.enum(["current", "cached", "unverified"]), reasons: z.array(z.object({ requirementId: z.string(), requirementVersion: positiveId, category: FleetRequirementVersionSchema.shape.category, reason: FleetComplianceFindingSchema.shape.reason, label: z.string() }).strict()), dueSoon: z.array(z.object({ requirementId: z.string(), dueAt: timestamp }).strict()) }).strict();
export type FleetPartnerComplianceSnapshot = z.infer<typeof FleetPartnerComplianceSnapshotSchema>;
export type FleetDispatchCompliance = FleetPartnerComplianceSnapshot;
export const FleetCompliancePolicySchema = z.object({
  id: z.uuid(), version: positiveId, mode: z.enum(["warn_only", "enforced"]),
  scope: z.object({ partnerId: positiveId, siteId: positiveId.nullable(), contractId: z.string().min(1).max(200).nullable(), workTypeId: positiveId.nullable() }).strict(),
  effectiveFrom: timestamp, effectiveUntil: timestamp.nullable(), checkpoints: z.array(z.enum(["detail", "reservation", "dispatch", "accept", "start", "replace", "route_change", "close", "office_submit"])).min(1).max(9),
  activatedByUserId: positiveId.nullable(), notice: z.string().trim().max(2000), existingWorkTreatment: z.enum(["preserve_capture_policy", "review_existing"]),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "enforced" && (value.activatedByUserId === null || value.notice.length === 0)) ctx.addIssue({ code: "custom", path: ["mode"], message: "Enforcement requires an explicit authorized activation and notice" });
  if (value.effectiveUntil && Date.parse(value.effectiveUntil) <= Date.parse(value.effectiveFrom)) ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "Policy end must follow start" });
});
export type FleetCompliancePolicy = z.infer<typeof FleetCompliancePolicySchema>;
export const FleetComplianceEvaluationInputSchema = z.object({ facts: FleetApplicabilityFactsSchema, members: z.array(z.object({ subject: FleetComplianceSubjectSchema, facts: FleetApplicabilityFactsSchema }).strict()).min(1), requirements: z.array(FleetRequirementVersionSchema), evidence: z.array(FleetComplianceEvidenceSchema), at: timestamp, freshness: z.enum(["current", "cached", "unverified"]).default("current") }).strict();
export type FleetComplianceEvaluationInput = z.input<typeof FleetComplianceEvaluationInputSchema>;
