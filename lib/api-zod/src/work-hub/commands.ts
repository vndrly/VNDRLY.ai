import { z } from "zod/v4";
import { workHubContextRefSchema, workHubOwnerSchema } from "./common";

export const workHubCommandEnvelopeSchema = z.object({
  operationId: z.string().uuid(),
  owner: workHubOwnerSchema,
  context: workHubContextRefSchema,
  expectedVersion: z.number().int().nonnegative().nullable(),
  payloadVersion: z.literal(1),
  payload: z.unknown(),
});

export const workHubCommandResultSchema = <T extends z.ZodType>(resource: T) =>
  z.object({
    operationId: z.string().uuid(),
    appliedAt: z.iso.datetime(),
    replayed: z.boolean(),
    resource,
  });

export type WorkHubCommandEnvelope<T = unknown> = Omit<
  z.infer<typeof workHubCommandEnvelopeSchema>,
  "payload"
> & { payload: T };

export type WorkHubCommandResult<T> = {
  operationId: string;
  appliedAt: string;
  replayed: boolean;
  resource: T;
};
