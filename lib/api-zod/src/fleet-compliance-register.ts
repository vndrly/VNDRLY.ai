import { z } from "zod/v4";
import {
  FleetComplianceEvidenceSchema,
  FleetComplianceSubjectSchema,
  FleetRequirementVersionSchema,
  FleetComplianceFindingSchema,
} from "./fleet-compliance";
import { FleetInsuranceCoverageSchema } from "./fleet-insurance";
const timestamp = z.iso.datetime({ offset: true });
const text = z.string().trim().min(1).max(500);
const state = z.string().regex(/^[A-Z]{2}$/);
export const FleetComplianceReviewSourceSchema = z
  .object({
    kind: z.enum([
      "government_registry",
      "qualified_examiner",
      "insurer_confirmation",
      "qualified_reviewer",
      "employer_record",
      "ELD_record",
    ]),
    reference: text,
    url: z
      .url()
      .refine((value) => value.startsWith("https://"), "HTTPS source required")
      .nullable(),
  })
  .strict();
const attributes = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("driver_license"),
      issuingState: state.nullable(),
      licenseNumber: text.nullable(),
      licenseClass: z.enum(["A", "B", "C", "other"]).nullable(),
      endorsements: z.array(text).max(30),
      restrictions: z.array(text).max(30),
      licenseStatus: z.enum([
        "active",
        "expired",
        "suspended",
        "revoked",
        "unverified",
      ]),
      sourceRecordId: text.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("driver_medical"),
      qualification: z.enum([
        "qualified",
        "not_qualified",
        "pending",
        "unverified",
      ]),
      examinerReference: text.nullable(),
      restrictions: z.array(text).max(30),
    })
    .strict(),
  z
    .object({
      kind: z.literal("driver_testing"),
      program: z.enum(["DOT", "non_DOT"]).nullable(),
      result: z.enum(["eligible", "prohibited", "pending", "unverified"]),
      clearinghouseConsentAt: timestamp.nullable(),
      queryReference: text.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("driver_qualification"),
      check: z.enum([
        "DQ_file",
        "MVR",
        "road_test",
        "training",
        "annual_review",
        "employment_history",
      ]),
      result: z.enum([
        "satisfactory",
        "unsatisfactory",
        "pending",
        "unverified",
      ]),
      sourceRecordId: text.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("duty"),
      source: z.enum([
        "ELD",
        "reviewed_paper_log",
        "driver_report",
        "unavailable",
      ]),
      dutyStatus: z.enum(["available", "unavailable", "unknown"]),
      asOf: timestamp,
      sourceRecordId: text.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("insurance"),
      coverage: FleetInsuranceCoverageSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("credential"),
      credentialType: text,
      reference: text.nullable(),
      issuingAuthority: text.nullable(),
      states: z.array(state).max(60),
      cargoCodes: z.array(text).max(100),
    })
    .strict(),
]);
/** This entire record is private. Never serialize it into an ordinary asset,
 * vendor, audit input/output, run, assistant transcript, or partner projection. */
export const FleetComplianceRecordSchema = z
  .object({
    evidence: FleetComplianceEvidenceSchema,
    review: z
      .object({
        source: FleetComplianceReviewSourceSchema,
        reviewedAt: timestamp,
        reportedReviewedAt: timestamp,
        reviewerUserId: z.number().int().positive(),
        filingSource: FleetComplianceReviewSourceSchema.nullable(),
      })
      .strict()
      .optional(),
    attributes,
    retentionClass: z.enum([
      "qualification",
      "medical",
      "testing",
      "insurance",
      "maintenance",
      "authority",
      "trip",
    ]),
    retainUntil: timestamp.nullable(),
    legalHold: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.attributes.kind.startsWith("driver_") ||
      value.attributes.kind === "duty"
    ) {
      if (value.evidence.subject.kind !== "driver")
        ctx.addIssue({
          code: "custom",
          path: ["evidence", "subject"],
          message: "Driver evidence requires a driver subject",
        });
    }
    if (value.attributes.kind === "insurance") {
      const coverage = value.attributes.coverage;
      if (
        value.evidence.subject.kind !== "carrier" ||
        coverage.id !== value.evidence.id ||
        coverage.revision !== value.evidence.revision ||
        coverage.state !== value.evidence.status ||
        coverage.reviewedAt !== value.evidence.verifiedAt ||
        coverage.reviewedByUserId !== value.evidence.verifiedByUserId ||
        coverage.validFrom !== value.evidence.validFrom ||
        coverage.validUntil !== value.evidence.validUntil ||
        coverage.privateDocumentRef !== value.evidence.privateDocumentRef
      )
        ctx.addIssue({
          code: "custom",
          path: ["attributes"],
          message:
            "Coverage must bind to the same carrier evidence revision and review",
        });
    }
  });
