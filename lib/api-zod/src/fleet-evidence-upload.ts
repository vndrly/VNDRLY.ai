import { z } from "zod/v4";
import { FleetWorkScopeSchema, FleetWorkReferenceSchema } from "./fleet-work";
import {
  FleetDetailSnapshotSchema,
  FleetTimeZoneSchema,
} from "./fleet-details";
import { FleetComplianceSubjectSchema } from "./fleet-compliance";

export const FLEET_EVIDENCE_PART_BYTES = 256 * 1024;
export const FLEET_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;
const uuid = z.uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  timestamp = z.iso.datetime({ offset: true });
const contentType = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
export const FleetEvidencePartReceiptSchema = z
  .object({
    partNumber: z.number().int().min(0).max(39),
    sha256: hash,
    byteSize: z.number().int().positive().max(FLEET_EVIDENCE_PART_BYTES),
    recordedAt: timestamp,
  })
  .strict();
export type FleetEvidencePartReceipt = z.infer<
  typeof FleetEvidencePartReceiptSchema
>;
export const FleetEvidenceUploadCompletionSchema = z
  .object({
    status: z.literal("complete"),
    sessionId: uuid,
    operationId: uuid,
    evidenceId: uuid,
    byteSize: z.number().int().positive().max(FLEET_EVIDENCE_FILE_BYTES),
    sha256: hash,
    contentType,
    objectPath: z
      .string()
      .regex(/^\/objects\/(?:fleet|fleet-compliance-private)\//),
    fileUrl: z.string().nullable(),
    completedAt: timestamp,
    physicalProofVerified: z.literal(false),
    signatureIdentityVerified: z.literal(false),
  })
  .strict();
export const FleetEvidenceUploadSessionSchema = z
  .object({
    version: z.literal(2),
    id: uuid,
    operationId: uuid,
    scope: FleetWorkScopeSchema,
    fingerprint: hash,
    localEvidenceId: uuid,
    canonicalEvidenceId: uuid,
    capturedAt: timestamp,
    timeZone: FleetTimeZoneSchema,
    createdAt: timestamp,
    byteSize: z.number().int().positive().max(FLEET_EVIDENCE_FILE_BYTES),
    sha256: hash,
    contentType,
    partCount: z.number().int().min(1).max(40),
    partSize: z.literal(FLEET_EVIDENCE_PART_BYTES),
    binding: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("work"),
          activity: FleetWorkReferenceSchema.refine(
            (ref) => ref.kind === "activity",
          ),
          ticket: FleetWorkReferenceSchema.refine(
            (ref) => ref.kind === "ticket",
          ),
          assignment: FleetDetailSnapshotSchema,
          evidenceKind: z.enum(["photo", "scale", "receipt", "signature"]),
          notes: z.string().max(2000),
        })
        .strict(),
      z
        .object({
          kind: z.literal("compliance"),
          recordId: uuid,
          subject: FleetComplianceSubjectSchema,
          expectedRecordVersion: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    completion: FleetEvidenceUploadCompletionSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.partCount !== Math.ceil(value.byteSize / FLEET_EVIDENCE_PART_BYTES)
    )
      ctx.addIssue({
        code: "custom",
        message: "Part count must match the exact original length",
      });
    const completed = value.completion;
    if (
      completed &&
      (completed.sessionId !== value.id ||
        completed.operationId !== value.operationId ||
        completed.evidenceId !== value.canonicalEvidenceId ||
        completed.byteSize !== value.byteSize ||
        completed.sha256 !== value.sha256 ||
        completed.contentType !== value.contentType)
    )
      ctx.addIssue({
        code: "custom",
        message: "Completion differs from the original file identity",
      });
  });
export type FleetEvidenceUploadSession = z.infer<
  typeof FleetEvidenceUploadSessionSchema
>;
export const FleetEvidenceUploadStatusSchema = z
  .object({
    session: FleetEvidenceUploadSessionSchema,
    parts: z.array(FleetEvidencePartReceiptSchema).max(40),
    completion: FleetEvidenceUploadCompletionSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      JSON.stringify(value.completion) !==
      JSON.stringify(value.session.completion)
    )
      ctx.addIssue({
        code: "custom",
        message: "Upload status must retain its actual stored completion",
      });
    const indexes = new Set<number>();
    for (const part of value.parts) {
      const expected =
        part.partNumber === value.session.partCount - 1
          ? value.session.byteSize - part.partNumber * value.session.partSize
          : value.session.partSize;
      if (
        indexes.has(part.partNumber) ||
        part.partNumber >= value.session.partCount ||
        part.byteSize !== expected
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Acknowledged parts must have unique valid ordinals and exact lengths",
        });
      indexes.add(part.partNumber);
    }
  });
