import { z } from "zod/v4";

/** Authenticated device reports, never vehicle telemetry or attested physical proof. */
export const FleetLocationInputSchema = z.object({
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  deviceId: z.string().trim().min(1).max(200),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative().max(20000).nullable(),
  speedMetersPerSecond:z.number().finite().min(0).max(100).nullable().optional(),
  speedAccuracyMetersPerSecond:z.number().finite().min(0).max(100).nullable().optional(),
  headingDegrees:z.number().finite().min(0).max(360).nullable().optional(),
  recordedAt: z.iso.datetime(),
}).strict();
export type FleetLocationInput = z.infer<typeof FleetLocationInputSchema>;
export const FleetLocationObservationSchema = z.object({
  runId: z.uuid(), vehicleAssetId: z.uuid(), driverUserId: z.number().int().positive(),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative().nullable(),
  speedMetersPerSecond:z.number().finite().min(0).max(100).nullable().optional(),
  speedAccuracyMetersPerSecond:z.number().finite().min(0).max(100).nullable().optional(),
  headingDegrees:z.number().finite().min(0).max(360).nullable().optional(),
  recordedAt: z.iso.datetime(), receivedAt: z.iso.datetime(),
  source: z.literal("driver_phone"),
  freshness: z.enum(["recent", "stale", "paused", "unavailable"]),
  physicalProofVerified: z.literal(false),
}).strict();
export type FleetLocationObservation = z.infer<typeof FleetLocationObservationSchema>;

const locationCursor = z.string().regex(/^\d{1,10}:\d{1,10}$/);
export const FleetLocationPageQuerySchema = z.object({
  cursor: locationCursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
}).strict();
export const FleetLocationObservationPageSchema = z.object({
  observations: z.array(FleetLocationObservationSchema).max(50),
  page: z.object({
    limit: z.number().int().min(1).max(50),
    nextCursor: locationCursor.nullable(),
  }).strict(),
}).strict();
export type FleetLocationObservationPage = z.infer<typeof FleetLocationObservationPageSchema>;
