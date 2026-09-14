import { z } from "zod/v4";
import { ImplementationAOwnerSchema } from "./common";

export const IMPLEMENTATION_A_EVENT_TYPES = [
  "capability.changed",
  "workforce.assignment.changed",
  "workforce.coverage.changed",
  "asset.custody.changed",
  "trip.presence.changed",
  "safety.incident.changed",
  "subscription.changed",
  "display.changed",
] as const;

export const ImplementationAEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(IMPLEMENTATION_A_EVENT_TYPES),
  owner: ImplementationAOwnerSchema,
  occurredAt: z.iso.datetime(),
  operationId: z.string().uuid().optional(),
  actorUserId: z.number().int().positive().nullable(),
  subjectType: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type ImplementationAEvent = z.infer<typeof ImplementationAEventSchema>;
