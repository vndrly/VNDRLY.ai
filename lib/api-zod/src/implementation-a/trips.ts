import { z } from "zod/v4";
import { ImplementationAOwnerSchema } from "./common";

export const StartFieldTripSchema = z.object({
  operationId: z.string().uuid(),
  owner: ImplementationAOwnerSchema,
  driverUserId: z.number().int().positive(),
  vehicleAssetId: z.string().uuid().nullable().default(null),
  assignmentId: z.string().trim().min(1).max(200).nullable().default(null),
  siteLocationId: z.number().int().positive(),
  destinationSource: z.enum(["assignment", "inferred", "confirmed"]),
  activeShiftId: z.string().uuid().nullable().default(null),
});

export const UpdateFieldTripLocationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().max(10_000),
  speedMps: z.number().nonnegative().max(200).nullable().default(null),
  recordedAt: z.iso.datetime(),
});

export const FinalizeAutomaticPresenceSchema = z.object({
  expectedVersion: z.number().int().positive(),
  direction: z.enum(["entry", "exit"]),
  visitId: z.number().int().positive(),
  crossedAt: z.iso.datetime(),
});

export const CompleteFieldTripSchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.enum(["end_of_work", "unattended_timeout", "supervisor_confirmed"]),
  needsSupervisorConfirmation: z.boolean().default(false),
  completedAt: z.iso.datetime(),
});
