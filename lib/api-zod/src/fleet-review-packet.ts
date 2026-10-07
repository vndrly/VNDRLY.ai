import { z } from "zod/v4";
export const FleetReviewPacketSchema = z.object({
  runId: z.uuid(),
  runVersion: z.number().int().positive(),
  status: z.string(),
  requirements: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(["photo", "scale", "receipt", "signature"]),
      scope: z.enum(["run", "each_load"]),
      required: z.boolean(),
      loadId: z.uuid().nullable(),
      evidenceIds: z.array(z.uuid()),
      missing: z.boolean(),
    }),
  ),
  missingRequiredCount: z.number().int().nonnegative(),
  readyForOperationalReview: z.boolean(),
  inspectionComplete: z.boolean(),
  manifestComplete: z.boolean(),
  closeoutRecordsComplete: z.boolean(),
  inspectionExceptions: z.number().int().nonnegative(),
  undeliveredLoadCount: z.number().int().nonnegative(),
  source: z.literal("recorded_fleet_records"),
  physicalProofVerified: z.literal(false),
  signatureIdentityVerified: z.literal(false),
  limitations: z.array(z.string()),
});
export type FleetReviewPacket = z.infer<typeof FleetReviewPacketSchema>;
