import { describe, expect, it } from "vitest";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";
function schema(name: string): ZodType<any> {
  const contract = (contracts as unknown as Record<string, ZodType<any>>)[name];
  expect(contract, name).toBeDefined();
  return contract;
}

const truck = "11111111-1111-4111-8111-111111111111";
const trailer = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const detailId = "44444444-4444-4444-8444-444444444444";
const window = {
  effectiveFrom: "2026-10-16T12:00:00Z",
  effectiveUntil: null,
  archivedAt: null,
};
const packageInput = {
  id: packageId,
  companyId: 11,
  version: 1,
  name: "Tank package",
  components: [{ assetId: trailer, role: "trailer", sequence: 0 }],
  ...window,
};
const detailInput = {
  id: detailId,
  companyId: 11,
  version: 1,
  name: "Bob / Tank 1",
  vehicleAssetId: truck,
  rigPackageId: packageId,
  rigPackageVersion: 1,
  driverUserId: 42,
  accessGroupIds: [],
  ...window,
};

describe("canonical Fleet Detail contracts", () => {
  it("parses legacy Detail driver history but new Detail saves require null driver", () => {
    const snapshot = schema("FleetDetailSnapshotSchema").parse({
      detail: detailInput,
      rigPackage: packageInput,
      labels: { truck: "Truck 1", rigPackage: "Tank package", driver: "Bob Villa", components: [{ assetId: trailer, label: "Tank 1" }] },
      carrierOfRecordId: 11,
      snapshottedAt: "2026-10-16T12:05:00Z",
    });
    expect(snapshot.detail.driverUserId).toBe(42);
    expect(snapshot.labels.driver).toBe("Bob Villa");
    expect(schema("FleetDetailSnapshotSchema").safeParse({
      ...snapshot, detail: { ...snapshot.detail, driverUserId: null },
    }).success).toBe(false);
    const normalize = (contracts as any).normalizeFleetDetail;
    expect(normalize, "legacy Detail normalizer").toBeTypeOf("function");
    expect(normalize(detailInput).driverUserId).toBeNull();
    const save = schema("FleetDetailSaveSchema");
    expect(save.safeParse({ operationId: packageId, expectedVersion: 1, detail: detailInput }).success).toBe(false);
    expect(save.parse({ operationId: packageId, expectedVersion: 1, detail: { ...detailInput, driverUserId: null } }).detail.driverUserId).toBeNull();
  });

  it("keeps run assignment driver separate from reusable Detail identity", () => {
    const reusable = { ...detailInput, driverUserId: null };
    const detail = schema("FleetDetailSchema").parse(reusable);
    expect(detail.driverUserId).toBeNull();
    const reservation = schema("FleetReservationSchema").parse({
      id: packageId, runId: packageId, detailId, detailVersion: 1,
      driverUserId: 57, assetIds: [truck], startAt: "2026-10-16T12:00:00Z",
      plannedEndAt: null, timeZone: "America/Chicago", state: "reserved",
      actualReleasedAt: null, releaseReason: null, version: 1,
    });
    expect(reservation.driverUserId).toBe(57);
    expect(detail.driverUserId).toBeNull();
  });
  it("compares assigned resources and revisions independently of cached display labels and read time", () => {
    const snapshot = schema("FleetDetailSnapshotSchema").parse({
      detail: detailInput, rigPackage: packageInput,
      labels: { truck: "Truck 1", rigPackage: "Tank package", driver: "Bob Villa", components: [{ assetId: trailer, label: "Tank 1" }] },
      carrierOfRecordId: 11, snapshottedAt: "2026-10-16T12:05:00Z",
    });
    const matches = (contracts as any).fleetDetailSnapshotIdentityMatches;
    expect(matches, "resource identity comparator").toBeTypeOf("function");
    const cached = { ...snapshot, labels: { ...snapshot.labels, driver: "Cached display name" }, snapshottedAt: "2026-10-16T11:00:00Z" };
    expect(matches(snapshot, cached)).toBe(true);
    for (const changed of [
      { ...cached, carrierOfRecordId: 12 },
      { ...cached, detail: { ...cached.detail, driverUserId: 43 } },
      { ...cached, detail: { ...cached.detail, vehicleAssetId: "99999999-9999-4999-8999-999999999999" } },
      { ...cached, detail: { ...cached.detail, version: 2 } },
      { ...cached, rigPackage: { ...cached.rigPackage, components: [{ assetId: "99999999-9999-4999-8999-999999999999", role: "trailer", sequence: 0 }] } },
    ]) expect(matches(snapshot, changed)).toBe(false);
  });
  it("normalizes UUID casing before duplicate and identity checks", () => {
    const mixed = "aabbccdd-eeee-4fff-8111-aaaaaaaaaaaa";
    expect(
      schema("FleetDetailSchema").parse({
        ...detailInput,
        id: mixed.toUpperCase(),
      }).id,
    ).toBe(mixed);
    expect(
      schema("FleetRigPackageSchema").safeParse({
        ...packageInput,
        components: [
          { assetId: mixed, role: "trailer", sequence: 0 },
          { assetId: mixed.toUpperCase(), role: "dolly", sequence: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  it("represents unscheduled work explicitly until release without guessing a free-after time", () => {
    expect(
      schema("FleetReservationSchema").parse({
        id: detailId,
        runId: packageId,
        detailId,
        detailVersion: 1,
        driverUserId: 42,
        assetIds: [truck],
        startAt: "2026-10-16T12:00:00Z",
        plannedEndAt: null,
        timeZone: "America/Chicago",
        state: "reserved",
        actualReleasedAt: null,
        releaseReason: null,
        version: 1,
      }).plannedEndAt,
    ).toBeNull();
  });
  it("rejects duplicate components even when their roles differ", () => {
    expect(
      schema("FleetRigPackageSchema").safeParse({
        ...packageInput,
        components: [
          ...packageInput.components,
          { assetId: trailer, role: "dolly", sequence: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  it("allows a service truck without a towed package", () => {
    expect(
      schema("FleetDetailSchema").parse({
        ...detailInput,
        rigPackageId: null,
        rigPackageVersion: null,
      }),
    ).toMatchObject({ driverUserId: 42, rigPackageId: null });
  });
  it("requires a matched package identity and revision", () => {
    expect(
      schema("FleetDetailSchema").safeParse({
        ...detailInput,
        rigPackageVersion: null,
      }).success,
    ).toBe(false);
  });
  it("retains the exact component revision in an assignment snapshot", () => {
    const snapshot = schema("FleetDetailSnapshotSchema").parse({
      detail: detailInput,
      rigPackage: packageInput,
      labels: {
        truck: "Truck 1",
        rigPackage: "Tank package",
        driver: "Bob Villa",
        components: [{ assetId: trailer, label: "Tank 1" }],
      },
      carrierOfRecordId: 11,
      snapshottedAt: "2026-10-16T12:05:00Z",
    });
    expect(snapshot.rigPackage?.version).toBe(1);
    expect(snapshot.rigPackage?.components).toEqual([
      { assetId: trailer, role: "trailer", sequence: 0 },
    ]);
    expect(
      schema("FleetDetailSnapshotSchema").safeParse({
        ...snapshot,
        rigPackage: { ...packageInput, version: 2 },
      }).success,
    ).toBe(false);
  });
  it("refuses snapshots that put the power unit inside its own package", () => {
    expect(
      schema("FleetDetailSnapshotSchema").safeParse({
        detail: detailInput,
        rigPackage: {
          ...packageInput,
          components: [{ assetId: truck, role: "trailer", sequence: 0 }],
        },
        labels: {
          truck: "Truck 1",
          rigPackage: "Tank",
          driver: "Bob",
          components: [{ assetId: truck, label: "Truck 1" }],
        },
        carrierOfRecordId: 11,
        snapshottedAt: "2026-10-16T12:05:00Z",
      }).success,
    ).toBe(false);
  });
  it("rejects reversed effective windows", () => {
    expect(
      schema("FleetRigPackageSchema").safeParse({
        ...packageInput,
        effectiveUntil: "2026-10-16T11:59:59Z",
      }).success,
    ).toBe(false);
  });
  it("does not silently release an active reservation at its planned end", () => {
    const reservation = {
      id: detailId,
      runId: packageId,
      detailId,
      detailVersion: 1,
      driverUserId: 42,
      assetIds: [truck, trailer],
      startAt: "2026-10-16T12:00:00Z",
      plannedEndAt: "2026-10-16T13:00:00Z",
      timeZone: "America/Chicago",
      state: "active",
      actualReleasedAt: null,
      releaseReason: null,
      version: 1,
    };
    expect(schema("FleetReservationSchema").parse(reservation).state).toBe(
      "active",
    );
    expect(
      schema("FleetReservationSchema").safeParse({
        ...reservation,
        state: "released",
      }).success,
    ).toBe(false);
  });
});
