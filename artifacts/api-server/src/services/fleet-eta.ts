import {
  FleetEtaSchema,
  type FleetEta,
  type FleetRun,
  type FleetLocationObservation,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import {
  estimateMapboxDrivingRoute,
  type RouteCoordinate,
  type RouteEstimateResult,
} from "../lib/mapbox-routing";
type Transaction = <T>(
  actor: FleetActor,
  operation: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
type Permitted = (
  state: FleetState,
  actor: FleetActor,
  run: FleetRun,
  action: "view" | "dispatch" | "perform_run",
) => boolean;
type Observations = (
  state: FleetState,
  client: PoolClient,
  actor: FleetActor,
) => Promise<FleetLocationObservation[]>;
type Estimator = (args: {
  origin: RouteCoordinate;
  destination: RouteCoordinate;
}) => Promise<RouteEstimateResult>;
export function createFleetEtaOperations(
  transaction: Transaction,
  permitted: Permitted,
  readObservations: Observations,
  estimator: Estimator = (args) =>
    estimateMapboxDrivingRoute(args, { cacheTtlMs: 0 }),
  clock: () => Date = () => new Date(),
) {
  const unavailable = (runId: string, code: string): FleetEta => ({
    ok: false,
    runId,
    code,
    truckSafeRouting: false,
    physicalProofVerified: false,
  });
  const capture = (actor: FleetActor, runId: string) => {
    const bound = { ...actor, runId };
    return transaction(bound, async (state, client) => {
      const run = state.runs.find((r) => r.id === runId);
      if (!run || !permitted(state, bound, run, "view"))
        throw new FleetError("fleet.not_found", 404);
      if (run.status !== "in_progress")
        return { unavailable: "fleet.eta_run_inactive" } as const;
      if (run.phase === "paused")
        return { unavailable: "fleet.eta_run_paused" } as const;
      const observation = (await readObservations(state, client, bound)).find(
          (point) => point.runId === runId,
        ),
        age = observation
          ? clock().getTime() - Date.parse(observation.recordedAt)
          : NaN;
      if (
        !observation ||
        !Number.isFinite(age) ||
        observation.freshness !== "recent" ||
        observation.accuracyMeters === null ||
        observation.accuracyMeters > 1000 ||
        age > 360000 ||
        age < -30000
      )
        return { unavailable: "fleet.eta_location_unavailable" } as const;
      const stop =
        run.stops[run.visitedStopIds.length + (run.currentStopId ? 1 : 0)];
      if (!stop)
        return { unavailable: "fleet.eta_next_stop_unavailable" } as const;
      const site = await client.query(
        "SELECT id,name,latitude,longitude FROM site_locations WHERE id=$1 AND is_active=true AND COALESCE(hidden,false)=false FOR SHARE",
        [stop.siteId],
      );
      const row = site.rows[0];
      if (
        !row ||
        !Number.isFinite(row.latitude) ||
        !Number.isFinite(row.longitude) ||
        row.latitude < -90 ||
        row.latitude > 90 ||
        row.longitude < -180 ||
        row.longitude > 180
      )
        return { unavailable: "fleet.eta_destination_unavailable" } as const;
      return {
        version: run.version,
        assignment: JSON.stringify([
          run.driverUserId,
          run.vehicleAssetId,
          run.trailerAssetId,
        ]),
        stopId: stop.id,
        siteId: stop.siteId,
        siteName: String(row.name),
        observation,
        destination: {
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
        },
      };
    });
  };
  return {
    eta: async (actor: FleetActor, runId: string): Promise<FleetEta> => {
      const before = await capture(actor, runId);
      if ("unavailable" in before)
        return unavailable(runId, before.unavailable!);
      const estimate = await estimator({
        origin: {
          latitude: before.observation.latitude,
          longitude: before.observation.longitude,
        },
        destination: before.destination,
      });
      const after = await capture(actor, runId);
      if ("unavailable" in after) return unavailable(runId, after.unavailable!);
      const identity = (value: typeof before) =>
        JSON.stringify([
          value.version,
          value.assignment,
          value.stopId,
          value.destination,
          value.observation.recordedAt,
          value.observation.receivedAt,
          value.observation.latitude,
          value.observation.longitude,
          value.observation.accuracyMeters,
        ]);
      if (identity(before) !== identity(after))
        return unavailable(runId, "fleet.eta_context_changed");
      if (!estimate.ok) return unavailable(runId, estimate.errorCode);
      return FleetEtaSchema.parse({
        ...estimate,
        ok: true,
        runId,
        stopId: after.stopId,
        siteId: after.siteId,
        siteName: after.siteName,
        estimatedAt: clock().toISOString(),
        source: "driver_phone",
        sourceRecordedAt: after.observation.recordedAt,
        sourceReceivedAt: after.observation.receivedAt,
        sourceAccuracyMeters: after.observation.accuracyMeters,
        truckSafeRouting: false,
        physicalProofVerified: false,
      });
    },
  };
}
