import { z } from "zod/v4";
import { FleetDestinationSchema } from "./fleet-commercial";
import { FleetTimeZoneSchema } from "./fleet-details";
export const FleetRouteOperationalStopSchema = z
  .object({
    cycleId: z.uuid().nullable().optional(),
    instructions: z.string().max(2000).optional(),
    destination: FleetDestinationSchema.optional(),
    id: z.uuid(),
    siteId: z.number().int().positive(),
    kind: z.enum(["pickup", "delivery", "return"]),
    sequence: z.number().int().nonnegative(),
  })
  .strict();

const coordinates = {
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
};
export const FleetRouteLocationSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("canonical"),
        location: FleetDestinationSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("provisional"),
        localId: z.uuid(),
        name: z.string().trim().min(1).max(160),
        address: z.string().trim().min(1).max(500),
        ...coordinates,
        capturedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (
      value.type === "provisional" &&
      (value.latitude === null) !== (value.longitude === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Coordinates must be a pair or both unknown",
      });
  });
export type FleetRouteLocation = z.infer<typeof FleetRouteLocationSchema>;
export const FleetRouteStopSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["pickup", "delivery", "return"]),
    sequence: z.number().int().nonnegative(),
    cycleId: z.uuid().nullable(),
    location: FleetRouteLocationSchema,
    instructions: z.string().max(2000).optional(),
  })
  .strict();
export const FleetRoutePlanSchema = z
  .object({
    origin: FleetRouteLocationSchema,
    stops: z.array(FleetRouteStopSchema).min(1).max(500),
    returnPolicy: z.enum(["delivery_only", "return_required"]),
    base: FleetRouteLocationSchema.nullable(),
    plannedWindow: z
      .object({
        startAt: z.iso.datetime({ offset: true }),
        endAt: z.iso.datetime({ offset: true }),
        timeZone: FleetTimeZoneSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.returnPolicy === "return_required" && value.base === null)
      ctx.addIssue({
        code: "custom",
        path: ["base"],
        message: "A return-required run needs its base",
      });
    if (
      new Set(value.stops.map((row) => row.id)).size !== value.stops.length ||
      value.stops.some((row, index) => row.sequence !== index)
    )
      ctx.addIssue({
        code: "custom",
        path: ["stops"],
        message: "Stops need unique identities and contiguous ordered sequence",
      });
    if (!value.stops.some((row) => row.kind === "delivery"))
      ctx.addIssue({
        code: "custom",
        path: ["stops"],
        message: "A destination is required",
      });
    if (
      value.plannedWindow &&
      Date.parse(value.plannedWindow.endAt) <=
        Date.parse(value.plannedWindow.startAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["plannedWindow", "endAt"],
        message: "Run end must follow start",
      });
  });
export type FleetRoutePlan = z.infer<typeof FleetRoutePlanSchema>;
export function fleetRouteMatchesSchedule(route:FleetRoutePlan,schedule:{plannedStartAt:string;plannedEndAt:string;timezone:string}|null|undefined):boolean{
 const window=route.plannedWindow;
 if(!schedule)return window===null;
 return !!window&&Date.parse(window.startAt)===Date.parse(schedule.plannedStartAt)&&Date.parse(window.endAt)===Date.parse(schedule.plannedEndAt)&&window.timeZone===schedule.timezone;
}

/** siteId is the separately authorized billing context, never a physical
 * destination identity. Physical snapshots remain explicit on each stop. */
export function fleetRouteOperationalStops(
  raw: FleetRoutePlan,
  billingSiteId: number,
  originStopId: string,
) {
  const route = FleetRoutePlanSchema.parse(raw);
  z.number().int().positive().parse(billingSiteId);
  z.uuid().parse(originStopId);
  if (route.stops.some((stop) => stop.id === originStopId))
    throw new Error("fleet.invalid_stops");
  if (route.returnPolicy === "return_required") {
    const last = route.stops.at(-1);
    if (
      last?.kind !== "return" ||
      JSON.stringify(last.location) !== JSON.stringify(route.base)
    )
      throw new Error("fleet.return_stop_required");
  }
  function canonical(value: FleetRouteLocation) {
    if (value.type !== "canonical")
      throw new Error("fleet.route_location_unresolved");
    return FleetDestinationSchema.parse(value.location);
  }
  return [
    {
      id: originStopId,
      siteId: billingSiteId,
      kind: "pickup" as const,
      sequence: 0,
      cycleId: route.stops[0]?.cycleId ?? null,
      destination: canonical(route.origin),
    },
    ...route.stops.map((stop, index) => ({
      id: stop.id,
      siteId: billingSiteId,
      kind: stop.kind,
      sequence: index + 1,
      cycleId: stop.cycleId,
      destination: canonical(stop.location),
      ...(stop.instructions ? { instructions: stop.instructions } : {}),
    })),
  ];
}
export function fleetPhysicalStopsMatch(
  route: FleetRoutePlan,
  billingSiteId: number,
  stops: readonly {
    id: string;
    siteId: number;
    kind: string;
    sequence: number;
    cycleId?: string | null;
    instructions?: string;
    destination?: z.infer<typeof FleetDestinationSchema>;
  }[],
) {
  try {
    const expected = fleetRouteOperationalStops(
      route,
      billingSiteId,
      stops[0]?.id,
    );
    return (
      expected.length === stops.length &&
      expected.every((stop, index) => {
        const actual = stops[index];
        return (
          stop.id === actual.id &&
          stop.siteId === actual.siteId &&
          stop.kind === actual.kind &&
          stop.sequence === actual.sequence &&
          stop.cycleId === (actual.cycleId ?? null) &&
          ("instructions" in stop ? stop.instructions : undefined) ===
            actual.instructions &&
          JSON.stringify(stop.destination) ===
            JSON.stringify(actual.destination)
        );
      })
    );
  } catch {
    return false;
  }
}
