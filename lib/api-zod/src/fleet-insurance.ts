import { z } from "zod/v4";
import { FleetExactDecimalSchema } from "./fleet-pricing";
const timestamp = z.iso.datetime({ offset: true }),
  positiveId = z.number().int().positive();
const money = FleetExactDecimalSchema.refine(
  (value) => !value.startsWith("-"),
  "Nonnegative exact USD limit required",
);
export const FleetCoverageTypeSchema = z.enum([
  "auto_liability",
  "cargo",
  "pollution",
  "general_liability",
  "physical_damage",
  "workers_compensation",
  "excess",
]);
/** Private reviewer record. Operational clients receive only the projection;
 * neither a COI upload nor a schedule establishes reviewed insurance coverage. */
export const FleetInsuranceCoverageSchema = z
  .object({
    id: z.uuid(),
    revision: positiveId,
    policyNumber: z.string().trim().min(1).max(200),
    insuredLegalEntity: z.string().trim().min(1).max(300),
    privateDocumentRef: z.string().trim().min(1).max(1000).nullable(),
    coverageType: FleetCoverageTypeSchema,
    state: z.enum([
      "document_received",
      "reviewed",
      "verified",
      "revoked",
      "cancelled",
      "failed",
    ]),
    reviewedByUserId: positiveId.nullable(),
    reviewedAt: timestamp.nullable(),
    validFrom: timestamp.nullable(),
    validUntil: timestamp.nullable(),
    carrierIds: z.array(positiveId).min(1).max(100).nullable(),
    states: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(60)
      .nullable(),
    cargoCodes: z.array(z.string().trim().min(1).max(100)).max(100).nullable(),
    equipmentIds: z.array(z.uuid()).max(500).nullable(),
    scopesReviewed: z.boolean(),
    limitUSD: money,
    filingStatus: z.enum([
      "unverified",
      "not_required",
      "pending",
      "accepted",
      "cancelled",
    ]),
    filingVerifiedAt: timestamp.nullable(),
    underlyingPolicyId: z.uuid().nullable(),
    attachmentPointUSD: money.nullable(),
    followFormReviewed: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.validFrom &&
      value.validUntil &&
      Date.parse(value.validUntil) <= Date.parse(value.validFrom)
    )
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Coverage end must follow start",
      });
  });
export type FleetInsuranceCoverage = z.infer<
  typeof FleetInsuranceCoverageSchema
>;
export const FleetInsuranceWorkScopeSchema = z
  .object({
    carrierId: positiveId,
    states: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(60),
    cargoCode: z.string().trim().min(1).max(100),
    equipmentIds: z.array(z.uuid()).min(1).max(500),
    coverageType: FleetCoverageTypeSchema.exclude(["excess"]),
    requiredLimitUSD: money,
    requirementReference: z.string().trim().min(1).max(200),
    filingRequired: z.boolean(),
    startAt: timestamp,
    endAt: timestamp.nullable(),
    evaluatedAt: timestamp,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endAt && Date.parse(value.endAt) <= Date.parse(value.startAt))
      ctx.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Run end must follow start",
      });
  });
export type FleetInsuranceWorkScope = z.infer<
  typeof FleetInsuranceWorkScopeSchema
>;
export const FleetCoverageAssessmentSchema = z
  .object({
    status: z.enum(["green", "red"]),
    reasons: z.array(
      z.enum([
        "missing",
        "unverified",
        "revoked",
        "cancelled",
        "failed",
        "expired",
        "not_yet_effective",
        "carrier_mismatch",
        "territory_mismatch",
        "cargo_mismatch",
        "equipment_mismatch",
        "filing_unverified",
        "insufficient_limit",
        "layer_unverified",
        "run_window_unverified",
        "evidence_identity_conflict",
      ]),
    ),
    recordIds: z.array(z.uuid()),
    recordRefs: z.array(
      z.object({ id: z.uuid(), revision: positiveId }).strict(),
    ),
    limitUSD: z.string().nullable(),
    evaluatedAt: timestamp,
    requirementReference: z.string().min(1).max(200),
  })
  .strict();
export type FleetCoverageAssessment = z.infer<
  typeof FleetCoverageAssessmentSchema
>;
export const FleetInsuranceOperationalProjectionSchema = z
  .object({
    recordId: z.uuid(),
    revision: positiveId,
    coverageType: FleetCoverageTypeSchema,
    status: FleetCoverageAssessmentSchema.shape.status,
    reasons: FleetCoverageAssessmentSchema.shape.reasons,
    evaluatedAt: timestamp,
  })
  .strict();
