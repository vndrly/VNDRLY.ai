import { z } from "zod/v4";
export const FleetRoleSchema = z.enum([
  "fleet_manager",
  "dispatcher",
  "driver",
]);
export const FleetRunActionSchema = z.enum([
  "dispatch",
  "reassign",
  "cancel",
  "acknowledge",
  "inspect",
  "start",
  "arrive_stop",
  "depart_stop",
  "record_load",
  "record_delivery",
  "submit_closeout",
  "pause",
  "resume",
  "record_fuel",
  "record_meter",
  "link_ticket",
  "review",
]);
export const FleetGrantSchema = z
  .object({
    userId: z.number().int().positive(),
    fleetIds: z.array(z.uuid()).max(50),
    siteIds: z.array(z.number().int().positive()).max(200),
    roles: z.array(FleetRoleSchema).max(3),
    safetyRelease: z.boolean().default(false),
    financeRead: z.boolean().default(false),
  })
  .strict();
export const FleetDefinitionSchema = z
  .object({
    equipmentAssetIds: z.array(z.uuid()).max(500).default([]),
    requiredCertifications: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .default([]),
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    siteIds: z.array(z.number().int().positive()).max(200),
  })
  .strict();
export const FleetStopSchema = z
  .object({
    id: z.uuid(),
    siteId: z.number().int().positive(),
    kind: z.enum(["pickup", "delivery", "return"]),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
export const FleetInspectionSchema = z
  .object({
    driverUserId: z.number().int().positive(),
    vehicleAssetId: z.uuid(),
    trailerAssetId: z.uuid().nullable(),
    outcome: z.enum(["passed", "defect_reported"]),
    notes: z.string().trim().min(1).max(2000),
    recordedByUserId: z.number().int().positive(),
    recordedAt: z.iso.datetime(),
    source: z.literal("user_report"),
  })
  .strict();
export const FleetLoadSchema = z
  .object({
    id: z.uuid(),
    pickupStopId: z.uuid(),
    deliveryStopId: z.uuid().nullable(),
    commodity: z.string().trim().min(1).max(100),
    quantity: z.number().positive().finite(),
    unit: z.string().trim().min(1).max(40),
    manifestReference: z.string().trim().min(1).max(200),
    deliveryReference: z.string().trim().min(1).max(200).nullable(),
    recordedByUserId: z.number().int().positive(),
    recordedAt: z.iso.datetime(),
    deliveredAt: z.iso.datetime().nullable(),
    source: z.literal("user_report"),
  })
  .strict();
export const FleetRunRecordSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["fuel", "meter"]),
    quantity: z.number().positive().nullable(),
    reading: z.number().nonnegative().nullable(),
    unit: z.string().trim().min(1).max(40),
    notes: z.string().trim().min(1).max(2000),
    recordedByUserId: z.number().int().positive(),
    recordedAt: z.iso.datetime(),
    capturedAt: z.iso.datetime().nullable(),
    source: z.literal("user_report"),
  })
  .strict();
