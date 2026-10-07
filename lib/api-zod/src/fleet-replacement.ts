import { z } from "zod/v4";
import type { FleetRun } from "./fleet";

export const FleetReplacementInputSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    vehicleAssetId: z.uuid(),
    trailerAssetId: z.uuid().nullable(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const FleetReplacementActionSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    runExpectedVersion: z.number().int().positive(),
    action: z.enum(["accept", "cancel"]),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();
export const FleetReplacementMarkerSchema = z
  .object({
    replacementId: z.uuid(),
    acceptedAt: z.iso.datetime(),
    priorVehicleAssetId: z.uuid(),
    priorTrailerAssetId: z.uuid().nullable(),
    inspectionCount: z.number().int().min(0).max(100),
    recordCount: z.number().int().min(0).max(200),
  })
  .strict();
export const FleetReplacementSchema = z
  .object({
    id: z.uuid(),
    companyId: z.number().int().positive(),
    runId: z.uuid(),
    driverUserId: z.number().int().positive(),
    priorVehicleAssetId: z.uuid(),
    priorTrailerAssetId: z.uuid().nullable(),
    vehicleAssetId: z.uuid(),
    trailerAssetId: z.uuid().nullable(),
    runVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    status: z.enum(["proposed", "accepted", "cancelled"]),
    reason: z.string(),
    proposedByUserId: z.number().int().positive(),
    recordedAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().nullable(),
    acceptedByUserId: z.number().int().positive().nullable(),
    source: z.literal("user_report"),
    inventoryCustodyChanged: z.literal(false),
    physicalExchangeVerified: z.literal(false),
    events: z
      .array(
        z.object({
          operationId: z.uuid(),
          action: z.string(),
          actorUserId: z.number().int().positive(),
          notes: z.string(),
          recordedAt: z.iso.datetime(),
        }),
      )
      .max(3),
    allowedActions: z.array(z.enum(["accept", "cancel"])),
  })
  .strict();
export type FleetReplacement = z.infer<typeof FleetReplacementSchema>;

/** Checks recorded replacement facts only; current authority/custody/holds remain server checks. */
export function fleetReplacementReady(run: FleetRun): boolean {
  const marker = run.activeReplacement;
  if (!marker) return true;
  const inspection = run.inspections.at(-1);
  return (
    run.inspections.length > marker.inspectionCount &&
    !!inspection &&
    inspection.outcome === "passed" &&
    inspection.driverUserId === run.driverUserId &&
    inspection.vehicleAssetId === run.vehicleAssetId &&
    inspection.trailerAssetId === run.trailerAssetId &&
    inspection.recordedAt >= marker.acceptedAt &&
    run.records
      .slice(marker.recordCount)
      .some(
        (record) =>
          record.kind === "meter" &&
          record.vehicleAssetId === run.vehicleAssetId &&
          ["miles", "kilometers"].includes(record.unit) &&
          record.recordedAt >= marker.acceptedAt,
      )
  );
}
