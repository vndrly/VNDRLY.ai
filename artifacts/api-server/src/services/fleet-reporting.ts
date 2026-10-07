import { createHash, randomUUID } from "node:crypto";
import {
  FleetReportFilterSchema,
  FleetRunSchema,
  FleetSavedViewInputSchema,
  type FleetReport,
  type FleetReportFilter,
  type FleetRun,
  type FleetSavedView,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
type Access = (
  state: FleetState,
  actor: FleetActor,
) => {
  fleetIds: readonly string[];
  siteIds: readonly number[];
  roles: readonly string[];
  financeRead?: boolean;
} | null;
type Transaction = <T>(
  actor: FleetActor,
  operation: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
export function summarizeFleetRecords(
  runs: FleetRun[],
  filters: FleetReportFilter,
  financeRead: boolean,
): FleetReport {
  const loads = new Map<string, FleetReport["loadTotals"][number]>(),
    fuel = new Map<string, number>(),
    distance = new Map<string, number>();
  for (const run of runs) {
    for (const load of run.loads) {
      const key = JSON.stringify([load.commodity, load.unit]);
      const total = loads.get(key) ?? {
        commodity: load.commodity,
        unit: load.unit,
        quantity: 0,
        deliveredQuantity: 0,
      };
      total.quantity += load.quantity;
      if (load.deliveredAt) total.deliveredQuantity += load.quantity;
      loads.set(key, total);
    }
    for (const record of run.records.filter((r) => r.kind === "fuel"))
      fuel.set(
        record.unit,
        (fuel.get(record.unit) ?? 0) + (record.quantity ?? 0),
      );
    const meters = new Map<string, typeof run.records>();
    for (const record of run.records.filter(
      (r) =>
        r.kind === "meter" &&
        r.vehicleAssetId &&
        ["miles", "kilometers"].includes(r.unit),
    )) {
      const key = JSON.stringify([record.vehicleAssetId, record.unit]);
      meters.set(key, [...(meters.get(key) ?? []), record]);
    }
    for (const records of meters.values()) {
      if (records.length < 2) continue;
      const delta = records.at(-1)!.reading! - records[0].reading!;
      if (delta < 0) throw new FleetError("fleet.report_meter_conflict", 409);
      distance.set(
        records[0].unit,
        (distance.get(records[0].unit) ?? 0) + delta,
      );
    }
  }
  if (
    [...loads.values()].some(
      (r) =>
        !Number.isFinite(r.quantity) || !Number.isFinite(r.deliveredQuantity),
    ) ||
    [...fuel.values(), ...distance.values()].some((v) => !Number.isFinite(v))
  )
    throw new FleetError("fleet.report_numeric_capacity_reached", 409);
  return {
    generatedAt: new Date().toISOString(),
    filters,
    source: "recorded_fleet_events",
    dateBasis: "run_created_at",
    runCount: runs.length,
    completedRunCount: runs.filter((r) => r.status === "completed").length,
    submittedRunCount: runs.filter((r) => r.status === "submitted_for_review")
      .length,
    inspectionExceptions: runs.reduce(
      (n, r) =>
        n + r.inspections.filter((i) => i.outcome === "defect_reported").length,
      0,
    ),
    loadTotals: [...loads.values()],
    distanceTotals: [...distance].map(([unit, distance]) => ({
      unit,
      distance,
    })),
    fuelTotals: financeRead
      ? [...fuel].map(([unit, quantity]) => ({ unit, quantity }))
      : null,
    unavailableMetrics: [
      {
        metric: "date_filter_basis",
        reason:
          "Dates select runs by server-recorded creation time. Totals include every recorded load, fuel and meter entry on those selected runs, including later entries.",
      },
      {
        metric: "physical_telemetry",
        reason: "No verified device telemetry is collected by these records.",
      },
      {
        metric: "dwell_detention_on_time",
        reason:
          "Accepted record times and user reports are not verified physical arrival or contractual target times.",
      },
      {
        metric: "cost_per_run",
        reason:
          "No verified price or accounting cost source is attached to these entries.",
      },
    ],
  };
}
export function createFleetReportingOperations(
  transaction: Transaction,
  access: Access,
) {
  const validate = (
    state: FleetState,
    actor: FleetActor,
    filters: FleetReportFilter,
  ) => {
    const grant = access(state, actor);
    if (!grant) throw new FleetError("fleet.forbidden", 403);
    if (
      (filters.fleetId && !grant.fleetIds.includes(filters.fleetId)) ||
      (filters.siteId && !grant.siteIds.includes(filters.siteId))
    )
      throw new FleetError("fleet.report_not_found", 404);
    return grant;
  };
  return {
    report: (actor: FleetActor, input: unknown): Promise<FleetReport> => {
      const filters = FleetReportFilterSchema.parse(input);
      return transaction(actor, async (state, client) => {
        const grant = validate(state, actor, filters);
        const found = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=$1 ORDER BY target_id,id DESC) latest WHERE tool_output->>'fleetId'=ANY($2::text[]) AND ($3::boolean OR (tool_output->>'driverUserId')::int=$4) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(tool_output->'siteIds') s(value) WHERE NOT (s.value::int=ANY($5::int[]))) AND ($6::text IS NULL OR (tool_output->'events'->0->>'recordedAt')::timestamptz >= $6::timestamptz) AND ($7::text IS NULL OR (tool_output->'events'->0->>'recordedAt')::timestamptz < $7::timestamptz) AND ($8::int IS NULL OR tool_output->'siteIds' @> jsonb_build_array($8::int)) LIMIT 10001",
          [
            actor.companyId,
            filters.fleetId ? [filters.fleetId] : [...grant.fleetIds],
            grant.roles.some(
              (r) => r === "fleet_manager" || r === "dispatcher",
            ),
            actor.userId,
            [...grant.siteIds],
            filters.startsAt ?? null,
            filters.endsAt ?? null,
            filters.siteId ?? null,
          ],
        );
        if (found.rows.length > 10000)
          throw new FleetError("fleet.report_record_capacity_reached", 409);
        const all = new Map(
          found.rows.map((row) => {
            const run = FleetRunSchema.parse(row.tool_output);
            return [run.id, run] as const;
          }),
        );
        for (const run of state.runs) {
          if (
            grant.fleetIds.includes(run.fleetId) &&
            (grant.roles.some(
              (r) => r === "fleet_manager" || r === "dispatcher",
            ) ||
              run.driverUserId === actor.userId) &&
            run.siteIds.every((id) => grant.siteIds.includes(id))
          )
            all.set(run.id, run);
        }
        const runs = [...all.values()].filter(
          (r) =>
            r.companyId === actor.companyId &&
            grant.fleetIds.includes(r.fleetId) &&
            r.siteIds.every((id) => grant.siteIds.includes(id)) &&
            (grant.roles.some(
              (role) => role === "fleet_manager" || role === "dispatcher",
            ) ||
              r.driverUserId === actor.userId) &&
            (!filters.fleetId || r.fleetId === filters.fleetId) &&
            (!filters.siteId || r.siteIds.includes(filters.siteId)) &&
            (!filters.startsAt ||
              Date.parse(r.events[0]?.recordedAt ?? "") >=
                Date.parse(filters.startsAt)) &&
            (!filters.endsAt ||
              Date.parse(r.events[0]?.recordedAt ?? "") <
                Date.parse(filters.endsAt)),
        );
        return summarizeFleetRecords(runs, filters, grant.financeRead === true);
      });
    },
    savedViews: (actor: FleetActor) =>
      transaction(actor, async (state, client) => {
        validate(state, actor, {});
        const found = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE target_type='fleet-view' AND vendor_id=$1 AND user_id=$2 ORDER BY target_id,id DESC) latest WHERE tool_output->>'archived'='false' ORDER BY id DESC LIMIT 51",
          [actor.companyId, actor.userId],
        );
        if (found.rows.length > 50)
          throw new FleetError("fleet.saved_view_capacity_reached", 409);
        return {
          views: found.rows
            .map((r) => r.tool_output as FleetSavedView)
            .filter((view) => {
              if (
                view.userId !== actor.userId ||
                view.companyId !== actor.companyId
              )
                return false;
              try {
                validate(state, actor, view.filters);
                return true;
              } catch {
                return false;
              }
            }),
        };
      }),
    saveView: (actor: FleetActor, input: unknown) => {
      const command = FleetSavedViewInputSchema.parse(input),
        fingerprint = createHash("sha256")
          .update(JSON.stringify(command))
          .digest("hex");
      return transaction(actor, async (state, client) => {
        validate(state, actor, command.filters ?? {});
        const old = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-view-operation' AND vendor_id=$1 AND user_id=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
          [actor.companyId, actor.userId, command.operationId],
        );
        if (old.rows.length) {
          const saved = old.rows[0].tool_output;
          if (saved.fingerprint !== fingerprint)
            throw new FleetError("fleet.operation_reused", 409);
          validate(state, actor, saved.result.filters);
          return saved.result as FleetSavedView;
        }
        let prior: FleetSavedView | undefined;
        if (command.viewId) {
          const found = await client.query(
            "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-view' AND vendor_id=$1 AND user_id=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
            [actor.companyId, actor.userId, command.viewId],
          );
          prior = found.rows[0]?.tool_output;
          if (!prior) throw new FleetError("fleet.view_not_found", 404);
          if (prior.version !== command.expectedVersion)
            throw new FleetError("fleet.version_conflict", 409);
        } else if (command.action === "archive")
          throw new FleetError("fleet.view_not_found", 404);
        if (command.action === "save" && (!command.name || !command.filters))
          throw new FleetError("fleet.view_fields_required", 400);
        if (!prior) {
          const count = await client.query(
            "SELECT count(*)::int AS count FROM (SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE target_type='fleet-view' AND vendor_id=$1 AND user_id=$2 ORDER BY target_id,id DESC) latest WHERE tool_output->>'archived'='false'",
            [actor.companyId, actor.userId],
          );
          if (count.rows[0].count >= 50)
            throw new FleetError("fleet.saved_view_capacity_reached", 409);
        }
        const result: FleetSavedView = {
          id: prior?.id ?? randomUUID(),
          userId: actor.userId,
          companyId: actor.companyId,
          version: (prior?.version ?? 0) + 1,
          name: command.name ?? prior!.name,
          filters: command.filters ?? prior!.filters,
          archived: command.action === "archive",
          recordedAt: new Date().toISOString(),
          lastOperationId: command.operationId,
        };
        validate(state, actor, result.filters);
        for (const [type, id, value] of [
          ["fleet-view", result.id, result],
          [
            "fleet-view-operation",
            command.operationId,
            { fingerprint, result },
          ],
        ] as const)
          await client.query(
            "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_view','saved-view',$3,$4,$5::jsonb,'completed')",
            [actor.userId, actor.companyId, type, id, JSON.stringify(value)],
          );
        return result;
      });
    },
  };
}
