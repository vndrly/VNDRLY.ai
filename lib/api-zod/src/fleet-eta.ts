import { z } from "zod/v4";
const base = {
  runId: z.uuid(),
  truckSafeRouting: z.literal(false),
  physicalProofVerified: z.literal(false),
};
export const FleetEtaSchema = z.discriminatedUnion("ok", [
  z.object({ ...base, ok: z.literal(false), code: z.string() }),
  z.object({
    ...base,
    ok: z.literal(true),
    stopId: z.uuid(),
    siteId: z.number().int().positive(),
    siteName: z.string(),
    provider: z.literal("mapbox"),
    trafficAware: z.boolean(),
    routeConfidence: z.enum(["high", "medium", "low"]),
    distanceMiles: z.number().nonnegative(),
    durationMinutes: z.number().nonnegative(),
    estimatedAt: z.iso.datetime(),
    source: z.literal("driver_phone"),
    sourceRecordedAt: z.iso.datetime(),
    sourceReceivedAt: z.iso.datetime(),
    sourceAccuracyMeters: z.number().nonnegative(),
  }),
]);
export type FleetEta = z.infer<typeof FleetEtaSchema>;
