import {
  validateCommercialStops,
  assertFleetPhysicalRoute,
} from "./fleet-commercial";
import { FleetDraftEditSchema, fleetRouteMatchesSchedule, fleetRouteMatchesRunOrder, type FleetRun } from "@workspace/api-zod";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import { rescheduleFleetRunDetail } from "./fleet-run-details";
import { isFleetBillingV2TicketOpen } from "./fleet-billing-v2";
import { requireFleetRunCommercialAuthority } from "./fleet-commercial-authority";
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
  options: { originalWorkOperationId?: string; originalWorkCapture?: { capturedAt: string; timeZone: string } } = {},
) {
  return {
    editDraft: (actor: FleetActor, runId: string, input: unknown) => {
      const body = FleetDraftEditSchema.parse(input),
        bound = {
          ...actor,
          runId,
          operationId: body.operationId,
          schedulingRunId: runId,
          schedulingDriverUserIds: [],
        };
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
        if (run.billingV2) {
          if (options.originalWorkOperationId !== body.operationId)
            throw new FleetError("fleet.work_command_required", 409);
          const ticket = (await client.query("SELECT id,status FROM tickets WHERE id=$1 AND vendor_id=$2 FOR UPDATE",[run.linkedTicketId,bound.companyId])).rows[0];
          if (!ticket || !isFleetBillingV2TicketOpen(ticket.status)) throw new FleetError("fleet.ticket_closed",409);
          await requireFleetRunCommercialAuthority(client, run);
        }
        if (run.events.length >= 200 || state.operations.length >= 2000)
          throw new FleetError("fleet.store_capacity_reached");
        const next = {
          ...run,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
          ...(body.routePlan ? { routePlan: body.routePlan } : {}),
          ...(body.stops
            ? {
                stops: body.stops,
                siteIds: [...new Set(body.stops.map((row) => row.siteId))],
              }
            : {}),
        };
        if(body.routePlan&&!fleetRouteMatchesSchedule(body.routePlan,next.schedule))throw new FleetError("fleet.route_schedule_mismatch",400);
        if(next.routePlan&&body.schedule!==undefined&&!body.routePlan)next.routePlan={...next.routePlan,plannedWindow:next.schedule?{startAt:next.schedule.plannedStartAt,endAt:next.schedule.plannedEndAt,timeZone:next.schedule.timezone}:null};
        if(next.routePlan&&next.resourceAssignment)next.resourceAssignment={...next.resourceAssignment,returnPolicy:next.routePlan.returnPolicy};
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
        if(next.runOrder&&(!next.routePlan||!fleetRouteMatchesRunOrder(next.routePlan,next.runOrder)))throw new FleetError("fleet.run_order_route_mismatch",409);
        validateCommercialStops(next);
        if (body.routePlan)
          await assertFleetPhysicalRoute(client, bound, state, next, true);
        if (
          (run.billing || run.billingV2) &&
          (next.stops[0]?.kind !== "pickup" ||
            next.stops[0].siteId !== run.stops[0].siteId)
        )
          throw new FleetError("fleet.billing_ticket_mismatch", 409);
        await eligible(state, client, next);
        if (next.resourceAssignment && body.schedule !== undefined)
          await rescheduleFleetRunDetail({ state, client }, bound, next);
        Object.assign(run, next);
        run.version++;
        run.events.push({
          id: randomUUID(),
          operationId: body.operationId,
          type: "draft_edited",
          actorUserId: bound.userId,
          recordedAt: new Date().toISOString(),
          ...(run.billingV2 && options.originalWorkCapture ? {
            capturedAt: new Date(options.originalWorkCapture.capturedAt).toISOString(), source: "user_report" as const,
          } : {}),
          details: {
            ...(run.billingV2 && options.originalWorkCapture ? { originalCapture: {
              ...options.originalWorkCapture,
              clockStatus: Date.parse(options.originalWorkCapture.capturedAt) > Date.now() + 300000 ? "ahead_of_server" : "reported_capture_time",
            } } : {}),
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