export type FleetComplianceRecord = z.infer<typeof FleetComplianceRecordSchema>;
export const FleetComplianceSaveSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    record: FleetComplianceRecordSchema,
    preserveExistingRetention: z.boolean().optional(),
    reusePriorDocument: z.boolean().optional(),
    mapUnmappedRequirement: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const evidence = value.record.evidence;
    if((value.preserveExistingRetention||value.reusePriorDocument||value.mapUnmappedRequirement)&&value.expectedVersion===0)ctx.addIssue({code:"custom",message:"Renewal options require an existing source revision"});
    if(value.reusePriorDocument&&evidence.privateDocumentRef!==null)ctx.addIssue({code:"custom",message:"Choose a new document or explicitly reuse the prior document"});
    if (value.record.review)
      ctx.addIssue({
        code: "custom",
        path: ["record", "review"],
        message: "Uploads cannot assert private reviewer metadata",
      });
    if (
      evidence.revision !== value.expectedVersion + 1 ||
      evidence.status !== "document_received" ||
      evidence.verifiedAt !== null ||
      evidence.verifiedByUserId !== null
    )
      ctx.addIssue({
        code: "custom",
        path: ["record", "evidence"],
        message:
          "Uploads are an unverified next revision; use designated review to verify",
      });
    const attr = value.record.attributes;
    if (
      attr.kind === "insurance" &&
      (attr.coverage.scopesReviewed ||
        attr.coverage.followFormReviewed ||
        attr.coverage.filingVerifiedAt !== null ||
        ["accepted", "not_required"].includes(attr.coverage.filingStatus))
    )
      ctx.addIssue({
        code: "custom",
        path: ["record", "attributes"],
        message: "Uploads cannot assert reviewed coverage or accepted filings",
      });
  });
