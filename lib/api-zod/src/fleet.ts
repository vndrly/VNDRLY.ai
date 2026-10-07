import { FleetCargoMarkerSchema } from "./fleet-cargo";
import { FleetReplacementMarkerSchema } from "./fleet-replacement";
import { FleetScheduleSchema, FleetOperationalProfileSchema, FleetInspectionResponsesSchema, FleetManifestValuesSchema } from "./fleet-planning";
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
    operationalProfile: FleetOperationalProfileSchema.optional(),
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
    responses: FleetInspectionResponsesSchema.optional(),
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
    transferOut: FleetCargoMarkerSchema.optional(),
    transferIn: FleetCargoMarkerSchema.optional(),
    plannedDeliveryStopId: z.uuid().optional(),
    manifestValues: FleetManifestValuesSchema.optional(),
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
    vehicleAssetId: z.uuid().nullable().default(null),
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
  activeReplacement: FleetReplacementMarkerSchema.optional(),
  canEditDraft: z.boolean().optional(),
  schedule: FleetScheduleSchema.nullable().optional(),
  operationalProfile: FleetOperationalProfileSchema.optional(),
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
    inspectionResponses: FleetInspectionResponsesSchema.optional(),
    manifestValues: FleetManifestValuesSchema.optional(),
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
    schedule: FleetScheduleSchema.nullable().optional(),
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
  accountScope?: {
    userId: number;
    companyId: number;
    membershipId: number;
    sessionVersion: number;
  };
  page?: { limit: number; nextCursor: string | null };
  preference?: FleetWorkspacePreference;
  companyId: number;
  enabled: boolean;
  roles: z.infer<typeof FleetRoleSchema>[];
  capabilities: {
    canDispatch: boolean;
    canManage: boolean;
    canDrive: boolean;
    canMaintain?: boolean;
    canReportDefect?: boolean;
    canReleaseHold?: boolean;
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
    supportGrants: z
      .array(
        z
          .object({
            userId: z.number().int().positive(),
            fleetIds: z.array(z.uuid()).min(1).max(50),
            siteIds: z.array(z.number().int().positive()).min(1).max(200),
            expiresAt: z.iso.datetime(),
            reason: z.string().trim().min(1).max(2000),
            financeRead: z.boolean().default(false),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();
export type FleetSetup = z.infer<typeof FleetSetupInputSchema> & {
  members: { userId: number; name: string }[];
  sites: { siteId: number; name: string }[];
  equipment: { assetId: string; name: string; category: string }[];
};
export type FleetSupportGrant = NonNullable<
  z.infer<typeof FleetSetupInputSchema>["supportGrants"]
>[number];
export type FleetSupportChoices = {
  companies: {
    companyId: number;
    companyName: string;
    expiresAt: string;
    reason: string;
  }[];
  readOnly: true;
};
export type FleetSupportRead = {
  companyId: number;
  companyName: string;
  expiresAt: string;
  reason: string;
  runs: FleetRun[];
  readOnly: true;
  coordinateDisclosure: false;
  page: { nextCursor: string | null };
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

export const FleetMaintenanceCreateSchema = z
  .object({
    operationId: z.uuid(),
    fleetId: z.uuid(),
    assetId: z.uuid(),
    runId: z.uuid().optional(),
    kind: z.enum(["defect", "scheduled_service"]),
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().min(1).max(2000),
    dueAt: z.iso.datetime().optional(),
  })
  .strict();
export const FleetMaintenanceActionSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    action: z.enum(["triage", "record_repair", "release", "cancel"]),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();
export const FleetMaintenanceRecordSchema = z
  .object({
    id: z.uuid(),
    companyId: z.number().int().positive(),
    fleetId: z.uuid(),
    assetId: z.uuid(),
    runId: z.uuid().nullable(),
    kind: z.enum(["defect", "scheduled_service"]),
    title: z.string(),
    status: z.enum([
      "reported",
      "in_service",
      "repair_recorded",
      "released",
      "cancelled",
    ]),
    version: z.number().int().positive(),
    dueAt: z.iso.datetime().nullable(),
    holdId: z.uuid().nullable(),
    events: z
      .array(
        z.object({
          operationId: z.uuid(),
          action: z.string(),
          actorUserId: z.number().int().positive(),
          recordedAt: z.iso.datetime(),
          notes: z.string(),
          source: z.literal("user_report"),
        }),
      )
      .max(200),
    allowedActions: z.array(FleetMaintenanceActionSchema.shape.action),
  })
  .strict();
export type FleetMaintenanceRecord = z.infer<
  typeof FleetMaintenanceRecordSchema
>;
export type FleetMaintenanceCreate = z.infer<
  typeof FleetMaintenanceCreateSchema
>;
export type FleetMaintenanceAction = z.infer<
  typeof FleetMaintenanceActionSchema
>;
export type FleetMaintenancePage = {
  records: FleetMaintenanceRecord[];
  nextCursor: string | null;
  generatedAt: string;
};

export const FleetReportFilterSchema = z
  .object({
    fleetId: z.uuid().optional(),
    siteId: z.number().int().positive().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.startsAt ||
      !value.endsAt ||
      Date.parse(value.endsAt) > Date.parse(value.startsAt),
    "Report end must follow start",
  );
export type FleetReportFilter = z.infer<typeof FleetReportFilterSchema>;
export const FleetRecordedTimingSchema = z.object({
  source: z.literal("server_recorded_event_times"),
  physicalPresenceVerified: z.literal(false),
  contractualTimelinessVerified: z.literal(false),
  eligibleRunCount: z.number().int().nonnegative(),
  invalidSequenceCount: z.number().int().nonnegative(),
  elapsedMinutes: z.number().finite().nonnegative(),
  pausedMinutes: z.number().finite().nonnegative(),
  activeMinutes: z.number().finite().nonnegative(),
  plannedStartCount: z.number().int().nonnegative(),
  lateStartCount: z.number().int().nonnegative(),
  startOffsetTotalMinutes: z.number().finite(),
  plannedFinishCount: z.number().int().nonnegative(),
  lateFinishCount: z.number().int().nonnegative(),
  finishOffsetTotalMinutes: z.number().finite(),
}).strict();
export type FleetRecordedTiming = z.infer<typeof FleetRecordedTimingSchema>;
export const FleetReportSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    filters: FleetReportFilterSchema,
    source: z.literal("recorded_fleet_events"),
    dateBasis: z.literal("run_created_at"),
    runCount: z.number().int().nonnegative(),
    completedRunCount: z.number().int().nonnegative(),
    submittedRunCount: z.number().int().nonnegative(),
    inspectionExceptions: z.number().int().nonnegative(),
    recordedTiming: FleetRecordedTimingSchema.optional(),
    loadTotals: z.array(
      z.object({
        commodity: z.string(),
        unit: z.string(),
        quantity: z.number().nonnegative(),
        deliveredQuantity: z.number().nonnegative(),
      }),
    ),
    distanceTotals: z.array(
      z.object({ unit: z.string(), distance: z.number().nonnegative() }),
    ),
    fuelTotals: z
      .array(z.object({ unit: z.string(), quantity: z.number().nonnegative() }))
      .nullable(),
    unavailableMetrics: z.array(
      z.object({ metric: z.string(), reason: z.string() }),
    ),
  })
  .strict();
export type FleetReport = {
  generatedAt: string;
  filters: FleetReportFilter;
  source: "recorded_fleet_events";
  dateBasis: "run_created_at";
  runCount: number;
  completedRunCount: number;
  submittedRunCount: number;
  inspectionExceptions: number;
  recordedTiming?: FleetRecordedTiming;
  loadTotals: {
    commodity: string;
    unit: string;
    quantity: number;
    deliveredQuantity: number;
  }[];
  distanceTotals: { unit: string; distance: number }[];
  fuelTotals: { unit: string; quantity: number }[] | null;
  unavailableMetrics: { metric: string; reason: string }[];
};
export const FleetSavedViewInputSchema = z
  .object({
    operationId: z.uuid(),
    viewId: z.uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    action: z.enum(["save", "archive"]),
    name: z.string().trim().min(1).max(100).optional(),
    filters: FleetReportFilterSchema.optional(),
  })
  .strict();
export type FleetSavedView = {
  id: string;
  userId: number;
  companyId: number;
  version: number;
  name: string;
  filters: FleetReportFilter;
  archived: boolean;
  recordedAt: string;
  lastOperationId?: string;
};
export const FleetGateLinkInputSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    stopId: z.uuid(),
    visitId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type FleetGateObservation = {
  visitId: number;
  siteId: number;
  vehicleAssetId: string;
  checkInAt: string;
  checkOutAt: string | null;
  observedArrivalAt: string | null;
  observedDepartureAt: string | null;
  source: string | null;
  reconciliationState: string;
};
export type FleetGateObservations = {
  runId: string;
  version: number;
  observations: FleetGateObservation[];
  ambiguous: boolean;
  basis: "same_equipment_site_time_window";
  automaticAdmissionCreated: false;
  canLink: boolean;
  links: FleetGateLink[];
};
export type FleetGateLink = {
  runId: string;
  stopId: string;
  visitId: number;
  operationId: string;
  version: number;
  recordedAt: string;
  observation: FleetGateObservation;
  automaticAdmissionCreated: false;
};
