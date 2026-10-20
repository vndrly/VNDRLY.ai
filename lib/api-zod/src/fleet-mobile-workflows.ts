import { z } from "zod/v4";
import { FleetCanonicalIdSchema, FleetTimeZoneSchema } from "./fleet-details";
import { WorkdayScopeSchema } from "./workday";

const timestamp = z.iso.datetime({ offset: true });
const positiveId = z.number().int().positive();
const version = z.number().int().positive();
const expectedVersion = z.number().int().nonnegative();
const note = z.string().trim().max(2000);

/** Capabilities compose within one membership; portal labels do not grant authority. */
export const FleetCapabilitySchema = z.enum([
  "admin", "office", "dispatch", "yard", "driver", "self_dispatch",
]);
export type FleetCapability = z.infer<typeof FleetCapabilitySchema>;
export const FleetCapabilityAssignmentSchema = z.object({
  companyId: positiveId,
  userId: positiveId,
  version,
  capabilities: z.array(FleetCapabilitySchema).max(6),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.capabilities).size !== value.capabilities.length)
    ctx.addIssue({ code: "custom", path: ["capabilities"], message: "Duplicate capability" });
  if (value.capabilities.includes("self_dispatch") && !value.capabilities.includes("driver"))
    ctx.addIssue({ code: "custom", path: ["capabilities"], message: "Self-dispatch requires Driver capability" });
});
export type FleetCapabilityAssignment = z.infer<typeof FleetCapabilityAssignmentSchema>;
export const FleetCapabilityAssignmentInputSchema = z.object({
  operationId: FleetCanonicalIdSchema,
  expectedVersion,
  scope: WorkdayScopeSchema,
  assignment: FleetCapabilityAssignmentSchema,
}).strict();

const yardFields = {
  companyId: positiveId,
  name: z.string().trim().min(1).max(160),
  timeZone: FleetTimeZoneSchema,
  destinationId: FleetCanonicalIdSchema.nullable(),
  isHomeBase: z.boolean(),
  active: z.boolean(),
};
/** A home base can precede a formal destination or multi-yard setup. */
export const FleetYardSchema = z.object({
  id: FleetCanonicalIdSchema,
  version,
  ...yardFields,
}).strict();
export type FleetYard = z.infer<typeof FleetYardSchema>;
export const FleetYardInputSchema = z.object({
  operationId: FleetCanonicalIdSchema,
  expectedVersion,
  scope: WorkdayScopeSchema,
  yard: z.object(yardFields).strict(),
}).strict();

export const FleetYardOrderStatusSchema = z.enum(["requested", "assigned", "in_progress", "reported"]);
export const FleetYardOrderOutcomeSchema = z.enum(["ready", "needs_attention", "unable_to_complete"]);
const conditionFinding = z.object({
  assetId: FleetCanonicalIdSchema,
  kind: z.enum(["missing", "damaged", "substituted", "unavailable", "inspection"]),
  note,
}).strict();
export const FleetYardOrderSchema = z.object({
  id: FleetCanonicalIdSchema,
  companyId: positiveId,
  version,
  yardId: FleetCanonicalIdSchema.nullable(),
  detailId: FleetCanonicalIdSchema.nullable(),
  runId: FleetCanonicalIdSchema.nullable(),
  status: FleetYardOrderStatusSchema,
  outcome: FleetYardOrderOutcomeSchema.nullable(),
  requestedByUserId: positiveId,
  assignedToUserId: positiveId.nullable(),
  requestedAt: timestamp,
  scheduledAt: timestamp.nullable(),
  startedAt: timestamp.nullable(),
  reportedAt: timestamp.nullable(),
  requestedAssetIds: z.array(FleetCanonicalIdSchema).max(100),
  actualAssetIds: z.array(FleetCanonicalIdSchema).max(100),
  findings: z.array(conditionFinding).max(100),
  notes: note,
}).strict().superRefine((value, ctx) => {
  if ((value.status === "reported") !== (value.outcome !== null && value.reportedAt !== null))
    ctx.addIssue({ code: "custom", path: ["outcome"], message: "Reported orders require an outcome and report time" });
  for (const key of ["requestedAssetIds", "actualAssetIds"] as const)
    if (new Set(value[key]).size !== value[key].length)
      ctx.addIssue({ code: "custom", path: [key], message: "Duplicate asset" });
});
export type FleetYardOrder = z.infer<typeof FleetYardOrderSchema>;
const yardOrderActionBase = {
  operationId: FleetCanonicalIdSchema,
  expectedVersion,
  scope: WorkdayScopeSchema,
  orderId: FleetCanonicalIdSchema,
};
/** Reported outcome informs Dispatch; it is not a ticket or run gate. */
export const FleetYardOrderActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...yardOrderActionBase, kind: z.literal("assign"), assignedToUserId: positiveId }).strict(),
  z.object({ ...yardOrderActionBase, kind: z.literal("start") }).strict(),
  z.object({ ...yardOrderActionBase, kind: z.literal("report"), outcome: FleetYardOrderOutcomeSchema,
    actualAssetIds: z.array(FleetCanonicalIdSchema).max(100).optional(),
    findings: z.array(conditionFinding).max(100).optional(), notes: note }).strict(),
]);
export type FleetYardOrderAction = z.infer<typeof FleetYardOrderActionSchema>;
export const FleetYardOrderInputSchema = z.object({
  operationId: FleetCanonicalIdSchema,
  expectedVersion,
  scope: WorkdayScopeSchema,
  order: FleetYardOrderSchema,
}).strict();

