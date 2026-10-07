import { FleetDraftEditSchema, type FleetRun } from "@workspace/api-zod";
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
export function createFleetPlanningOperations(
  transaction: Transaction,
  permitted: Permitted,
  eligible: (
    state: FleetState,
    client: PoolClient,
    run: FleetRun,
  ) => Promise<void>,
  project: (state: FleetState, actor: FleetActor, run: FleetRun) => FleetRun,
) {
  return {
    editDraft: (actor: FleetActor, runId: string, input: unknown) => {
      const body = FleetDraftEditSchema.parse(input),
        bound = { ...actor, runId, operationId: body.operationId };
      return transaction(bound, async (state, client) => {
        const run = state.runs.find((row) => row.id === runId);
        if (!run || !permitted(state, bound, run, "dispatch"))
          throw new FleetError("fleet.not_found", 404);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ runId, ...body }))
          .digest("hex");
        const replay = state.operations.find(
          (row) => row.id === body.operationId,
        );
        if (replay) {
          if (
            replay.actorUserId !== bound.userId ||
            replay.fingerprint !== fingerprint
          )
            throw new FleetError("fleet.operation_conflict");
          return project(state, bound, replay.result);
        }
        if (run.status !== "draft")
          throw new FleetError("fleet.action_forbidden", 403);
        if (run.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (run.events.length >= 200 || state.operations.length >= 2000)
          throw new FleetError("fleet.store_capacity_reached");
        const next = {
          ...run,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
          ...(body.stops
            ? {
                stops: body.stops,
                siteIds: [...new Set(body.stops.map((row) => row.siteId))],
              }
            : {}),
        };
        const fleet = state.fleets.find((row) => row.id === run.fleetId),
          grant = state.grants.find((row) => row.userId === bound.userId);
        if (
          !fleet ||
          !next.siteIds.every(
            (id) =>
              fleet.siteIds.includes(id) &&
              grant?.siteIds.includes(id) &&
              bound.activeSiteIds?.includes(id),
          ) ||
          new Set(next.stops.map((row) => row.id)).size !== next.stops.length ||
          next.stops.some((row, index) => row.sequence !== index)
        )
          throw new FleetError("fleet.invalid_stops", 400);
        await eligible(state, client, next);
        Object.assign(run, next);
        run.version++;
        run.events.push({
          id: randomUUID(),
          operationId: body.operationId,
          type: "draft_edited",
          actorUserId: bound.userId,
          recordedAt: new Date().toISOString(),
          details: {
            changedFields: Object.keys(body).filter(
              (key) => !["operationId", "expectedVersion"].includes(key),
            ),
          },
        });
        state.operations.push({
          id: body.operationId,
          actorUserId: bound.userId,
          fingerprint,
          runId,
          result: structuredClone(run),
        });
        return project(state, bound, run);
      });
    },
  };
}
