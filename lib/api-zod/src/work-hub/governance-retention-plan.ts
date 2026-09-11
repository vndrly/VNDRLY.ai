import { z } from "zod/v4";
import { retentionPlanClassAggregatesSchema, retentionPlanErrorCodesSchema } from "./governance-export";
import { workHubGovernanceOwnerSchema } from "./governance-retention";

const instantSchema = z.iso.datetime({ offset: true });
export const retentionPlanCreateSchema = z.strictObject({
  operationId: z.uuid(),
  owner: workHubGovernanceOwnerSchema,
});
export const retentionPlanViewSchema = z.strictObject({
  id: z.uuid(),
  owner: workHubGovernanceOwnerSchema,
  status: z.enum(["pending", "running", "completed", "failed"]),
  policyVersion: z.number().int().positive(),
  minimumPolicyVersion: z.number().int().positive(),
  snapshotAt: instantSchema,
  classAggregates: retentionPlanClassAggregatesSchema,
  errorCodes: retentionPlanErrorCodesSchema,
  createdAt: instantSchema,
  startedAt: instantSchema.nullable(),
  finishedAt: instantSchema.nullable(),
});
export type RetentionPlanCreate = z.infer<typeof retentionPlanCreateSchema>;
export type RetentionPlanView = z.infer<typeof retentionPlanViewSchema>;
