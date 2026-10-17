import { z } from "zod/v4";
import { FleetCanonicalIdSchema, FleetTimeZoneSchema } from "./fleet-details";
import { FleetDestinationSchema } from "./fleet-commercial";
import { FleetRoutePlanSchema, type FleetRoutePlan } from "./fleet-route";

/** Saved transport order. A Detail, ticket and physical work belong to an
 * execution of this order, never to the reusable definition itself. */
export const FleetRunOrderSchema = z
  .object({
    id: FleetCanonicalIdSchema,
    companyId: z.number().int().positive(),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    accessGroupIds: z.array(FleetCanonicalIdSchema).min(1).max(100),
    origin: FleetDestinationSchema,
    destination: FleetDestinationSchema,
    base: FleetDestinationSchema.nullable(),
    returnPolicy: z.enum(["delivery_only", "return_required"]),
    instructions: z.string().trim().max(2000),
    timeZone: FleetTimeZoneSchema,
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((order, ctx) => {
    if (new Set(order.accessGroupIds).size !== order.accessGroupIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["accessGroupIds"],
        message: "Duplicate resource access group",
      });
    if (order.returnPolicy === "return_required" && !order.base)
      ctx.addIssue({
        code: "custom",
        path: ["base"],
        message: "A return-required transport order needs its base",
      });
  });
export type FleetRunOrder = z.infer<typeof FleetRunOrderSchema>;
/** Read-only proposal. Applying this does not persist a Run revision. */
export const FleetRunOrderLocationsSchema = z
  .object({
    orderId: FleetCanonicalIdSchema,
    orderVersion: z.number().int().positive(),
    locations: z.array(FleetDestinationSchema).max(3),
    unavailableLocationIds: z.array(FleetCanonicalIdSchema).max(3),
  })
  .strict();
export function fleetRunOrderWithReviewedLocations(
  raw: FleetRunOrder,
  input: unknown,
): FleetRunOrder {
  const order = FleetRunOrderSchema.parse(raw),
    review = FleetRunOrderLocationsSchema.parse(input);
  if (
    review.orderId !== order.id ||
    review.orderVersion !== order.version ||
    review.unavailableLocationIds.length
  )
    throw new Error("Saved Run locations need review.");
  const replace = (saved: FleetRunOrder["origin"]) => {
    const current = review.locations.find(
      (place) =>
        place.id === saved.id &&
        place.ownerType === saved.ownerType &&
        place.ownerId === saved.ownerId,
    );
    if (!current?.active) throw new Error("Saved Run location unavailable.");
    return current;
  };
  return FleetRunOrderSchema.parse({
    ...order,
    origin: replace(order.origin),
    destination: replace(order.destination),
    base: order.base ? replace(order.base) : null,
  });
}
export const FleetRunOrderSelectionSchema = z
  .object({ id: FleetCanonicalIdSchema, version: z.number().int().positive() })
  .strict();
export const FleetRunOrderSaveSchema = z
  .object({
    operationId: FleetCanonicalIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    order: FleetRunOrderSchema,
  })
  .strict();
export const FleetRunOrderPageSchema = z
  .object({
    orders: z.array(FleetRunOrderSchema),
    nextCursor: z.number().int().positive().nullable(),
    canManage: z.boolean(),
  })
  .strict();
export const FleetRunOrderReceiptSchema = z
  .object({
    operationId: FleetCanonicalIdSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    order: FleetRunOrderSchema,
  })
  .strict();
export const FleetRunOrderHistorySchema = z
  .object({
    records: z.array(
      z
        .object({ id: z.number().int().positive(), order: FleetRunOrderSchema })
        .strict(),
    ),
    nextCursor: z.number().int().positive().nullable(),
  })
  .strict();

export function fleetRunOrderRoute(
  raw: FleetRunOrder,
  makeId: () => string,
  cycles = 1,
  plannedWindow: FleetRoutePlan["plannedWindow"] = null,
): FleetRoutePlan {
  const order = FleetRunOrderSchema.parse(raw);
  z.number().int().min(1).max(100).parse(cycles);
  const stops: FleetRoutePlan["stops"] = [];
  const reference = (location: FleetRunOrder["origin"]) => ({
    type: "canonical" as const,
    location: FleetDestinationSchema.parse(location),
  });
  for (let cycle = 0; cycle < cycles; cycle++) {
    const cycleId = makeId();
    if (cycle)
      stops.push({
        id: makeId(),
        kind: "pickup",
        sequence: stops.length,
        cycleId,
        location: reference(order.origin),
      });
    stops.push({
      id: makeId(),
      kind: "delivery",
      sequence: stops.length,
      cycleId,
      location: reference(order.destination),
      ...(order.instructions ? { instructions: order.instructions } : {}),
    });
  }
  if (order.returnPolicy === "return_required")
    stops.push({
      id: makeId(),
      kind: "return",
      sequence: stops.length,
      cycleId: null,
      location: reference(order.base!),
    });
  return FleetRoutePlanSchema.parse({
    origin: reference(order.origin),
    stops,
    returnPolicy: order.returnPolicy,
    base:
      order.returnPolicy === "return_required" ? reference(order.base!) : null,
    plannedWindow,
  });
}

/** Operational stop IDs, cycle IDs and schedule are execution-specific. The
 * saved pair/return snapshots cannot silently become a different order. */
export function fleetRouteMatchesRunOrder(
  raw: FleetRoutePlan,
  rawOrder: FleetRunOrder,
): boolean {
  const parsed = FleetRoutePlanSchema.safeParse(raw),
    saved = FleetRunOrderSchema.safeParse(rawOrder);
  if (!parsed.success || !saved.success) return false;
  const route = parsed.data,
    order = saved.data;
  const same = (
    reference: FleetRoutePlan["origin"] | null,
    location: FleetRunOrder["origin"] | null,
  ) =>
    reference?.type === "canonical" &&
    JSON.stringify(reference.location) === JSON.stringify(location);
  if (
    !same(route.origin, order.origin) ||
    route.returnPolicy !== order.returnPolicy
  )
    return false;
  const stops = [...route.stops];
  if (order.returnPolicy === "return_required") {
    const last = stops.pop();
    if (
      last?.kind !== "return" ||
      !same(last.location, order.base) ||
      !same(route.base, order.base)
    )
      return false;
  } else if (route.base !== null) return false;
  return (
    stops.length > 0 &&
    stops.length % 2 === 1 &&
    stops.every(
      (stop, index) =>
        stop.kind === (index % 2 ? "pickup" : "delivery") &&
        same(stop.location, index % 2 ? order.origin : order.destination),
    )
  );
}

export function fleetRunOrderFromRoute(input: {
  id: string;
  companyId: number;
  name: string;
  accessGroupIds: string[];
  timeZone: string;
  route: FleetRoutePlan;
}): FleetRunOrder {
  const route = FleetRoutePlanSchema.parse(input.route),
    delivery = route.stops.find((stop) => stop.kind === "delivery");
  if (
    route.origin.type !== "canonical" ||
    delivery?.location.type !== "canonical" ||
    (route.base && route.base.type !== "canonical")
  )
    throw new Error("fleet.route_location_unresolved");
  const order = FleetRunOrderSchema.parse({
    id: input.id,
    companyId: input.companyId,
    version: 1,
    name: input.name,
    accessGroupIds: input.accessGroupIds,
    origin: route.origin.location,
    destination: delivery.location.location,
    base: route.base?.type === "canonical" ? route.base.location : null,
    returnPolicy: route.returnPolicy,
    instructions: delivery.instructions ?? "",
    timeZone: input.timeZone,
    archivedAt: null,
  });
  if (!fleetRouteMatchesRunOrder(route, order))
    throw new Error("fleet.run_order_route_mismatch");
  return order;
}