export const FleetRunSchema = z.object({
  labels: z
    .object({
      driverName: z.string().nullable(),
      vehicleName: z.string().nullable(),
      trailerName: z.string().nullable(),
      sites: z.array(
        z.object({ siteId: z.number().int().positive(), name: z.string() }),
      ),
    })
    .optional(),
  id: z.uuid(),
  fleetId: z.uuid(),
  companyId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  driverUserId: z.number().int().positive(),
  vehicleAssetId: z.uuid(),
  trailerAssetId: z.uuid().nullable(),
  siteIds: z.array(z.number().int().positive()).max(200),
  status: z.enum([
    "draft",
    "dispatched",
    "acknowledged",
    "in_progress",
    "submitted_for_review",
    "completed",
    "cancelled",
  ]),
  phase: z.string().nullable(),
  pausedFromPhase: z.string().nullable().default(null),
  records: z.array(FleetRunRecordSchema).max(200).default([]),
  version: z.number().int().positive(),
  stops: z.array(FleetStopSchema).min(1).max(50),
  loads: z.array(FleetLoadSchema).max(100),
  inspections: z.array(FleetInspectionSchema).max(100),
  currentStopId: z.uuid().nullable(),
  visitedStopIds: z.array(z.uuid()).max(50),
  events: z
    .array(
      z.object({
        id: z.uuid(),
        operationId: z.uuid(),
        type: z.string(),
        actorUserId: z.number().int().positive(),
        recordedAt: z.iso.datetime(),
        capturedAt: z.iso.datetime().optional(),
        source: z.literal("user_report").optional(),
        details: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(200),
  linkedTicketId: z.number().int().positive().nullable(),
  allowedActions: z.array(FleetRunActionSchema),
});
export const FleetActionInputSchema = z
  .object({
    capturedAt: z.iso.datetime().optional(),
    source: z.literal("user_report").optional(),
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    reading: z.number().nonnegative().finite().optional(),
    ticketId: z.number().int().positive().optional(),
    action: FleetRunActionSchema,
    driverUserId: z.number().int().positive().optional(),
    vehicleAssetId: z.uuid().optional(),
    trailerAssetId: z.uuid().nullable().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    stopId: z.uuid().optional(),
    inspectionOutcome: z.enum(["passed", "defect_reported"]).optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    loadId: z.uuid().optional(),
    commodity: z.string().trim().min(1).max(100).optional(),
    quantity: z.number().positive().finite().optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    manifestReference: z.string().trim().min(1).max(200).optional(),
    deliveryReference: z.string().trim().min(1).max(200).optional(),
    decision: z.enum(["accept", "return"]).optional(),
  })
  .strict();
export const CreateFleetRunSchema = z
  .object({
    operationId: z.uuid(),
    fleetId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    driverUserId: z.number().int().positive(),
    vehicleAssetId: z.uuid(),
    trailerAssetId: z.uuid().nullable().default(null),
    stops: z.array(FleetStopSchema).min(1).max(50),
  })
  .strict();
export type FleetRun = z.infer<typeof FleetRunSchema>;
export type FleetActionInput = z.infer<typeof FleetActionInputSchema>;
export type FleetOverview = {
  preference?: FleetWorkspacePreference;
  companyId: number;
  enabled: boolean;
  roles: z.infer<typeof FleetRoleSchema>[];
  capabilities: {
    canDispatch: boolean;
    canManage: boolean;
    canDrive: boolean;
    canSetup: boolean;
  };
  fleets: z.infer<typeof FleetDefinitionSchema>[];
  runs: FleetRun[];
  observations: {
    runId: string;
    vehicleAssetId: string;
    latitude: number;
    longitude: number;
    recordedAt: string;
    source: "driver_phone";
    freshness: "recent" | "stale" | "paused" | "unavailable";
  }[];
  unavailableIntegrations: string[];
  generatedAt: string;
};
export type FleetResources = {
  tickets?: { id: number; siteId: number; status: string }[];
  drivers: { userId: number; name: string; fleetIds: string[] }[];
  equipment: {
    id: string;
    name: string;
    category: string;
    status: string;
    dispatchable: boolean;
  }[];
};

export const FleetSetupInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    enabled: z.boolean(),
    fleets: z.array(FleetDefinitionSchema).max(50),
    grants: z.array(FleetGrantSchema).max(500),
  })
  .strict();
export type FleetSetup = z.infer<typeof FleetSetupInputSchema> & {
  members: { userId: number; name: string }[];
  sites: { siteId: number; name: string }[];
  equipment: { assetId: string; name: string; category: string }[];
};

export const FleetWorkspacePreferenceInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    defaultWorkspace: z.enum(["standard", "fleet_desk", "fleet_my_day"]),
    selectedFleetId: z.uuid().nullable(),
  })
  .strict();
export const FleetWorkspacePreferenceSchema = z
  .object({
    userId: z.number().int().positive(),
    version: z.number().int().positive(),
    defaultWorkspace: z.enum(["standard", "fleet_desk", "fleet_my_day"]),
    selectedFleetId: z.uuid().nullable(),
  })
  .strict();
export type FleetWorkspacePreference = z.infer<
  typeof FleetWorkspacePreferenceSchema
>;
