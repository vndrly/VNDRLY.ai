import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FleetRunSchema, type FleetLocationObservation } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { emptyFleetState, type FleetState } from "./fleet-repository";
import { createFleetEtaOperations } from "./fleet-eta";

function fixture() {
  const now = new Date("2026-10-07T12:00:00Z");
  const run = FleetRunSchema.parse({ id: randomUUID(), fleetId: randomUUID(), companyId: 7, title: "Synthetic", driverUserId: 2, vehicleAssetId: randomUUID(), trailerAssetId: null, siteIds: [9], status: "in_progress", phase: "en_route", version: 4, stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }], loads: [], inspections: [], currentStopId: null, visitedStopIds: [], events: [], linkedTicketId: null, allowedActions: [] });
  const state = { ...emptyFleetState(), enabled: true, runs: [run] };
  const actor: FleetActor = { userId: 2, companyId: 7 };
  let allowed = true, consent = true;
  const point = { runId: run.id, latitude: 35, longitude: -97, accuracyMeters: 12, recordedAt: now.toISOString(), receivedAt: now.toISOString(), freshness: "recent", source: "driver_phone", physicalProofVerified: false } as FleetLocationObservation;
  const client = { query: async () => ({ rows: [{ id: 9, name: "Synthetic site", latitude: 36, longitude: -98 }] }) } as unknown as PoolClient;
  const transaction = async <T>(_actor: FleetActor, operation: (state: FleetState, client: PoolClient) => Promise<T>) => operation(state, client);
  const estimator = vi.fn(async () => ({ ok: true as const, provider: "mapbox" as const, trafficAware: true, routeConfidence: "medium" as const, distanceMiles: 8, durationMinutes: 12 }));
  const service = createFleetEtaOperations(transaction, () => allowed, async () => consent ? [point] : [], estimator, () => now);
  return { run, actor, point, estimator, service, revoke: () => { allowed = false; }, revokeConsent: () => { consent = false; } };
}

describe("Fleet ETA sourced authorization", () => {
  it("uses only recorded phone origin and actual next site and labels routing limitations", async () => {
    const f = fixture();
    expect(await f.service.eta(f.actor, f.run.id)).toMatchObject({ ok: true, siteId: 9, source: "driver_phone", sourceAccuracyMeters: 12, truckSafeRouting: false, physicalProofVerified: false });
    expect(f.estimator).toHaveBeenCalledWith({ origin: { latitude: 35, longitude: -97 }, destination: { latitude: 36, longitude: -98 } });
  });
  it.each(["paused", "stale", "consent"])("does not call provider when %s", async (mode) => {
    const f = fixture();
    if (mode === "paused") f.run.phase = "paused";
    if (mode === "stale") f.point.freshness = "stale";
    if (mode === "consent") f.revokeConsent();
    expect(await f.service.eta(f.actor, f.run.id)).toMatchObject({ ok: false });
    expect(f.estimator).not.toHaveBeenCalled();
  });
  it.each(["assignment", "stop", "consent", "revocation"])("rechecks %s after provider returns", async (mode) => {
    const f = fixture();
    f.estimator.mockImplementationOnce(async () => {
      if (mode === "assignment") f.run.driverUserId = 3;
      if (mode === "stop") f.run.stops[0].id = randomUUID();
      if (mode === "consent") f.revokeConsent();
      if (mode === "revocation") f.revoke();
      return { ok: true, provider: "mapbox", trafficAware: true, routeConfidence: "medium", distanceMiles: 8, durationMinutes: 12 };
    });
    if (mode === "revocation") await expect(f.service.eta(f.actor, f.run.id)).rejects.toMatchObject({ status: 404 });
    else expect(await f.service.eta(f.actor, f.run.id)).toMatchObject({ ok: false });
  });
});
