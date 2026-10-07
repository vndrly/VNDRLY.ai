import { z } from "zod/v4";
export const FleetCargoMarkerSchema = z
  .object({
    transferId: z.uuid(),
    otherRunId: z.uuid(),
    otherLoadId: z.uuid(),
    recordedAt: z.iso.datetime(),
    source: z.literal("user_report"),
    physicalHandoffVerified: z.literal(false),
  })
  .strict();
export const FleetCargoTransferInputSchema = z
  .object({
    operationId: z.uuid(),
    sourceRunId: z.uuid(),
    targetRunId: z.uuid(),
    sourceExpectedVersion: z.number().int().positive(),
    targetExpectedVersion: z.number().int().positive(),
    sourceLoadId: z.uuid(),
    targetLoadId: z.uuid(),
    siteId: z.number().int().positive(),
    targetDeliveryStopId: z.uuid(),
    quantity: z.number().positive().finite(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const FleetCargoTransferActionSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    sourceExpectedVersion: z.number().int().positive(),
    targetExpectedVersion: z.number().int().positive(),
    action: z.enum([
      "acknowledge_source",
      "acknowledge_target",
      "complete",
      "cancel",
    ]),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();
export const FleetCargoTransferSchema = z
  .object({
    id: z.uuid(),
    companyId: z.number().int().positive(),
    sourceRunId: z.uuid(),
    targetRunId: z.uuid(),
    sourceLoadId: z.uuid(),
    targetLoadId: z.uuid(),
    targetDeliveryStopId: z.uuid(),
    siteId: z.number().int().positive(),
    quantity: z.number().positive().finite(),
    unit: z.string(),
    commodity: z.string(),
    reason: z.string(),
    sourceDriverUserId: z.number().int().positive(),
    targetDriverUserId: z.number().int().positive(),
    sourceRunVersion: z.number().int().positive(),
    targetRunVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    status: z.enum(["proposed", "completed", "cancelled"]),
    sourceAcknowledgedBy: z.number().int().positive().nullable(),
    targetAcknowledgedBy: z.number().int().positive().nullable(),
    recordedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    originalCapture: z
      .object({
        manifestReference: z.string(),
        recordedAt: z.iso.datetime(),
        recordedByUserId: z.number().int().positive(),
        source: z.literal("user_report"),
        manifestValues: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    events: z
      .array(
        z.object({
          operationId: z.uuid(),
          action: z.string(),
          actorUserId: z.number().int().positive(),
          recordedAt: z.iso.datetime(),
          notes: z.string(),
        }),
      )
      .max(10),
    source: z.literal("user_report"),
    physicalHandoffVerified: z.literal(false),
    inventoryCustodyChanged: z.literal(false),
    allowedActions: z.array(FleetCargoTransferActionSchema.shape.action),
  })
  .strict();
export type FleetCargoTransfer = z.infer<typeof FleetCargoTransferSchema>;