export const FleetCustodyStateSchema = z.enum([
  "intake", "at_yard", "reserved", "attached", "in_transit", "returned", "transferred",
]);
export const FleetCustodyMethodSchema = z.enum([
  "gate_scan", "gps_geofence", "manual", "driver_app",
]);
const custodyFields = {
  companyId: positiveId,
  assetId: FleetCanonicalIdSchema,
  state: FleetCustodyStateSchema,
  method: FleetCustodyMethodSchema,
  observedAt: timestamp,
  observedByUserId: positiveId,
  yardId: FleetCanonicalIdSchema.nullable(),
  runId: FleetCanonicalIdSchema.nullable(),
  detailId: FleetCanonicalIdSchema.nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  notes: note,
};
export const FleetCustodyObservationSchema = z.object({
  id: FleetCanonicalIdSchema,
  ...custodyFields,
}).strict().superRefine((value, ctx) => {
  if ((value.latitude === null) !== (value.longitude === null))
    ctx.addIssue({ code: "custom", path: ["longitude"], message: "Coordinates must be supplied together" });
});
export type FleetCustodyObservation = z.infer<typeof FleetCustodyObservationSchema>;
export const FleetCustodyObservationInputSchema = z.object({
  operationId: FleetCanonicalIdSchema,
  expectedVersion,
  scope: WorkdayScopeSchema,
  observation: z.object(custodyFields).strict(),
}).strict();

const homeAction = z.object({
  kind: z.enum(["review_ticket", "prepare_detail", "start_run", "continue_run", "report_yard_order", "review_closeout", "finalize_ticket"]),
  label: z.string().trim().min(1).max(160),
  runId: FleetCanonicalIdSchema.nullable().optional(),
}).strict();
export const FleetHomeProjectionSchema = z.object({
  companyId: positiveId,
  userId: positiveId,
  mode: z.enum(["my_fleet_day", "coordinated"]),
  capabilities: z.array(FleetCapabilitySchema).max(6),
  nextAction: homeAction.nullable(),
  priorities: z.array(homeAction).max(50),
  warnings: z.array(z.object({ id: FleetCanonicalIdSchema, message: z.string().min(1).max(500) }).strict()).max(50),
  moduleStates: z.array(z.object({ module: z.enum(["dispatch", "yard", "assets", "map", "history", "compliance", "maintenance"]), state: z.enum(["ready", "empty", "warning", "unavailable"]) }).strict()).max(7),
}).strict();
export type FleetHomeProjection = z.infer<typeof FleetHomeProjectionSchema>;

const complianceCategory = z.enum(["vehicle", "driver_license", "insurance", "company_records"]);
const score = z.number().int().min(0).max(100);
export const FleetComplianceScoreSchema = z.object({
  companyId: positiveId,
  score,
  status: z.enum(["red", "amber", "green"]),
  advisoryOnly: z.literal(true),
  evaluatedAt: timestamp,
  categories: z.array(z.object({ category: complianceCategory, score }).strict()).max(4),
  deductions: z.array(z.object({
    id: FleetCanonicalIdSchema,
    category: complianceCategory,
    points: z.number().int().positive().max(100),
    reason: z.string().trim().min(1).max(500),
    urgency: z.enum(["now", "soon", "later"]),
    estimatedImprovement: z.number().int().nonnegative().max(100),
    remediation: z.string().trim().min(1).max(1000),
    evidenceDestination: z.string().trim().min(1).max(200),
    responsibleCapability: FleetCapabilitySchema,
    dueAt: timestamp.nullable(),
  }).strict()).max(100),
  history: z.array(z.object({ at: timestamp, score }).strict()).max(365),
}).strict();
export type FleetComplianceScore = z.infer<typeof FleetComplianceScoreSchema>;
