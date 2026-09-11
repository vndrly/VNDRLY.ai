import { z } from "zod/v4";
import { retentionRulesSchema } from "./governance-export";

const operationIdSchema = z.uuid();
export const workHubGovernanceOwnerSchema = z.strictObject({
  type: z.enum(["vendor", "partner"]),
  id: z.number().int().positive().max(2_147_483_647),
});
export const RETENTION_SUBJECT_TYPES = [
  "organization",
  "channel",
  "meeting_occurrence",
] as const;
const organizationSubjectIdSchema = z
  .string()
  .regex(
    /^[1-9]\d*$/,
    "Organization ID must be a canonical positive decimal string",
  )
  .refine(
    (value) => Number(value) <= 2_147_483_647,
    "Organization ID is outside the supported range",
  );
export const retentionSubjectSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("organization"),
    id: organizationSubjectIdSchema,
  }),
  z.strictObject({ type: z.literal("channel"), id: z.uuid() }),
  z.strictObject({ type: z.literal("meeting_occurrence"), id: z.uuid() }),
]);
export const retentionPolicyCreateSchema = z.strictObject({
  operationId: operationIdSchema,
  owner: workHubGovernanceOwnerSchema,
  rules: retentionRulesSchema,
});
export const retentionMinimumCreateSchema = z.strictObject({
  operationId: operationIdSchema,
  rules: retentionRulesSchema,
});
export const legalHoldCreateSchema = z.strictObject({
  operationId: operationIdSchema,
  owner: workHubGovernanceOwnerSchema,
  subject: retentionSubjectSchema,
  reason: z.string().trim().min(1).max(1_000),
});
export const legalHoldReleaseSchema = z.strictObject({
  operationId: operationIdSchema,
  holdId: z.uuid(),
});
const instantSchema = z.iso.datetime({ offset: true });
export const retentionPolicyViewSchema = z.strictObject({
  id: z.uuid(),
  owner: workHubGovernanceOwnerSchema,
  policyVersion: z.number().int().positive(),
  minimumPolicyVersion: z.number().int().positive().optional(),
  rules: retentionRulesSchema,
  createdAt: instantSchema,
});
export const retentionMinimumViewSchema = z.strictObject({
  id: z.uuid(),
  policyVersion: z.number().int().positive(),
  rules: retentionRulesSchema,
  createdAt: instantSchema,
});
export const legalHoldViewSchema = z.strictObject({
  id: z.uuid(),
  owner: workHubGovernanceOwnerSchema,
  subject: retentionSubjectSchema,
  reason: z.string().trim().min(1).max(1_000),
  active: z.boolean(),
  createdAt: instantSchema,
  releasedAt: instantSchema.nullable(),
});
export type WorkHubGovernanceOwner = z.infer<
  typeof workHubGovernanceOwnerSchema
>;
export type RetentionSubject = z.infer<typeof retentionSubjectSchema>;
export type RetentionPolicyCreate = z.infer<typeof retentionPolicyCreateSchema>;
export type RetentionMinimumCreate = z.infer<
  typeof retentionMinimumCreateSchema
>;
export type LegalHoldCreate = z.infer<typeof legalHoldCreateSchema>;
export type LegalHoldRelease = z.infer<typeof legalHoldReleaseSchema>;
