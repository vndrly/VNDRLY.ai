import { z } from "zod/v4";

const timestamp = z.iso.datetime({ offset: true });
const version = z.number().int().positive();
const companyId = z.number().int().positive();
const effectiveWindow = { effectiveFrom: timestamp, effectiveUntil: timestamp.nullable(), archivedAt: timestamp.nullable() };
export const FleetTimeZoneSchema = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "An IANA time zone is required");
function validateWindow(value: { effectiveFrom: string; effectiveUntil: string | null }, ctx: z.RefinementCtx) {
  if (value.effectiveUntil && Date.parse(value.effectiveUntil) <= Date.parse(value.effectiveFrom)) {
    ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "Effective end must follow start" });
  }
}

export const FleetRigComponentSchema = z.object({ assetId: z.uuid(), role: z.enum(["trailer", "dolly", "tank", "pump", "accessory"]), sequence: z.number().int().nonnegative() }).strict();
export const FleetRigPackageSchema = z.object({
  id: z.uuid(), companyId, version, name: z.string().trim().min(1).max(160),
  components: z.array(FleetRigComponentSchema).min(1).max(100), ...effectiveWindow,
}).strict().superRefine((value, ctx) => {
  validateWindow(value, ctx);
  if (new Set(value.components.map(row => row.assetId)).size !== value.components.length) ctx.addIssue({ code: "custom", path: ["components"], message: "An Inventory component can appear only once" });
  if (value.components.some((row, index) => row.sequence !== index)) ctx.addIssue({ code: "custom", path: ["components"], message: "Component sequence must be contiguous and ordered" });
});
export type FleetRigPackage = z.infer<typeof FleetRigPackageSchema>;

export const FleetDetailSchema = z.object({
  id: z.uuid(), companyId, version, name: z.string().trim().min(1).max(160),
  vehicleAssetId: z.uuid(), rigPackageId: z.uuid().nullable(), rigPackageVersion: version.nullable(),
  driverUserId: z.number().int().positive(), accessGroupIds: z.array(z.uuid()).max(50).default([]),
  ...effectiveWindow,
}).strict().superRefine((value, ctx) => {
  validateWindow(value, ctx);
  if ((value.rigPackageId === null) !== (value.rigPackageVersion === null)) ctx.addIssue({ code: "custom", path: ["rigPackageId"], message: "Package ID and revision must be selected together" });
  if (new Set(value.accessGroupIds).size !== value.accessGroupIds.length) ctx.addIssue({ code: "custom", path: ["accessGroupIds"], message: "Duplicate access group" });
});
export type FleetDetail = z.infer<typeof FleetDetailSchema>;

export const FleetDetailSnapshotSchema = z.object({
  detail: FleetDetailSchema, rigPackage: FleetRigPackageSchema.nullable(),
  labels: z.object({ truck: z.string().trim().min(1).max(160), rigPackage: z.string().trim().min(1).max(160).nullable(), driver: z.string().trim().min(1).max(160), components: z.array(z.object({ assetId: z.uuid(), label: z.string().trim().min(1).max(160) }).strict()).max(100) }).strict(),
  carrierOfRecordId: companyId, snapshottedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  const { detail, rigPackage } = value;
  if (detail.rigPackageId !== (rigPackage?.id ?? null) || detail.rigPackageVersion !== (rigPackage?.version ?? null) || (rigPackage && rigPackage.companyId !== detail.companyId)) ctx.addIssue({ code: "custom", path: ["rigPackage"], message: "Exact company package revision must match the Detail" });
  if (rigPackage?.components.some(row => row.assetId === detail.vehicleAssetId)) ctx.addIssue({ code: "custom", path: ["rigPackage"], message: "The power unit cannot be a component of its own rig" });
  const ids = rigPackage?.components.map(row => row.assetId) ?? [];
  if (value.labels.components.length !== ids.length || new Set(value.labels.components.map(row => row.assetId)).size !== ids.length || value.labels.components.some(row => !ids.includes(row.assetId))) ctx.addIssue({ code: "custom", path: ["labels", "components"], message: "Component labels must describe the exact snapshot" });
  if ((rigPackage === null) !== (value.labels.rigPackage === null)) ctx.addIssue({ code: "custom", path: ["labels", "rigPackage"], message: "Package label must match the selected rig" });
});
export type FleetDetailSnapshot = z.infer<typeof FleetDetailSnapshotSchema>;

export const FleetReservationSchema = z.object({
  id: z.uuid(), runId: z.uuid(), detailId: z.uuid(), detailVersion: version, driverUserId: z.number().int().positive(),
  assetIds: z.array(z.uuid()).min(1).max(101), startAt: timestamp, plannedEndAt: timestamp,
  timeZone: FleetTimeZoneSchema, state: z.enum(["reserved", "active", "released", "cancelled"]),
  actualReleasedAt: timestamp.nullable(), releaseReason: z.string().trim().min(1).max(1000).nullable(), version,
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.plannedEndAt) <= Date.parse(value.startAt)) ctx.addIssue({ code: "custom", path: ["plannedEndAt"], message: "Reservation end must follow start" });
  if (new Set(value.assetIds).size !== value.assetIds.length) ctx.addIssue({ code: "custom", path: ["assetIds"], message: "Duplicate reserved asset" });
  const released = value.state === "released" || value.state === "cancelled";
  if (released !== (value.actualReleasedAt !== null && value.releaseReason !== null) || (!released && (value.actualReleasedAt !== null || value.releaseReason !== null))) ctx.addIssue({ code: "custom", path: ["state"], message: "Release requires its actual time and reason" });
});
export type FleetReservation = z.infer<typeof FleetReservationSchema>;

export const FleetResourcesRegistrySchema = z.object({
  version: z.literal(1), rigPackages: z.array(FleetRigPackageSchema), details: z.array(FleetDetailSchema), reservations: z.array(FleetReservationSchema),
}).strict();
export type FleetResourcesRegistry = z.infer<typeof FleetResourcesRegistrySchema>;
export const emptyFleetResourcesRegistry = (): FleetResourcesRegistry => ({ version: 1, rigPackages: [], details: [], reservations: [] });
