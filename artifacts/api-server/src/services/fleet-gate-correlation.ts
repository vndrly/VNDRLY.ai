import {
  FleetGateLinkInputSchema,
  type FleetGateObservation,
  type FleetGateObservations,
  type FleetGateLink,
  type FleetRun,
} from "@workspace/api-zod";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
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
type ObservationRow = {
  id: number;
  site_location_id: number;
  provisional_vehicle_asset_id: string;
  check_in_time: Date | string;
  check_out_time: Date | string | null;
  observed_arrival_at: Date | string | null;
  observed_departure_at: Date | string | null;
  observation_source: string | null;
  reconciliation_state: string;
};
function projection(row: ObservationRow): FleetGateObservation {
  return {
    visitId: row.id,
    siteId: row.site_location_id,
    vehicleAssetId: row.provisional_vehicle_asset_id,
    checkInAt: new Date(row.check_in_time).toISOString(),
    checkOutAt: row.check_out_time
      ? new Date(row.check_out_time).toISOString()
      : null,
    observedArrivalAt: row.observed_arrival_at
      ? new Date(row.observed_arrival_at).toISOString()
      : null,
    observedDepartureAt: row.observed_departure_at
      ? new Date(row.observed_departure_at).toISOString()
      : null,
    source: row.observation_source,
    reconciliationState: row.reconciliation_state,
  };
}
export function createFleetGateOperations(
  transaction: Transaction,
  permitted: Permitted,
) {
  const load = (state: FleetState, actor: FleetActor, id: string) => {
    const run = state.runs.find((r) => r.id === id);
    if (!run || !permitted(state, actor, run, "view"))
      throw new FleetError("fleet.not_found", 404);
    return run;
  };
  const observations = async (client: PoolClient, run: FleetRun) => {
    const start = new Date(
        Date.parse(run.events[0]?.recordedAt ?? new Date().toISOString()) -
          86400000,
      ).toISOString(),
      end = new Date(
        ["completed", "cancelled"].includes(run.status)
          ? Date.parse(
              run.events.at(-1)?.recordedAt ?? new Date().toISOString(),
            ) + 86400000
          : Date.now(),
      ).toISOString();
    const found = await client.query(
      "SELECT v.id,v.site_location_id,v.provisional_vehicle_asset_id,v.check_in_time,v.check_out_time,v.observed_arrival_at,v.observed_departure_at,v.observation_source,v.reconciliation_state FROM site_visits v JOIN assets a ON a.id=v.provisional_vehicle_asset_id WHERE v.provisional_vehicle_asset_id=$1 AND v.site_location_id=ANY($2::int[]) AND v.check_in_time>=$3 AND v.check_in_time<=$4 AND a.responsible_org_type='vendor' AND a.responsible_org_id=$5 ORDER BY v.check_in_time DESC LIMIT 51",
      [run.vehicleAssetId, run.siteIds, start, end, run.companyId],
    );
    if (found.rows.length > 50)
      throw new FleetError("fleet.gate_observation_capacity_reached", 409);
    return found.rows.map(projection);
  };
  return {
    gateObservations: (
      actor: FleetActor,
      id: string,
    ): Promise<FleetGateObservations> =>
      transaction(
        Object.assign(actor, { runId: id }),
        async (state, client) => {
          const run = load(state, actor, id),
            rows = await observations(client, run);
          const saved = await client.query(
            "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-gate-link' AND vendor_id=$1 AND tool_output->>'runId'=$2 ORDER BY id LIMIT 201",
            [actor.companyId, id],
          );
          if (saved.rows.length > 200)
            throw new FleetError("fleet.gate_link_capacity_reached", 409);
          return {
            runId: id,
            version: run.version,
            observations: rows,
            ambiguous: run.siteIds.some(
              (siteId) => rows.filter((r) => r.siteId === siteId).length > 1,
            ),
            basis: "same_equipment_site_time_window",
            automaticAdmissionCreated: false,
            canLink:
              !["completed", "cancelled"].includes(run.status) &&
              (permitted(state, actor, run, "dispatch") ||
                permitted(state, actor, run, "perform_run")),
            links: saved.rows.map((row) => row.tool_output as FleetGateLink),
          };
        },
      ),
    linkGateVisit: (
      actor: FleetActor,
      id: string,
      input: unknown,
    ): Promise<FleetGateLink> => {
      const command = FleetGateLinkInputSchema.parse(input),
        fingerprint = createHash("sha256")
          .update(JSON.stringify({ id, ...command }))
          .digest("hex");
      return transaction(
        Object.assign(actor, { runId: id }),
        async (state, client) => {
          const run = load(state, actor, id);
          if (
            !permitted(state, actor, run, "dispatch") &&
            !permitted(state, actor, run, "perform_run")
          )
            throw new FleetError("fleet.gate_link_forbidden", 403);
          const old = await client.query(
            "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-gate-operation' AND vendor_id=$1 AND target_id=$2 ORDER BY id DESC LIMIT 1",
            [actor.companyId, command.operationId],
          );
          if (old.rows.length) {
            const saved = old.rows[0].tool_output;
            if (
              saved.actorUserId !== actor.userId ||
              saved.fingerprint !== fingerprint
            )
              throw new FleetError("fleet.operation_reused", 409);
            return saved.result;
          }
          if (run.version !== command.expectedVersion)
            throw new FleetError("fleet.version_conflict", 409);
          if (["completed", "cancelled"].includes(run.status))
            throw new FleetError("fleet.gate_link_terminal", 409);
          const stop = run.stops.find((s) => s.id === command.stopId),
            observation = (await observations(client, run)).find(
              (o) => o.visitId === command.visitId,
            );
          if (!stop || !observation || observation.siteId !== stop.siteId)
            throw new FleetError("fleet.gate_observation_not_found", 404);
          const existing = await client.query(
            "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-gate-link' AND vendor_id=$1 AND target_id=$2 ORDER BY id DESC LIMIT 1",
            [actor.companyId, String(command.visitId)],
          );
          if (existing.rows.length)
            throw new FleetError("fleet.gate_visit_already_linked", 409);
          if (run.events.length >= 200)
            throw new FleetError("fleet.store_capacity_reached", 409);
          run.version++;
          const recordedAt = new Date().toISOString(),
            result: FleetGateLink = {
              runId: id,
              stopId: stop.id,
              visitId: command.visitId,
              operationId: command.operationId,
              version: run.version,
              recordedAt,
              observation,
              automaticAdmissionCreated: false,
            };
          run.events.push({
            id: randomUUID(),
            operationId: command.operationId,
            type: "gate_linked",
            actorUserId: actor.userId,
            recordedAt,
            source: "user_report",
            details: {
              stopId: stop.id,
              visitId: command.visitId,
              reason: command.reason,
              observation,
            },
          });
          for (const [type, target, value] of [
            ["fleet-gate-link", String(command.visitId), result],
            [
              "fleet-gate-operation",
              command.operationId,
              { actorUserId: actor.userId, fingerprint, result },
            ],
          ] as const)
            await client.query(
              "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_gate','gate-correlation',$3,$4,$5::jsonb,'completed')",
              [
                actor.userId,
                actor.companyId,
                type,
                target,
                JSON.stringify(value),
              ],
            );
          return result;
        },
      );
    },
  };
}
