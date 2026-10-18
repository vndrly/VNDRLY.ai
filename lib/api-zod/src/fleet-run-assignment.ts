import { z } from "zod/v4";
import {
  FleetCanonicalIdSchema,
  FleetDetailSnapshotSchema,
  FleetReservationSchema,
  FleetTimeZoneSchema,
} from "./fleet-details";

export const FleetDetailSelectionSchema = z
  .object({
    version: z.literal(2),
    detailId: FleetCanonicalIdSchema,
    detailVersion: z.number().int().positive(),
    timeZone: FleetTimeZoneSchema,
    returnPolicy: z.enum(["delivery_only", "return_required"]),
  })
  .strict();
export type FleetDetailSelection = z.infer<typeof FleetDetailSelectionSchema>;
export const FleetResourceAssignmentSchema = z
  .object({
    version: z.literal(2),
    snapshot: FleetDetailSnapshotSchema,
    reservation: FleetReservationSchema,
    returnPolicy: z.enum(["delivery_only", "return_required"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { detail, rigPackage } = value.snapshot,
      r = value.reservation;
    const ids = [
      detail.vehicleAssetId,
      ...(rigPackage?.components.map((item) => item.assetId) ?? []),
    ];
    if (
      r.detailId !== detail.id ||
      r.detailVersion !== detail.version ||
      r.driverUserId !== detail.driverUserId ||
      ids.length !== r.assetIds.length ||
      !ids.every((id) => r.assetIds.includes(id))
    )
      ctx.addIssue({
        code: "custom",
        path: ["reservation"],
        message:
          "Reservation must bind the exact Detail, driver and all canonical components",
      });
  });
export type FleetResourceAssignment = z.infer<
  typeof FleetResourceAssignmentSchema
>;
type RunResources = {
  vehicleAssetId: string;
  trailerAssetId: string | null;
  driverUserId: number;
  resourceAssignment?: FleetResourceAssignment;
  recoveredWork?:{snapshot:z.infer<typeof FleetDetailSnapshotSchema>};
};
export function fleetRunAssetIds(
  run: Pick<
    RunResources,
    "vehicleAssetId" | "trailerAssetId" | "resourceAssignment" | "recoveredWork"
  >,
): string[] {
  const snapshot=run.resourceAssignment?.snapshot??run.recoveredWork?.snapshot;
  return snapshot
    ? [
        snapshot.detail.vehicleAssetId,
        ...(snapshot.rigPackage?.components.map(
          (item) => item.assetId,
        ) ?? []),
      ]
    : [run.vehicleAssetId, ...(run.trailerAssetId ? [run.trailerAssetId] : [])];
}
export function fleetRunInspectionMatches(
  run: RunResources,
  inspection:
    | {
        driverUserId: number;
        vehicleAssetId: string;
        trailerAssetId: string | null;
        inspectedAssetIds?: string[];
      }
    | undefined,
) {
  if (
    !inspection ||
    inspection.driverUserId !== run.driverUserId ||
    inspection.vehicleAssetId !== run.vehicleAssetId ||
    inspection.trailerAssetId !== run.trailerAssetId
  )
    return false;
  if (!run.resourceAssignment&&!run.recoveredWork) return true;
  const ids = fleetRunAssetIds(run);
  return (
    inspection.inspectedAssetIds?.length === ids.length &&
    ids.every((id) => inspection.inspectedAssetIds!.includes(id))
  );
}
