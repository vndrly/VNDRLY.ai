import {FleetServiceTemplateSchema} from "./fleet-service-template";
import {
  FleetDestinationSchema,
  FleetRunCommercialSchema,
  FleetRunBillingInputSchema,
  FleetRunBillingSnapshotSchema,
} from "./fleet-commercial";
import { FleetCargoMarkerSchema } from "./fleet-cargo";
import {FleetRunBillingV2Schema} from "./fleet-pricing";
import { FleetReplacementMarkerSchema } from "./fleet-replacement";
import {
  FleetScheduleSchema,
  FleetOperationalProfileSchema,
  FleetInspectionResponsesSchema,
  FleetManifestValuesSchema,
} from "./fleet-planning";
import { z } from "zod/v4";
import {
  FleetDetailSelectionSchema,
  FleetResourceAssignmentSchema,
} from "./fleet-run-assignment";
import { FleetDetailSnapshotSchema, FleetCanonicalIdSchema } from "./fleet-details";
import {
  FleetRoutePlanSchema,
  fleetPhysicalStopsMatch,
  fleetRouteMatchesSchedule,
  FleetRouteOperationalStopSchema,
} from "./fleet-route";
import { FleetAvailabilitySchema } from "./fleet-availability";
import {FleetRunOrderSchema,FleetRunOrderSelectionSchema,fleetRouteMatchesRunOrder} from "./fleet-run-order";
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
export const FleetStopSchema = FleetRouteOperationalStopSchema;
export const FleetInspectionSchema = z
  .object({
    inspectedAssetIds: z
      .array(FleetCanonicalIdSchema)
      .min(1)
      .max(101)
      .optional(),
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
export const FleetRunEventSchema = z.object({
  id: z.uuid(), operationId: z.uuid(), type: z.string(),
  actorUserId: z.number().int().positive(), recordedAt: z.iso.datetime(),
  capturedAt: z.iso.datetime().optional(), source: z.literal("user_report").optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export const FleetRunEventHistorySchema = z.object({
  version: z.literal(2), totalEvents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  firstEventId: z.uuid(), latestEventId: z.uuid(), complete: z.boolean(),
  visibility: z.literal("permission_filtered").optional(),
}).strict();
export const FleetRunSchema = z
  .object({
    recoveredWork:z.object({version:z.literal(2),billingOnly:z.literal(true),physicalProofVerified:z.literal(false),caseId:z.uuid(),sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),sourceCount:z.number().int().positive(),snapshot:FleetDetailSnapshotSchema,reportedClosedAt:z.iso.datetime(),adoptedAt:z.iso.datetime(),adoptedByUserId:z.number().int().positive()}).strict().optional(),
    localWork:z.object({createOperationId:z.uuid(),originStopId:z.uuid(),snapshot:FleetDetailSnapshotSchema,ticket:z.discriminatedUnion("type",[z.object({type:z.literal("local"),kind:z.literal("ticket"),id:z.uuid()}).strict(),z.object({type:z.literal("canonical"),kind:z.literal("ticket"),id:z.number().int().positive(),version:z.number().int().positive()}).strict()]),state:z.literal("pending_server_acceptance")}).strict().optional(),
    runOrder: FleetRunOrderSchema.optional(),
    serviceTemplate:FleetServiceTemplateSchema.optional(),
    routePlan: FleetRoutePlanSchema.optional(),
    resourceAssignment: FleetResourceAssignmentSchema.optional(),
    billing: FleetRunBillingSnapshotSchema.optional(),
    billingV2:FleetRunBillingV2Schema.optional(),
    workOrigin:z.enum(["dispatch","driver_unplanned"]).optional(),
    assignmentRecordedAt:z.iso.datetime().optional(),
    ticketReference:z.object({id:z.number().int().positive(),version:z.number().int().positive()}).strict().optional(),
    commercial: FleetRunCommercialSchema.optional(),
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
    events: z.array(FleetRunEventSchema).max(200),
    // Operational archive metadata remains visible when financial fields are
    // omitted for a driver. It does not assert financial or physical approval.
    eventHistory: FleetRunEventHistorySchema.optional(),
    linkedTicketId: z.number().int().positive().nullable(),
    allowedActions: z.array(FleetRunActionSchema),
    availability: FleetAvailabilitySchema.optional(),
  })
  .superRefine((run, ctx) => {
    if (run.eventHistory) {
      const history=run.eventHistory;
      if(history.totalEvents<run.events.length||(history.visibility ? history.complete : history.complete!==(history.totalEvents===run.events.length)||history.firstEventId!==run.events[0]?.id||history.latestEventId!==run.events.at(-1)?.id)||new Set(run.events.map(event=>event.id)).size!==run.events.length)
        ctx.addIssue({code:"custom",path:["eventHistory"],message:"Event window must accurately describe its complete canonical archive"});
    }
    if(run.billingV2){
      const financial=run.billingV2;
      if(run.billing || run.commercial)ctx.addIssue({code:"custom",path:["billingV2"],message:"A run must use exactly one v1 or v2 financial writer"});
      if(financial.ticketId!==run.linkedTicketId || financial.context.vendorId!==run.companyId || financial.context.billingSiteId!==run.stops[0]?.siteId)ctx.addIssue({code:"custom",path:["billingV2"],message:"Per-activity billing must retain its actual company, parent ticket and separate billing site"});
    }
    if(run.runOrder&&(!run.routePlan||run.runOrder.companyId!==run.companyId||!run.runOrder.accessGroupIds.includes(run.fleetId)||!fleetRouteMatchesRunOrder(run.routePlan,run.runOrder)))ctx.addIssue({code:"custom",path:["runOrder"],message:"Activity must preserve its saved transport order and company access group"});
    if (
      run.routePlan &&
      !fleetPhysicalStopsMatch(run.routePlan, run.stops[0].siteId, run.stops)
    )
      ctx.addIssue({
        code: "custom",
        path: ["routePlan"],
        message:
          "Operational stops must preserve the exact physical route and separate billing site",
      });
    const assignment = run.resourceAssignment;
    if(run.recoveredWork&&(assignment||run.localWork||!["submitted_for_review","completed"].includes(run.status)||run.recoveredWork.snapshot.detail.driverUserId!==run.driverUserId||run.recoveredWork.snapshot.detail.vehicleAssetId!==run.vehicleAssetId||run.recoveredWork.snapshot.detail.companyId!==run.companyId))ctx.addIssue({code:"custom",path:["recoveredWork"],message:"Recovered work is an unreserved historical billing source, never a current physical assignment"});
    if(run.routePlan&&!fleetRouteMatchesSchedule(run.routePlan,run.schedule))ctx.addIssue({code:"custom",path:["routePlan","plannedWindow"],message:"Physical route and run schedule must use the same planned window and time zone"});
    if(run.routePlan&&assignment&&run.routePlan.returnPolicy!==assignment.returnPolicy)ctx.addIssue({code:"custom",path:["resourceAssignment","returnPolicy"],message:"Physical route and run assignment must use the same return policy"});
    if (!assignment) return;
    const { detail } = assignment.snapshot;
    const trailer =
      assignment.snapshot.rigPackage?.components.find(
        (item) => item.role === "trailer",
      )?.assetId ?? null;
    if (
      run.id !== assignment.reservation.runId ||
      run.companyId !== detail.companyId ||
      run.driverUserId !== detail.driverUserId ||
      run.vehicleAssetId !== detail.vehicleAssetId ||
      run.trailerAssetId !== trailer
    )
      ctx.addIssue({
        code: "custom",
        path: ["resourceAssignment"],
        message:
          "Run identity and legacy resource fields must match its immutable Detail assignment",
      });
  });
export const FleetActionInputSchema = z
  .object({
    detailSelection: FleetDetailSelectionSchema.optional(),
    inspectedAssetIds: z
      .array(FleetCanonicalIdSchema)
      .min(1)
      .max(101)
      .optional(),
    billingQuantity: z
      .number()
      .positive()
      .finite()
      .max(1000000)
      .multipleOf(0.01)
      .optional(),
    destinationId: z.uuid().optional(),
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
    runOrderSelection: FleetRunOrderSelectionSchema.optional(),
    routePlan: FleetRoutePlanSchema.optional(),
    detailSelection: FleetDetailSelectionSchema.optional(),
    billing: FleetRunBillingInputSchema,
    schedule: FleetScheduleSchema.nullable().optional(),
    operationId: z.uuid(),
    fleetId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    driverUserId: z.number().int().positive(),
    vehicleAssetId: z.uuid(),
    trailerAssetId: z.uuid().nullable().default(null),
    stops: z.array(FleetStopSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if(value.runOrderSelection&&(!value.detailSelection||!value.routePlan))ctx.addIssue({code:"custom",path:["runOrderSelection"],message:"Dispatch a saved Run with a Detail and its physical route"});
    if (
      value.routePlan &&
      !fleetPhysicalStopsMatch(
        value.routePlan,
        value.stops[0].siteId,
        value.stops,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["routePlan"],
        message:
          "Operational stops must preserve the exact physical route and separate billing site",
      });
    if(value.routePlan&&!fleetRouteMatchesSchedule(value.routePlan,value.schedule))ctx.addIssue({code:"custom",path:["routePlan","plannedWindow"],message:"Physical route and run schedule must use the same planned window and time zone"});
    if (
      value.routePlan &&
      value.detailSelection &&
      value.routePlan.returnPolicy !== value.detailSelection.returnPolicy
    )
      ctx.addIssue({
        code: "custom",
        path: ["routePlan"],
        message: "Route and Detail must use the same return policy",
      });
    if (
      value.detailSelection?.returnPolicy === "return_required" &&
      value.stops.at(-1)?.kind !== "return"
    )
      ctx.addIssue({
        code: "custom",
        path: ["stops"],
        message: "Return-required work needs its chosen final return stop",
      });
    if (
      value.detailSelection &&
      value.schedule &&
      value.detailSelection.timeZone !== value.schedule.timezone
    )
      ctx.addIssue({
        code: "custom",
        path: ["detailSelection", "timeZone"],
        message:
          "Detail reservation and schedule must use the same chosen time zone",
      });
  });
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
    canManageResources?: boolean;
    canDispatch: boolean;
    canManage: boolean;
    canDrive: boolean;
    canReview?: boolean;
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
    speedMetersPerSecond?:number|null;
    speedAccuracyMetersPerSecond?:number|null;
    headingDegrees?:number|null;
  }[];
  unavailableIntegrations: string[];
  generatedAt: string;
};
export type FleetResources = {
  tickets?: { id: number; siteId: number; status: string }[];
  drivers: { userId: number; name: string; fleetIds: string[]; employeeId?: number | null; cdlRecorded?: boolean; cdlExpirationDate?: string | null }[];
  equipment: {
    id: string;
    name: string;
    category: string;
    status: string;
    dispatchable: boolean;
    currentHolderUserId?: number | null;
    currentHolderName?: string | null;
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
export const FleetRecordedTimingSchema = z
  .object({
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
  })
  .strict();
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

export type FleetDefinition = z.infer<typeof FleetDefinitionSchema>;
