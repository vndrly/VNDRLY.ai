import { z } from "zod/v4";

export const IMPLEMENTATION_A_OWNER_TYPES = ["vendor", "partner"] as const;

export const ImplementationAOwnerSchema = z.object({
  type: z.enum(IMPLEMENTATION_A_OWNER_TYPES),
  id: z.number().int().positive(),
});

export const ScopedActorSchema = z.object({
  userId: z.number().int().positive(),
  owner: ImplementationAOwnerSchema,
  membershipId: z.number().int().positive(),
  sponsorshipId: z.string().uuid().optional(),
  siteIds: z.array(z.number().int().positive()).default([]),
  crewIds: z.array(z.string().uuid()).default([]),
  deviceId: z.string().trim().min(1).optional(),
});

export const OperationEnvelopeSchema = z.object({
  operationId: z.string().uuid(),
  occurredAt: z.iso.datetime(),
  deviceId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});

export const OperationReceiptStatusSchema = z.enum([
  "applied",
  "duplicate",
  "conflict",
  "queued",
]);

export const OperationReceiptSchema = <T extends z.ZodType>(resource: T) =>
  z.object({
    operationId: z.string().uuid(),
    status: OperationReceiptStatusSchema,
    resource: resource.nullable(),
    authoritativeVersion: z.number().int().nonnegative().nullable(),
  });

export type ImplementationAOwner = z.infer<typeof ImplementationAOwnerSchema>;
export type ScopedActor = z.infer<typeof ScopedActorSchema>;
export type OperationEnvelope<T = unknown> = Omit<
  z.infer<typeof OperationEnvelopeSchema>,
  "payload"
> & { payload: T };
export type OperationReceipt<T> = {
  operationId: string;
  status: z.infer<typeof OperationReceiptStatusSchema>;
  resource: T | null;
  authoritativeVersion: number | null;
};
