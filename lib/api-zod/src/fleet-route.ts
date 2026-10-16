import { z } from "zod/v4";
import { FleetDestinationSchema } from "./fleet-commercial";
import { FleetTimeZoneSchema } from "./fleet-details";

const coordinates = { latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable() };
export const FleetRouteLocationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("canonical"), location: FleetDestinationSchema }).strict(),
  z.object({ type: z.literal("provisional"), localId: z.uuid(), name: z.string().trim().min(1).max(160), address: z.string().trim().min(1).max(500), ...coordinates, capturedAt: z.iso.datetime({ offset: true }) }).strict(),
]).superRefine((value, ctx) => {
  if (value.type === "provisional" && ((value.latitude === null) !== (value.longitude === null))) ctx.addIssue({ code: "custom", message: "Coordinates must be a pair or both unknown" });
});
export type FleetRouteLocation = z.infer<typeof FleetRouteLocationSchema>;
export const FleetRouteStopSchema = z.object({ id: z.uuid(), kind: z.enum(["pickup", "delivery", "return"]), sequence: z.number().int().nonnegative(), cycleId: z.uuid().nullable(), location: FleetRouteLocationSchema, instructions: z.string().max(2000).optional() }).strict();
export const FleetRoutePlanSchema = z.object({
  origin: FleetRouteLocationSchema, stops: z.array(FleetRouteStopSchema).min(1).max(500),
  returnPolicy: z.enum(["delivery_only", "return_required"]), base: FleetRouteLocationSchema.nullable(),
  plannedWindow: z.object({ startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }), timeZone: FleetTimeZoneSchema }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.returnPolicy === "return_required" && value.base === null) ctx.addIssue({ code: "custom", path: ["base"], message: "A return-required run needs its base" });
  if (new Set(value.stops.map(row => row.id)).size !== value.stops.length || value.stops.some((row, index) => row.sequence !== index)) ctx.addIssue({ code: "custom", path: ["stops"], message: "Stops need unique identities and contiguous ordered sequence" });
  if (!value.stops.some(row => row.kind === "delivery")) ctx.addIssue({ code: "custom", path: ["stops"], message: "A destination is required" });
  if (Date.parse(value.plannedWindow.endAt) <= Date.parse(value.plannedWindow.startAt)) ctx.addIssue({ code: "custom", path: ["plannedWindow", "endAt"], message: "Run end must follow start" });
});
export type FleetRoutePlan = z.infer<typeof FleetRoutePlanSchema>;
