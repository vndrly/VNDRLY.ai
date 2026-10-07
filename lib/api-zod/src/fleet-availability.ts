import { z } from "zod/v4";
import { FleetScheduleSchema } from "./fleet-planning";

export const FleetAvailabilitySchema = z
  .object({
    window: FleetScheduleSchema.nullable(),
    state: z.enum([
      "not_requested",
      "recorded_available",
      "recorded_unavailable",
      "recorded_conflict",
      "unknown_no_window",
      "unknown_recurrence",
    ]),
    blockers: z
      .array(
        z.enum([
          "unavailable",
          "shift",
          "accepted_meeting",
          "recurrence",
          "no_covering_window",
        ]),
      )
      .max(5),
    physicalReadinessVerified: z.literal(false),
  })
  .strict();
export type FleetAvailability = z.infer<typeof FleetAvailabilitySchema>;

export const FleetAvailabilityInputSchema = z
  .object({
    operationId: z.uuid(),
    driverUserId: z.number().int().positive(),
    recordId: z.uuid().nullable(),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    window: FleetScheduleSchema,
    available: z.boolean(),
  })
  .strict();
export const FleetAvailabilityRecordSchema = z
  .object({
    id: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    available: z.boolean(),
    recurring: z.boolean(),
  })
  .strict();
export const FleetAvailabilityReadSchema = z
  .object({
    driverUserId: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(FleetAvailabilityRecordSchema).max(100),
    canManage: z.boolean(),
    physicalReadinessVerified: z.literal(false),
  })
  .strict();
export const FleetAvailabilityReceiptSchema = z
  .object({
    operationId: z.uuid(),
    actorUserId: z.number().int().positive(),
    companyId: z.number().int().positive(),
    driverUserId: z.number().int().positive(),
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    previousFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    resultingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    record: FleetAvailabilityRecordSchema,
    recordedAt: z.iso.datetime(),
    physicalReadinessVerified: z.literal(false),
  })
  .strict();
export const FleetAvailabilityReadbackSchema = z
  .object({ receipt: FleetAvailabilityReceiptSchema.nullable() })
  .strict();
