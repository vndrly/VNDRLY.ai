import { z } from "zod/v4";
const owner = z
  .object({
    type: z.enum(["vendor", "partner"]),
    id: z.number().int().positive(),
  })
  .strict();
export const WorkHubAwayCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      operationId: z.uuid(),
      action: z.literal("configure"),
      expectedVersion: z.number().int().nonnegative(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      replyText: z.string().trim().min(1).max(500),
      channelIds: z.array(z.uuid()).min(1).max(20),
    })
    .strict(),
  z
    .object({
      operationId: z.uuid(),
      action: z.enum(["pause", "revoke"]),
      expectedVersion: z.number().int().nonnegative(),
      ruleId: z.uuid(),
    })
    .strict(),
]);
export const WorkHubAwayRuleSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    userId: z.number().int().positive(),
    owner,
    status: z.enum(["active", "paused", "revoked"]),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    replyText: z.string().min(1).max(500),
    channelIds: z.array(z.uuid()).min(1).max(20),
    configuredAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const WorkHubAwayReceiptSchema = z
  .object({
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["configured", "paused", "revoked"]),
    rule: WorkHubAwayRuleSchema,
    savedAt: z.iso.datetime(),
    providerDeliveryVerified: z.literal(false),
  })
  .strict();
export const WorkHubAwayReadSchema = z
  .object({
    rule: WorkHubAwayRuleSchema.nullable(),
    version: z.number().int().nonnegative(),
    providerDeliveryVerified: z.literal(false),
  })
  .strict();
export const WorkHubAwayReadbackSchema = z
  .object({ receipt: WorkHubAwayReceiptSchema.nullable() })
  .strict();
export const WorkHubAwayChannelsSchema = z
  .object({
    channels: z
      .array(z.object({ id: z.uuid(), name: z.string() }).strict())
      .max(100),
    truncated: z.boolean(),
    source: z.literal("joined_writable_channels"),
  })
  .strict();
export type WorkHubAwayCommand = z.infer<typeof WorkHubAwayCommandSchema>;
export type WorkHubAwayRule = z.infer<typeof WorkHubAwayRuleSchema>;
export type WorkHubAwayReceipt = z.infer<typeof WorkHubAwayReceiptSchema>;
export type WorkHubAwayRead = z.infer<typeof WorkHubAwayReadSchema>;
