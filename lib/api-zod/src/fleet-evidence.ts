import { z } from "zod/v4";
export const FleetEvidenceInputSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    evidenceId: z.uuid(),
    objectPath: z.string().regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i),
    kind: z.enum(["photo", "scale", "receipt", "signature"]),
    stopId: z.uuid().optional(),
    loadId: z.uuid().optional(),
    notes: z.string().trim().min(1).max(2000),
    capturedAt: z.iso.datetime().optional(),
  })
  .strict();
export const FleetEvidenceSchema = z.object({
  evidenceId: z.uuid(),
  runId: z.uuid(),
  companyId: z.number().int().positive(),
  operationId: z.uuid(),
  runVersion: z.number().int().positive(),
  kind: FleetEvidenceInputSchema.shape.kind,
  stopId: z.uuid().nullable(),
  loadId: z.uuid().nullable(),
  notes: z.string(),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  contentType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  recordedByUserId: z.number().int().positive(),
  recordedAt: z.iso.datetime(),
  capturedAt: z.iso.datetime().nullable(),
  source: z.literal("device_upload"),
  physicalProofVerified: z.literal(false),
  signatureIdentityVerified: z.literal(false),
  fileUrl: z.string(),
});
export type FleetEvidence = z.infer<typeof FleetEvidenceSchema>;
