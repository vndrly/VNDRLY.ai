import { createHash, randomUUID } from "node:crypto";
import {
  FleetReplacementInputSchema,
  FleetReplacementActionSchema,
  FleetReplacementSchema,
  type FleetReplacement,
  type FleetRun,
} from "@workspace/api-zod";
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

export async function assertFleetReplacementCustody(
  client: PoolClient,
  run: Pick<
    FleetRun,
    "vehicleAssetId" | "trailerAssetId" | "companyId" | "driverUserId"
  >,
) {
  for (const id of [run.vehicleAssetId, run.trailerAssetId].filter(
    (id): id is string => !!id,
  )) {
    const rows = await client.query(
      "SELECT id FROM assets WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$2 AND status='checked_out' AND current_holder_user_id=$3 AND retired_at IS NULL AND merged_into_id IS NULL AND provisional=false FOR UPDATE",
      [id, run.companyId, run.driverUserId],
    );
    if (!rows.rows.length)
      throw new FleetError("fleet.equipment_custody_conflict");
  }
}

export function createFleetReplacementOperations(
  transaction: Transaction,
  permitted: Permitted,
  eligible: (
    state: FleetState,
    client: PoolClient,
    run: FleetRun,
  ) => Promise<void>,
) {
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const runFor = (state: FleetState, actor: FleetActor, id: string) => {
    const run = state.runs.find((row) => row.id === id);
    if (!run || !permitted(state, actor, run, "view"))
      throw new FleetError("fleet.not_found", 404);
    return run;
  };
  const project = (
    state: FleetState,
    actor: FleetActor,
    run: FleetRun,
    record: FleetReplacement,
  ): FleetReplacement => ({
    ...record,
    allowedActions:
      record.status === "proposed"
        ? [
            ...(permitted(state, actor, run, "dispatch")
              ? ["cancel" as const]
              : []),
            ...(run.status === "in_progress" &&
            run.phase === "paused" &&
            run.version === record.runVersion &&
            run.driverUserId === record.driverUserId &&
            actor.userId === run.driverUserId &&
            permitted(state, actor, run, "perform_run")
              ? ["accept" as const]
              : []),
          ]
        : [],
  });
  const latest = async (client: PoolClient, actor: FleetActor, id: string) => {
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-replacement' AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [actor.companyId, id],
    );
    if (!rows.rows.length) throw new FleetError("fleet.not_found", 404);
    return FleetReplacementSchema.parse(rows.rows[0].tool_output);
  };
  const replay = async (
    client: PoolClient,
    actor: FleetActor,
    operationId: string,
    fingerprint: string,
  ) => {
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-replacement-operation' AND target_id=$2 ORDER BY id LIMIT 1",
      [actor.companyId, operationId],
    );
    if (!rows.rows.length) return null;
    const saved = rows.rows[0].tool_output;
    if (saved.actorUserId !== actor.userId || saved.fingerprint !== fingerprint)
      throw new FleetError("fleet.operation_conflict");
    return FleetReplacementSchema.parse(saved.result);
  };
  const append = async (
    client: PoolClient,
    actor: FleetActor,
    record: FleetReplacement,
    operationId: string,
    fingerprint: string,
  ) => {
    const result = { ...record, allowedActions: [] };
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_replacement','replacement-snapshot','fleet-replacement',$3,$4::jsonb,'completed')",
      [actor.userId, actor.companyId, record.id, JSON.stringify(result)],
    );
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_replacement','replacement-operation','fleet-replacement-operation',$3,$4::jsonb,'completed')",
      [
        actor.userId,
        actor.companyId,
        operationId,
        JSON.stringify({ actorUserId: actor.userId, fingerprint, result }),
      ],
    );
  };
  const custody = async (
    state: FleetState,
    client: PoolClient,
    run: FleetRun,
    record: Pick<FleetReplacement, "vehicleAssetId" | "trailerAssetId">,
  ) => {
    const next = {
      ...run,
      vehicleAssetId: record.vehicleAssetId,
      trailerAssetId: record.trailerAssetId,
    };
    await eligible(state, client, next);
    // Inventory must have recorded custody first; Fleet never checks equipment out.
    await assertFleetReplacementCustody(client, next);
  };
  return {
    replacements: (actor: FleetActor, runId: string) => {
      const bound = { ...actor, runId };
      return transaction(bound, async (state, client) => {
        const run = runFor(state, bound, runId);
        const rows = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-replacement' ORDER BY target_id,id DESC) latest WHERE tool_output->>'runId'=$2 ORDER BY id DESC LIMIT 51",
          [actor.companyId, runId],
        );
        if (rows.rows.length > 50)
          throw new FleetError("fleet.store_capacity_reached");
        return {
          runId,
          replacements: rows.rows.map((row) =>
            project(
              state,
              bound,
              run,
              FleetReplacementSchema.parse(row.tool_output),
            ),
          ),
        };
      });
    },
    proposeReplacement: (actor: FleetActor, runId: string, input: unknown) => {
      const body = FleetReplacementInputSchema.parse(input),
        bound = { ...actor, runId, operationId: body.operationId };
      return transaction(bound, async (state, client) => {
        const run = runFor(state, bound, runId);
        if (!permitted(state, bound, run, "dispatch"))
          throw new FleetError("fleet.action_forbidden", 403);
        const fingerprint = hash({ runId, ...body }),
          saved = await replay(client, bound, body.operationId, fingerprint);
        if (saved) return saved;
        if (run.status !== "in_progress" || run.phase !== "paused")
          throw new FleetError("fleet.action_forbidden", 403);
        if (run.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (
          run.vehicleAssetId === body.vehicleAssetId &&
          run.trailerAssetId === body.trailerAssetId
        )
          throw new FleetError("fleet.invalid_request", 400);
        const pending = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-replacement' ORDER BY target_id,id DESC) latest WHERE tool_output->>'runId'=$2 AND tool_output->>'status'='proposed' LIMIT 1",
          [bound.companyId, runId],
        );
        if (pending.rows.length)
          throw new FleetError("fleet.operation_conflict");
        await custody(state, client, run, body);
        const record: FleetReplacement = {
          id: randomUUID(),
          companyId: bound.companyId,
          runId,
          driverUserId: run.driverUserId,
          priorVehicleAssetId: run.vehicleAssetId,
          priorTrailerAssetId: run.trailerAssetId,
          vehicleAssetId: body.vehicleAssetId,
          trailerAssetId: body.trailerAssetId,
          runVersion: run.version,
          version: 1,
          status: "proposed",
          reason: body.reason,
          proposedByUserId: bound.userId,
          recordedAt: new Date().toISOString(),
          acceptedAt: null,
          acceptedByUserId: null,
          source: "user_report",
          inventoryCustodyChanged: false,
          physicalExchangeVerified: false,
          events: [
            {
              operationId: body.operationId,
              action: "propose",
              actorUserId: bound.userId,
              notes: body.reason,
              recordedAt: new Date().toISOString(),
            },
          ],
          allowedActions: [],
        };
        await append(client, bound, record, body.operationId, fingerprint);
        return project(state, bound, run, record);
      });
    },
    replacementAction: (
      actor: FleetActor,
      runId: string,
      id: string,
      input: unknown,
    ) => {
      const body = FleetReplacementActionSchema.parse(input),
        bound = { ...actor, runId, operationId: body.operationId };
      return transaction(bound, async (state, client) => {
        const run = runFor(state, bound, runId),
          record = await latest(client, bound, id);
        if (record.runId !== runId)
          throw new FleetError("fleet.not_found", 404);
        const authorized =
          body.action === "cancel"
            ? permitted(state, bound, run, "dispatch")
            : bound.userId === run.driverUserId &&
              permitted(state, bound, run, "perform_run");
        if (!authorized) throw new FleetError("fleet.action_forbidden", 403);
        const fingerprint = hash({ runId, id, ...body }),
          saved = await replay(client, bound, body.operationId, fingerprint);
        if (saved) return saved;
        if (record.status !== "proposed")
          throw new FleetError("fleet.action_forbidden", 403);
        if (
          record.version !== body.expectedVersion ||
          run.version !== body.runExpectedVersion
        )
          throw new FleetError("fleet.version_conflict");
        if (body.action === "accept") {
          if (
            run.status !== "in_progress" ||
            run.phase !== "paused" ||
            run.version !== record.runVersion ||
            run.driverUserId !== record.driverUserId ||
            run.vehicleAssetId !== record.priorVehicleAssetId ||
            run.trailerAssetId !== record.priorTrailerAssetId
          )
            throw new FleetError("fleet.version_conflict");
          if (run.events.length >= 200)
            throw new FleetError("fleet.store_capacity_reached");
          await custody(state, client, run, record);
          record.status = "accepted";
          record.acceptedAt = new Date().toISOString();
          record.acceptedByUserId = bound.userId;
          run.vehicleAssetId = record.vehicleAssetId;
          run.trailerAssetId = record.trailerAssetId;
          run.activeReplacement = {
            replacementId: record.id,
            acceptedAt: record.acceptedAt,
            priorVehicleAssetId: record.priorVehicleAssetId,
            priorTrailerAssetId: record.priorTrailerAssetId,
            inspectionCount: run.inspections.length,
            recordCount: run.records.length,
          };
          run.version++;
          run.events.push({
            id: randomUUID(),
            operationId: body.operationId,
            type: "equipment_replacement_accepted",
            actorUserId: bound.userId,
            recordedAt: record.acceptedAt,
            details: {
              replacementId: record.id,
              priorVehicleAssetId: record.priorVehicleAssetId,
              priorTrailerAssetId: record.priorTrailerAssetId,
              vehicleAssetId: record.vehicleAssetId,
              trailerAssetId: record.trailerAssetId,
              notes: body.notes,
              inventoryCustodyChanged: false,
            },
          });
        } else record.status = "cancelled";
        record.version++;
        record.runVersion = run.version;
        record.events.push({
          operationId: body.operationId,
          action: body.action,
          actorUserId: bound.userId,
          notes: body.notes,
          recordedAt: new Date().toISOString(),
        });
        await append(client, bound, record, body.operationId, fingerprint);
        return project(state, bound, run, record);
      });
    },
  };
}