export const FleetComplianceVerifySchema = z
  .object({
    operationId: z.uuid(),
    evidenceId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["reviewed", "verified", "revoked", "failed"]),
    source: FleetComplianceReviewSourceSchema,
    reviewedAt: timestamp,
    coverageReview: z
      .object({
        scopesReviewed: z.boolean(),
        followFormReviewed: z.boolean(),
        filingStatus: z.enum([
          "unverified",
          "not_required",
          "pending",
          "accepted",
          "cancelled",
        ]),
        filingSource: FleetComplianceReviewSourceSchema.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict().superRefine((value,ctx)=>{
    const filing=value.coverageReview;
    if(!filing)return;
    if(["accepted","cancelled","not_required"].includes(filing.filingStatus)&&!filing.filingSource)
      ctx.addIssue({code:"custom",path:["coverageReview","filingSource"],message:"A separately identified filing source is required"});
    if(["accepted","cancelled"].includes(filing.filingStatus)&&filing.filingSource&&!['government_registry','insurer_confirmation'].includes(filing.filingSource.kind))
      ctx.addIssue({code:"custom",path:["coverageReview","filingSource"],message:"Filing acceptance or cancellation requires a registry or insurer source"});
  });
export const FleetComplianceIndexEntrySchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    subject: FleetComplianceSubjectSchema,
    requirementId: text,
    requirementVersion: z.number().int().positive(),
    status: FleetComplianceEvidenceSchema.shape.status,
    validFrom: timestamp.nullable(),
    validUntil: timestamp.nullable(),
    verifiedAt: timestamp.nullable(),
    verifiedByUserId: z.number().int().positive().nullable(),
    attributeKind: attributes.options[0].shape.kind.or(
      z.enum([
        "driver_medical",
        "driver_testing",
        "driver_qualification",
        "duty",
        "insurance",
        "credential",
      ]),
    ),
    objectPath: z
      .string()
      .regex(
        /^\/objects\/fleet-compliance-private\/[0-9]+\/[0-9a-f-]+\/[0-9]+\/[0-9a-f]{64}$/,
      ),
    updatedAt: timestamp,
  })
  .strict();
export type FleetComplianceIndexEntry = z.infer<
  typeof FleetComplianceIndexEntrySchema
>;
/** Only operational classification facts belong here. Clinical/testing details
 * are intentionally not accepted as arbitrary key/value applicability data. */
export const FleetComplianceFactsSchema = z
  .object({
    interstate: z.boolean().nullable().optional(),
    forHire: z.boolean().nullable().optional(),
    cmv: z.boolean().nullable().optional(),
    cdlRequired: z.boolean().nullable().optional(),
    medicalRequired: z.boolean().nullable().optional(),
    testingRequired: z.boolean().nullable().optional(),
    hoursRulesApply: z.boolean().nullable().optional(),
    tankRequired: z.boolean().nullable().optional(),
    usdotRequired: z.boolean().nullable().optional(),
    txCarrierRegistrationRequired: z.boolean().nullable().optional(),
    okCarrierAuthorityRequired: z.boolean().nullable().optional(),
    periodicInspectionRequired: z.boolean().nullable().optional(),
    driverQualificationRequired: z.boolean().nullable().optional(),
    placarded: z.boolean().nullable().optional(),
    state: state.nullable().optional(),
    states: z.array(state).min(1).max(60).nullable().optional(),
    insuredLegalEntity: text.nullable().optional(),
    cargoCode: text.nullable().optional(),
    hazmatClass: text.nullable().optional(),
    gvwrLb: z.number().int().nonnegative().nullable().optional(),
    gcwrLb: z.number().int().nonnegative().nullable().optional(),
    trailerGvwrLb: z.number().int().nonnegative().nullable().optional(),
    passengers: z.number().int().nonnegative().nullable().optional(),
    carrierId: z.number().int().positive().nullable().optional(),
    vehicleAssetId: z.uuid().nullable().optional(),
  })
  .strict();
export const FleetComplianceFactRecordSchema = z
  .object({
    subject: FleetComplianceSubjectSchema,
    version: z.number().int().positive(),
    facts: FleetComplianceFactsSchema,
    reviewedAt: timestamp,
    reviewedByUserId: z.number().int().positive(),
    sourceKind: FleetComplianceReviewSourceSchema.shape.kind,
    workScopeFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    sourceObjectPath: z
      .string()
      .startsWith("/objects/fleet-compliance-private/"),
  })
  .strict();
export const FleetComplianceFactsViewSchema=FleetComplianceFactRecordSchema.omit({sourceObjectPath:true});
export const FleetComplianceRequirementsViewSchema=z.object({requirements:z.array(FleetRequirementVersionSchema),canAdopt:z.boolean(),mode:z.literal("warn_only")}).strict();
export const FleetComplianceFactsSaveSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    subject: FleetComplianceSubjectSchema,
    facts: FleetComplianceFactsSchema,
    source: FleetComplianceReviewSourceSchema,
  })
  .strict();
export const FleetComplianceConfigurationSchema = z
  .object({
    version: z.number().int().positive(),
    reviewerUserIds: z.array(z.number().int().positive()).max(100),
    entries: z.array(FleetComplianceIndexEntrySchema),
    requirements: z.array(FleetRequirementVersionSchema).default([]),
    facts: z.array(FleetComplianceFactRecordSchema).default([]),
  })
  .strict();
const { source: _source, ...requirementFields } =
  FleetRequirementVersionSchema.shape;
export const FleetComplianceRequirementAdoptSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    requirement: z
      .object({
        ...requirementFields,
        source: z
          .object({
            url: z.url().refine((value) => value.startsWith("https://")),
            section: z.string().trim().min(1).max(500),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export const FleetComplianceSubjectsQuerySchema = z
  .object({ subjects: z.array(FleetComplianceSubjectSchema).min(1).max(100) })
  .strict();
export const FleetComplianceReviewerSaveSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    reviewerUserIds: z.array(z.number().int().positive()).max(100),
  })
  .strict();
export const FleetComplianceRegisterQuerySchema = z
  .object({
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    subjectKind: FleetComplianceSubjectSchema.options[0].shape.kind
      .or(z.enum(["driver", "vehicle", "component", "trip"]))
      .optional(),
    subjectId: z.string().max(100).optional(),
  })
  .strict();
export const FleetComplianceOperationalEntrySchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    subject: FleetComplianceSubjectSchema,
    requirementId: text,
    requirementVersion: z.number().int().positive(),
    kind: FleetComplianceIndexEntrySchema.shape.attributeKind,
    verification: FleetComplianceEvidenceSchema.shape.status,
    status: z.enum(["green", "red"]),
    reasons: z.array(FleetComplianceFindingSchema.shape.reason),
    validUntil: timestamp.nullable(),
    evaluatedAt: timestamp,
    maskedIdentifier: z
      .string()
      .refine(
        (value) => value.startsWith("••••") && value.length === 8,
        "Only four masked trailing characters permitted",
      )
      .nullable(),
    mayReview: z.boolean(),
  })
  .strict();
export type FleetComplianceOperationalEntry = z.infer<
  typeof FleetComplianceOperationalEntrySchema
>;
export const FleetComplianceRegisterPageSchema = z
  .object({
    entries: z.array(FleetComplianceOperationalEntrySchema),
    nextCursor: z.uuid().nullable(),
    mode: z.literal("warn_only"),
  })
  .strict();
export const FleetComplianceConfigurationViewSchema = z
  .object({
    version: z.number().int().positive(),
    isReviewer: z.boolean(),
    mayAppointReviewers: z.boolean(),
    reviewerUserIds: z.array(z.number().int().positive()),
  })
  .strict();
export const FleetComplianceRecordReceiptSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    subject: FleetComplianceSubjectSchema,
    status: FleetComplianceEvidenceSchema.shape.status,
    updatedAt: timestamp,
  })
  .strict();
export const FleetComplianceSubjectChoicesQuerySchema = z.object({
  kind: z.enum(["carrier", "driver", "vehicle", "component", "trip"]),
  search: z.string().trim().max(120).default(""),
  after: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((value, ctx) => {
  if (value.after !== undefined && (value.kind === "carrier" || !(value.kind === "driver" ? /^[1-9]\d*$/.test(value.after) && Number.isSafeInteger(Number(value.after)) : z.uuid().safeParse(value.after).success))) ctx.addIssue({code:"custom",path:["after"],message:"Cursor must match the subject identity"});
});
export const FleetComplianceSubjectChoicesPageSchema = z.object({
  entries: z.array(z.object({ subject: FleetComplianceSubjectSchema, label: z.string().min(1).max(500), canSubmit: z.boolean() }).strict()).max(100),
  nextCursor: z.string().max(100).nullable(),
}).strict();
export const FleetComplianceDocumentUploadSchema = z.object({
  operationId: z.uuid(), subject: FleetComplianceSubjectSchema, recordId: z.uuid(),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  bodyBase64: z.string().min(1).max(14_000_000),
}).strict();
export const FleetComplianceDocumentAuthorizationSchema=z.object({recordId:z.uuid(),subject:FleetComplianceSubjectSchema,expectedRecordVersion:z.number().int().nonnegative()}).strict();
export const FleetComplianceDocumentReceiptSchema = z.object({objectPath:z.string().regex(/^\/objects\/fleet-compliance-private\/[0-9]+\/[0-9a-f-]{36}\/documents\/[0-9a-f]{64}$/)}).strict();
export const FleetComplianceSourceContextSchema=z.object({
 id:z.uuid(),revision:z.number().int().positive(),subject:FleetComplianceSubjectSchema,
 attributeKind:FleetComplianceIndexEntrySchema.shape.attributeKind,requirementId:z.string().min(1).max(160),requirementVersion:z.number().int().positive(),
 label:z.string().min(1).max(500),hasDocument:z.boolean(),canSubmit:z.boolean(),coverageType:FleetInsuranceCoverageSchema.shape.coverageType.nullable(),
}).strict();
