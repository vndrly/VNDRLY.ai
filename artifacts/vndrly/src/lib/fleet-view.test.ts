import { describe, expect, it } from "vitest";
import type { FleetOverview } from "@workspace/api-zod";
import { fleetPositions, fleetVisibleRuns } from "./fleet-view";
const overview = {
  companyId: 1,
  runs: [
    {
      id: "own",
      companyId: 1,
      fleetId: "a",
      driverUserId: 7,
      siteIds: [10],
      title: "Pickup water",
    },
    {
      id: "other",
      companyId: 1,
      fleetId: "b",
      driverUserId: 8,
      siteIds: [20],
      title: "Delivery",
    },
    {
      id: "foreign",
      companyId: 2,
      fleetId: "a",
      driverUserId: 7,
      siteIds: [10],
      title: "Pickup water",
    },
  ],
  observations: [
    {
      runId: "own",
      source: "driver_phone",
      freshness: "recent",
      latitude: 35,
      longitude: -97,
    },
    {
      runId: "other",
      source: "driver_phone",
      freshness: "recent",
      latitude: 35,
      longitude: -97,
    },
    {
      runId: "own",
      source: "driver_phone",
      freshness: "unavailable",
      latitude: 35,
      longitude: -97,
    },
    {
      runId: "own",
      source: "driver_phone",
      freshness: "recent",
      latitude: NaN,
      longitude: -97,
    },
    {
      runId: "own",
      source: "driver_phone",
      freshness: "recent",
      latitude: 95,
      longitude: -97,
    },
  ],
} as unknown as FleetOverview;
describe("Fleet view isolation", () => {
  it("keeps My Day own-driver/company records and applies site/fleet filters", () => {
    expect(
      fleetVisibleRuns(overview, 7, true, "a", "10", "WATER").map((r) => r.id),
    ).toEqual(["own"]);
    expect(fleetVisibleRuns(overview, 7, true, "", "20", "")).toEqual([]);
    expect(
      fleetVisibleRuns(overview, 7, false, "", "", "").map((r) => r.id),
    ).toEqual(["own", "other"]);
  });
  it("maps only visible recorded positions and rejects unavailable or invalid coordinates", () => {
    expect(fleetPositions(overview, new Set(["own"]))).toEqual([
      overview.observations[0],
    ]);
  });
});
