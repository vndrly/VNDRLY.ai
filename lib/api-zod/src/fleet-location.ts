import { z } from "zod/v4";

/** Authenticated device reports, never vehicle telemetry or attested physical proof. */
export const FleetLocationInputSchema = z.object({
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  deviceId: z.string().trim().min(1).max(200),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative().max(20000).nullable(),
  recordedAt: z.iso.datetime(),
}).strict();
export type FleetLocationInput = z.infer<typeof FleetLocationInputSchema>;
export const FleetLocationObservationSchema = z.object({
  runId: z.uuid(), vehicleAssetId: z.uuid(), driverUserId: z.number().int().positive(),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative().nullable(),
  recordedAt: z.iso.datetime(), receivedAt: z.iso.datetime(),
  source: z.literal("driver_phone"),
  freshness: z.enum(["recent", "stale", "paused", "unavailable"]),
  physicalProofVerified: z.literal(false),
}).strict();
export type FleetLocationObservation = z.infer<typeof FleetLocationObservationSchema>;
