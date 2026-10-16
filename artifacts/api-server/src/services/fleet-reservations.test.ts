import { expect, it } from "vitest";
import type { FleetReservation } from "@workspace/api-zod";

const truck = "11111111-1111-4111-8111-111111111111",
  dolly = "22222222-2222-4222-8222-222222222222";
const first: FleetReservation = {
  id: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444",
  detailId: "55555555-5555-4555-8555-555555555555",
  detailVersion: 1,
  driverUserId: 42,
  assetIds: [truck, dolly],
  startAt: "2026-10-16T12:00:00Z",
  plannedEndAt: "2026-10-16T13:00:00Z",
  timeZone: "America/Chicago",
  state: "reserved",
  actualReleasedAt: null,
  releaseReason: null,
  version: 1,
};
async function api() {
  const module = await import("./fleet-reservations").catch(() => null);
  expect(module, "Fleet reservation operations").not.toBeNull();
  return module!;
}
it("detects a shared dolly even when the truck and driver differ", async () => {
  const candidate = {
    ...first,
    id: "66666666-6666-4666-8666-666666666666",
    runId: "77777777-7777-4777-8777-777777777777",
    driverUserId: 43,
    assetIds: ["88888888-8888-4888-8888-888888888888", dolly],
  };
  expect(
    (await api())
      .fleetReservationConflicts(candidate, [first])
      .map((row) => row.id),
  ).toEqual([first.id]);
});
it("keeps an unscheduled reservation busy until its explicit operational release", async () => {
  const candidate = {
    ...first,
    runId: "77777777-7777-4777-8777-777777777777",
    startAt: "2026-10-20T12:00:00Z",
    plannedEndAt: null,
  };
  expect(
    (await api()).fleetReservationConflicts(candidate, [
      { ...first, plannedEndAt: null },
    ]),
  ).toHaveLength(1);
});
it("permits adjacent half-open reservations but keeps an active overrun busy", async () => {
  const candidate = {
    ...first,
    runId: "77777777-7777-4777-8777-777777777777",
    startAt: "2026-10-16T13:00:00Z",
    plannedEndAt: "2026-10-16T14:00:00Z",
  };
  const module = await api();
  expect(module.fleetReservationConflicts(candidate, [first])).toEqual([]);
  expect(
    module.fleetReservationConflicts(candidate, [
      { ...first, state: "active" },
    ]),
  ).toHaveLength(1);
  expect(
    module.fleetReservationConflicts(candidate, [
      {
        ...first,
        state: "released",
        actualReleasedAt: "2026-10-16T13:00:00Z",
        releaseReason: "Driver closeout",
      },
    ]),
  ).toEqual([]);
});
it("releases delivery-only closure without waiting for office review, but requires a chosen return", async () => {
  const module = await api();
  expect(
    module.fleetOperationalReleaseReady({
      closed: true,
      returnPolicy: "delivery_only",
      returnRecorded: false,
    }),
  ).toBe(true);
  expect(
    module.fleetOperationalReleaseReady({
      closed: true,
      returnPolicy: "return_required",
      returnRecorded: false,
    }),
  ).toBe(false);
  expect(
    module.fleetOperationalReleaseReady({
      closed: true,
      returnPolicy: "return_required",
      returnRecorded: true,
    }),
  ).toBe(true);
});
