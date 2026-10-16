import { expect, it } from "vitest";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";
const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const window = {
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveUntil: null,
  archivedAt: null,
};
const snapshot = {
  detail: {
    id: id(1),
    companyId: 7,
    version: 1,
    name: "Bob / Tank",
    vehicleAssetId: id(2),
    driverUserId: 42,
    rigPackageId: id(3),
    rigPackageVersion: 1,
    accessGroupIds: [],
    ...window,
  },
  rigPackage: {
    id: id(3),
    companyId: 7,
    version: 1,
    name: "Tank rig",
    components: [
      { assetId: id(4), role: "trailer", sequence: 0 },
      { assetId: id(5), role: "dolly", sequence: 1 },
    ],
    ...window,
  },
  labels: {
    truck: "Truck",
    driver: "Bob",
    rigPackage: "Tank rig",
    components: [
      { assetId: id(4), label: "Trailer" },
      { assetId: id(5), label: "Dolly" },
    ],
  },
  carrierOfRecordId: 7,
  snapshottedAt: "2026-10-16T12:00:00Z",
};
const reservation = {
  id: id(6),
  runId: id(7),
  detailId: id(1),
  detailVersion: 1,
  driverUserId: 42,
  assetIds: [id(2), id(4), id(5)],
  startAt: "2026-10-16T12:00:00Z",
  plannedEndAt: null,
  timeZone: "America/Chicago",
  state: "reserved",
  actualReleasedAt: null,
  releaseReason: null,
  version: 1,
};
function schema(name: string) {
  const value = (contracts as unknown as Record<string, ZodType<any>>)[name];
  expect(value, name).toBeDefined();
  return value;
}
it("binds a versioned run assignment to every component and the exact driver/Detail revision", () => {
  const input = {
    version: 2,
    snapshot,
    reservation,
    returnPolicy: "delivery_only",
  };
  expect(
    schema("FleetResourceAssignmentSchema").parse(input).reservation.assetIds,
  ).toHaveLength(3);
  for (const changed of [
    { ...reservation, assetIds: [id(2), id(4)] },
    { ...reservation, driverUserId: 43 },
    { ...reservation, detailVersion: 2 },
  ])
    expect(
      schema("FleetResourceAssignmentSchema").safeParse({
        ...input,
        reservation: changed,
      }).success,
    ).toBe(false);
});
it("requires a real chosen return stop before creating return-required Detail work", () => {
  const input = {
    operationId: id(8),
    fleetId: id(9),
    title: "Haul",
    driverUserId: 42,
    vehicleAssetId: id(2),
    trailerAssetId: id(4),
    billing: {
      mode: "new_ticket",
      workTypeId: 3,
      afeNumber: "A1",
      workDate: "2026-10-16",
    },
    detailSelection: {
      version: 2,
      detailId: id(1),
      detailVersion: 1,
      timeZone: "America/Chicago",
      returnPolicy: "return_required",
    },
    stops: [
      { id: id(10), siteId: 9, kind: "pickup", sequence: 0 },
      { id: id(11), siteId: 9, kind: "delivery", sequence: 1 },
    ],
  };
  expect(schema("CreateFleetRunSchema").safeParse(input).success).toBe(false);
  expect(
    schema("CreateFleetRunSchema").parse({
      ...input,
      stops: [
        ...input.stops,
        { id: id(12), siteId: 9, kind: "return", sequence: 2 },
      ],
    }).detailSelection.returnPolicy,
  ).toBe("return_required");
});
