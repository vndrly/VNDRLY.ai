import { expect, it } from "vitest";
import * as contracts from "./index";
const api = contracts as unknown as Record<string, any>;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const location = (n: number) =>
  contracts.FleetDestinationSchema.parse({
    id: id(n),
    revision: 1,
    name: `Place ${n}`,
    kind: "pickup",
    address: `${n} Manual road`,
    latitude: null,
    longitude: null,
    ownerType: "vendor",
    ownerId: 7,
  });
const order = () => ({
  id: id(1),
  companyId: 7,
  version: 1,
  name: "Lease tank to collection point",
  accessGroupIds: [id(2)],
  origin: location(3),
  destination: location(4),
  base: null,
  returnPolicy: "delivery_only",
  instructions: "Haul crude to the collection point.",
  timeZone: "America/Chicago",
  archivedAt: null,
});
it("defines a reusable Origin/Destination transport order without driver, Detail, ticket or execution identities", () => {
  const schema = api.FleetRunOrderSchema;
  expect(schema).toBeDefined();
  expect(schema.parse(order())).toMatchObject({
    origin: { latitude: null },
    destination: { latitude: null },
  });
  for (const extra of [
    { driverUserId: 2 },
    { detailId: id(5) },
    { ticketId: 9 },
    { schedule: {} },
  ])
    expect(schema.safeParse({ ...order(), ...extra }).success).toBe(false);
  expect(schema.safeParse({ ...order(), accessGroupIds: [] }).success).toBe(
    false,
  );
  expect(
    schema.safeParse({ ...order(), accessGroupIds: [id(2), id(2)] }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...order(), returnPolicy: "return_required" }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...order(),
      base: location(5),
      returnPolicy: "return_required",
    }).success,
  ).toBe(true);
});
it("instantiates separate repeat activities from one saved order without mutating that order or creating billing/driver facts", () => {
  expect(api.fleetRunOrderRoute).toBeDefined();
  const source = order(),
    original = structuredClone(source);
  let sequence = 10;
  const first = api.fleetRunOrderRoute(source, () => id(sequence++), 2);
  const second = api.fleetRunOrderRoute(source, () => id(sequence++), 1);
  expect(
    contracts.FleetRoutePlanSchema.parse(first).stops.map((stop) => stop.kind),
  ).toEqual(["delivery", "pickup", "delivery"]);
  expect(first.stops[0].id).not.toBe(second.stops[0].id);
  expect(first.stops[0].cycleId).not.toBe(second.stops[0].cycleId);
  expect(source).toEqual(original);
  expect(api.fleetRouteMatchesRunOrder(first, source)).toBe(true);
  expect(
    api.fleetRouteMatchesRunOrder(
      { ...first, origin: { type: "canonical", location: location(6) } },
      source,
    ),
  ).toBe(false);
  expect(first).not.toHaveProperty("driverUserId");
  expect(first).not.toHaveProperty("linkedTicketId");
  expect(() =>
    api.fleetRunOrderRoute(source, () => id(sequence++), 0),
  ).toThrow();
  const returned = api.fleetRunOrderRoute(
    { ...source, base: location(5), returnPolicy: "return_required" },
    () => id(sequence++),
    1,
  );
  expect(returned.stops.at(-1)).toMatchObject({
    kind: "return",
    location: { location: { id: id(5) } },
  });
});
it("requires a Detail and physical route when dispatch selects a saved Run", () => {
  const source = order();
  let sequence = 20;
  const route = api.fleetRunOrderRoute(source, () => id(sequence++));
  const input = {
    operationId: id(10),
    fleetId: id(2),
    title: "First activity",
    driverUserId: 8,
    vehicleAssetId: id(11),
    trailerAssetId: null,
    billing: {
      mode: "new_ticket",
      workTypeId: 3,
      afeNumber: "A1",
      workDate: "2026-10-16",
    },
    runOrderSelection: { id: source.id, version: source.version },
    routePlan: route,
    detailSelection: {
      version: 2,
      detailId: id(12),
      detailVersion: 1,
      timeZone: "America/Chicago",
      returnPolicy: "delivery_only",
    },
    stops: contracts.fleetRouteOperationalStops(route, 9, id(13)),
  };
  expect(contracts.CreateFleetRunSchema.safeParse(input).success).toBe(true);
  const { detailSelection: _, ...missing } = input;
  expect(contracts.CreateFleetRunSchema.safeParse(missing).success).toBe(false);
  expect(
    contracts.CreateFleetRunSchema.safeParse({ ...input, runOrder: source })
      .success,
  ).toBe(false);
});
it("saves a reusable transport order from a matching route without copying the activity schedule or billing", () => {
  expect(api.fleetRunOrderFromRoute).toBeDefined();
  const source = order();
  let sequence = 50;
  const route = api.fleetRunOrderRoute(source, () => id(sequence++), 2, {
    startAt: "2026-10-16T10:00:00Z",
    endAt: "2026-10-16T11:00:00Z",
    timeZone: "America/Chicago",
  });
  const saved = api.fleetRunOrderFromRoute({
    id: id(8),
    companyId: 7,
    name: "Saved crude Run",
    accessGroupIds: [id(2)],
    timeZone: "America/Chicago",
    route,
  });
  expect(saved).toMatchObject({
    id: id(8),
    version: 1,
    origin: source.origin,
    destination: source.destination,
    returnPolicy: "delivery_only",
  });
  expect(saved).not.toHaveProperty("plannedWindow");
  expect(saved).not.toHaveProperty("ticketId");
  expect(() =>
    api.fleetRunOrderFromRoute({
      id: id(8),
      companyId: 7,
      name: "Mixed",
      accessGroupIds: [id(2)],
      timeZone: "America/Chicago",
      route: {
        ...route,
        stops: route.stops.map((stop: any, index: number) =>
          index === 2
            ? {
                ...stop,
                location: { type: "canonical", location: location(9) },
              }
            : stop,
        ),
      },
    }),
  ).toThrow();
});
