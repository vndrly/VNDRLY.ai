import { createHash, randomUUID } from "node:crypto";
import {
  FleetMaintenanceCreateSchema,
  FleetMaintenanceActionSchema,
  FleetMaintenanceRecordSchema,
  type FleetMaintenanceRecord,
  type FleetMaintenancePage,
  type FleetRun,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import type { FleetState } from "./fleet-repository";
import { FleetError } from "./fleet-repository";

type Transaction = <T>(
  actor: FleetActor,
  operation: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
type Access = (
  state: FleetState,
  actor: FleetActor,
) => {
  fleetIds: readonly string[];
  siteIds: readonly number[];
  roles: readonly string[];
  safetyRelease: boolean;
} | null;
const terminal = (r: FleetMaintenanceRecord) =>
  ["released", "cancelled"].includes(r.status);
/** A combined inspection does not identify which coupled item failed. Hold
 * each inspected item for review rather than silently clearing its exception.
 * Release remains an individually authorized maintenance action. */
export async function recordFleetInspectionException(
  client: PoolClient,
  actor: FleetActor,
  run: FleetRun,
  operationId: string,
  notes: string,
) {
  const ids: string[] = [];
  for (const assetId of [
    run.vehicleAssetId,
    ...(run.trailerAssetId ? [run.trailerAssetId] : []),
  ]) {
    const asset = await client.query(
      "SELECT id FROM assets WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$2 AND retired_at IS NULL AND merged_into_id IS NULL FOR UPDATE",
      [assetId, actor.companyId],
    );
    if (!asset.rows.length)
      throw new FleetError("fleet.equipment_not_found", 404);
    const id = randomUUID(),
      holdId = randomUUID(),
      record: FleetMaintenanceRecord = {
        id,
        companyId: actor.companyId,
        fleetId: run.fleetId,
        assetId,
        runId: run.id,
        kind: "defect",
        title: "Combined run inspection exception",
        status: "reported",
        version: 1,
        dueAt: null,
        holdId,
        events: [
          {
            operationId,
            action: "inspection_exception",
            actorUserId: actor.userId,
            recordedAt: new Date().toISOString(),
            notes,
            source: "user_report",
          },
        ],
        allowedActions: [],
      };
    await client.query(
      "INSERT INTO asset_holds(id,asset_id,reason,placed_by_user_id) VALUES($1,$2,$3,$4)",
      [
        holdId,
        assetId,
        `Combined Fleet inspection exception: ${notes}`,
        actor.userId,
      ],
    );
    await client.query(
      "UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1",
      [assetId],
    );
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_maintenance','maintenance-snapshot','fleet-maintenance',$3,$4::jsonb,'completed')",
      [actor.userId, actor.companyId, id, JSON.stringify(record)],
    );
    ids.push(id);
  }
  return ids;
}
export function createFleetMaintenanceOperations(
  transaction: Transaction,
  access: Access,
) {
  const authorized = async (
    state: FleetState,
    actor: FleetActor,
    client: PoolClient,
    record: FleetMaintenanceRecord,
  ) => {
    const grant = access(state, actor),
      fleet = state.fleets.find((f) => f.id === record.fleetId);
    if (
      !grant?.fleetIds.includes(record.fleetId) ||
      !fleet?.equipmentAssetIds.includes(record.assetId)
    )
      throw new FleetError("fleet.maintenance_not_found", 404);
    const asset = await client.query(
      "SELECT id FROM assets WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$2 AND retired_at IS NULL AND merged_into_id IS NULL FOR UPDATE",
      [record.assetId, actor.companyId],
    );
    if (!asset.rows.length)
      throw new FleetError("fleet.maintenance_not_found", 404);
    const manager = grant.roles.includes("fleet_manager");
    if (!manager && (!grant.roles.includes("driver") || !record.runId))
      throw new FleetError("fleet.maintenance_not_found", 404);
    if (record.runId) {
      let run = state.runs.find((r) => r.id === record.runId);
      if (!run) {
        const found = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=$1 AND target_id=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, record.runId],
        );
        run = found.rows[0]?.tool_output;
      }
      if (
        !run ||
        (!manager && run.driverUserId !== actor.userId) ||
        run.fleetId !== record.fleetId ||
        ![run.vehicleAssetId, run.trailerAssetId].includes(record.assetId) ||
        !run.siteIds.every((id: number) => grant.siteIds.includes(id))
      )
        throw new FleetError("fleet.maintenance_not_found", 404);
    }
    return { grant, manager };
  };
  const project = (
    record: FleetMaintenanceRecord,
    auth: { grant: NonNullable<ReturnType<Access>>; manager: boolean },
  ): FleetMaintenanceRecord => ({
    ...record,
    allowedActions:
      terminal(record) || !auth.manager
        ? []
        : [
            ...(record.status === "reported" ? ["triage" as const] : []),
            ...(["reported", "in_service"].includes(record.status)
              ? ["record_repair" as const]
              : []),
            ...(record.status === "repair_recorded" && auth.grant.safetyRelease
              ? ["release" as const]
              : []),
            ...(record.holdId === null ? ["cancel" as const] : []),
          ],
  });
  const append = async (
    client: PoolClient,
    actor: FleetActor,
    record: FleetMaintenanceRecord,
  ) => {
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_maintenance','maintenance-snapshot','fleet-maintenance',$3,$4::jsonb,'completed')",
      [
        actor.userId,
        actor.companyId,
        record.id,
        JSON.stringify({ ...record, allowedActions: [] }),
      ],
    );
  };
  const replay = async (
    client: PoolClient,
    actor: FleetActor,
    operationId: string,
    fingerprint: string,
  ) => {
    const found = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-maintenance-operation' AND vendor_id=$1 AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [actor.companyId, operationId],
    );
    if (!found.rows.length) return null;
    const saved = found.rows[0].tool_output;
    if (saved.actorUserId !== actor.userId || saved.fingerprint !== fingerprint)
      throw new FleetError("fleet.operation_reused", 409);
    return FleetMaintenanceRecordSchema.parse(saved.result);
  };
  const save = async (
    client: PoolClient,
    actor: FleetActor,
    operationId: string,
    fingerprint: string,
    result: FleetMaintenanceRecord,
  ) => {
    await append(client, actor, result);
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_maintenance','maintenance-operation','fleet-maintenance-operation',$3,$4::jsonb,'completed')",
      [
        actor.userId,
        actor.companyId,
        operationId,
        JSON.stringify({
          actorUserId: actor.userId,
          fingerprint,
          result: { ...result, allowedActions: [] },
        }),
      ],
    );
  };
  const latest = async (client: PoolClient, actor: FleetActor, id: string) => {
    const found = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-maintenance' AND vendor_id=$1 AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [actor.companyId, id],
    );
    if (!found.rows.length)
      throw new FleetError("fleet.maintenance_not_found", 404);
    return FleetMaintenanceRecordSchema.parse(found.rows[0].tool_output);
  };
  return {
    maintenanceDetail: (actor: FleetActor, id: string) =>
      transaction(actor, async (state, client) => {
        const record = await latest(client, actor, id);
        return project(record, await authorized(state, actor, client, record));
      }),
    maintenanceList: (
      actor: FleetActor,
      limit = 50,
      cursor?: string,
    ): Promise<FleetMaintenancePage> =>
      transaction(actor, async (state, client) => {
        if (!access(state, actor)) throw new FleetError("fleet.forbidden", 403);
        if (cursor && !/^\d{1,10}$/.test(cursor))
          throw new FleetError("fleet.invalid_cursor", 400);
        const found = await client.query(
          "SELECT id,tool_output FROM (SELECT DISTINCT ON(target_id) id,tool_output FROM assistant_action_audit WHERE target_type='fleet-maintenance' AND vendor_id=$1 ORDER BY target_id,id DESC) latest WHERE id<$2 ORDER BY id DESC LIMIT $3",
          [
            actor.companyId,
            cursor ? Number(cursor) : 2147483647,
            Math.min(50, Math.max(1, limit)) + 1,
          ],
        );
        const rows = found.rows.slice(0, limit),
          records: FleetMaintenanceRecord[] = [];
        for (const row of rows) {
          const record = FleetMaintenanceRecordSchema.parse(row.tool_output);
          try {
            records.push(
              project(record, await authorized(state, actor, client, record)),
            );
          } catch (error) {
            if (!(error instanceof FleetError) || error.status !== 404)
              throw error;
          }
        }
        return {
          records,
          nextCursor:
            found.rows.length > limit ? String(rows.at(-1)!.id) : null,
          generatedAt: new Date().toISOString(),
        };
      }),
    maintenanceCreate: (actor: FleetActor, input: unknown) => {
      const command = FleetMaintenanceCreateSchema.parse(input);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex");
      return transaction(actor, async (state, client) => {
        const record: FleetMaintenanceRecord = {
          id: randomUUID(),
          companyId: actor.companyId,
          fleetId: command.fleetId,
          assetId: command.assetId,
          runId: command.runId ?? null,
          kind: command.kind,
          title: command.title,
          status: "reported",
          version: 1,
          dueAt: command.dueAt ?? null,
          holdId: command.kind === "defect" ? randomUUID() : null,
          events: [],
          allowedActions: [],
        };
        const auth = await authorized(state, actor, client, record);
        if (!auth.manager && command.kind !== "defect")
          throw new FleetError("fleet.forbidden", 403);
        const old = await replay(
          client,
          actor,
          command.operationId,
          fingerprint,
        );
        if (old) {
          await authorized(
            state,
            actor,
            client,
            await latest(client, actor, old.id),
          );
          return { ...old, allowedActions: [] };
        }
        if (record.holdId) {
          await client.query(
            "INSERT INTO asset_holds(id,asset_id,reason,placed_by_user_id) VALUES($1,$2,$3,$4)",
            [record.holdId, record.assetId, command.notes, actor.userId],
          );
          await client.query(
            "UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1",
            [record.assetId],
          );
        }
        record.events.push({
          operationId: command.operationId,
          action: "created",
          actorUserId: actor.userId,
          recordedAt: new Date().toISOString(),
          notes: command.notes,
          source: "user_report",
        });
        await save(client, actor, command.operationId, fingerprint, record);
        return project(record, auth);
      });
    },
    maintenanceAction: (actor: FleetActor, id: string, input: unknown) => {
      const command = FleetMaintenanceActionSchema.parse(input);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ id, ...command }))
        .digest("hex");
      return transaction(actor, async (state, client) => {
        const record = await latest(client, actor, id),
          auth = await authorized(state, actor, client, record);
        const old = await replay(
          client,
          actor,
          command.operationId,
          fingerprint,
        );
        if (old) return { ...old, allowedActions: [] };
        if (record.version !== command.expectedVersion)
          throw new FleetError("fleet.version_conflict", 409);
        if (!project(record, auth).allowedActions.includes(command.action))
          throw new FleetError("fleet.action_forbidden", 403);
        if (record.events.length >= 200)
          throw new FleetError("fleet.maintenance_event_capacity_reached", 409);
        if (command.action === "release" && record.holdId) {
          const released = await client.query(
            "UPDATE asset_holds SET released_at=now(),released_by_user_id=$1 WHERE id=$2 AND asset_id=$3 AND released_at IS NULL RETURNING id",
            [actor.userId, record.holdId, record.assetId],
          );
          if (!released.rows.length)
            throw new FleetError("fleet.hold_changed", 409);
          await client.query(
            "UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1",
            [record.assetId],
          );
        }
        record.status = (
          {
            triage: "in_service",
            record_repair: "repair_recorded",
            release: "released",
            cancel: "cancelled",
          } as const
        )[command.action];
        record.version++;
        record.events.push({
          operationId: command.operationId,
          action: command.action,
          actorUserId: actor.userId,
          recordedAt: new Date().toISOString(),
          notes: command.notes,
          source: "user_report",
        });
        await save(client, actor, command.operationId, fingerprint, record);
        return project(record, auth);
      });
    },
  };
}
