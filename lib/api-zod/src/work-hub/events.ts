import { z } from "zod/v4";
import { workHubContextRefSchema, workHubOwnerSchema } from "./common";

export const workHubEventEnvelopeSchema = z.object({
  version: z.literal(1),
  sequence: z.number().int().nonnegative(),
  type: z.string().regex(/^work_hub\.[a-z0-9_.]+$/),
  owner: workHubOwnerSchema,
  context: workHubContextRefSchema,
  subject: z.object({
    type: z.string().trim().min(1).max(80),
    id: z.union([z.string().uuid(), z.number().int().positive()]),
  }),
  recipientUserId: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
});

export type WorkHubEventEnvelope = z.infer<typeof workHubEventEnvelopeSchema>;
