import { z } from "zod/v4";
import { FleetRoutePlanSchema } from "./fleet-route";
import { FleetRunOrderSelectionSchema } from "./fleet-run-order";

const id = z.uuid();
const positive = z.number().int().positive();
const ticket = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("authorized"), ticketId: positive }).strict(),
  z.object({ kind: z.literal("office_review_draft"), billable: z.literal(false) }).strict(),
]);

export const FleetDispatchPlanInputSchema = z.object({
  operationId: id,
  fleetId: id,
  title: z.string().trim().min(1).max(200),
  billingSiteId: positive,
  routePlan: FleetRoutePlanSchema,
  runOrderSelection: FleetRunOrderSelectionSchema.optional(),
  ticket,
  detailId: id.nullable(),
  driverUserId: positive.nullable(),
  yardOrderId: id.nullable().optional(),
}).strict();
export type FleetDispatchPlanInput = z.infer<typeof FleetDispatchPlanInputSchema>;

export const FleetDispatchPlanSchema = FleetDispatchPlanInputSchema.omit({ operationId: true }).extend({
  id,
  operationId: id,
  companyId: positive,
  version: positive,
  state: z.enum(["waiting_on_yard", "ready_to_dispatch", "released"]),
  runId: id.nullable(),
  createdByUserId: positive,
  createdAt: z.iso.datetime({ offset: true }),
}).strict();
export type FleetDispatchPlan = z.infer<typeof FleetDispatchPlanSchema>;

export const FleetDispatchPlanUpdateSchema = z.object({
  operationId: id,
  expectedVersion: positive,
  detailId: id.nullable().optional(),
  driverUserId: positive.nullable().optional(),
  yardOrderId: id.nullable().optional(),
  ticket: ticket.optional(),
  runId: id.optional(),
  state: z.enum(["waiting_on_yard", "ready_to_dispatch", "released"]).optional(),
}).strict();
