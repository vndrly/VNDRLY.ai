import { createHash, randomUUID } from "node:crypto";
import {
  checkFleetManifestRequirements,
  FleetCargoTransferInputSchema,
  FleetCargoTransferActionSchema,
  FleetRunSchema,
  FleetCargoTransferSchema,
  type FleetCargoTransfer,
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
export function createFleetCargoOperations(
  transaction: Transaction,
  permitted: Permitted,
  eligible: (
    state: FleetState,
    client: PoolClient,
    run: FleetRun,
  ) => Promise<void>,
) {
  const fingerprint = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const latest = async (client: PoolClient, companyId: number, id: string) => {
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-cargo-transfer' AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [companyId, id],
    );
    if (!rows.rows.length) throw new FleetError("fleet.not_found", 404);
    return FleetCargoTransferSchema.parse(rows.rows[0].tool_output);
  };
  const hydrated = new WeakMap<FleetActor, Map<string, FleetRun>>();
  const hydrate = async (
    state: FleetState,
    actor: FleetActor,
    client: PoolClient,
    record: Pick<FleetCargoTransfer, "sourceRunId" | "targetRunId">,
  ) => {
    const ids = [record.sourceRunId, record.targetRunId].filter(
      (id) => !state.runs.some((run) => run.id === id),
    );
    if (!ids.length) return;
    const rows = await client.query(
      "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=ANY($2::text[]) ORDER BY target_id,id DESC) latest",
      [actor.companyId, ids],
    );
    const map = hydrated.get(actor) ?? new Map<string, FleetRun>();
    for (const row of rows.rows) {
      const run = FleetRunSchema.parse(row.tool_output);
      if (run.companyId !== actor.companyId)
        throw new FleetError("fleet.not_found", 404);
      map.set(run.id, run);
      actor.currentRunsById?.set(run.id, run);
    }
    hydrated.set(actor, map);
  };
  const pair = (
    state: FleetState,
    record: Pick<FleetCargoTransfer, "sourceRunId" | "targetRunId">,
    actor?: FleetActor,
  ) => {
    const source =
        state.runs.find((row) => row.id === record.sourceRunId) ??
        (actor ? hydrated.get(actor)?.get(record.sourceRunId) : undefined),
      target =
        state.runs.find((row) => row.id === record.targetRunId) ??
        (actor ? hydrated.get(actor)?.get(record.targetRunId) : undefined);
    if (!source || !target) throw new FleetError("fleet.not_found", 404);
    return { source, target };
  };
  const manager = (
    state: FleetState,
    actor: FleetActor,
    source: FleetRun,
    target: FleetRun,
  ) =>
    permitted(state, actor, source, "dispatch") &&
    permitted(state, actor, target, "dispatch");
  const project = (
    state: FleetState,
    actor: FleetActor,
    record: FleetCargoTransfer,
  ) => {
    const { source, target } = pair(state, record, actor),
      manages = manager(state, actor, source, target),
      ownSource =
        record.sourceDriverUserId === actor.userId &&
        source.driverUserId === actor.userId &&
        permitted(state, actor, source, "perform_run"),
      ownTarget =
        record.targetDriverUserId === actor.userId &&
        target.driverUserId === actor.userId &&
        permitted(state, actor, target, "perform_run");
    if (!manages && !ownSource && !ownTarget)
      throw new FleetError("fleet.not_found", 404);
    const allowedActions: FleetCargoTransfer["allowedActions"] = [];
    if (record.status === "proposed") {
      if (manages) allowedActions.push("cancel");
      const ready =
        source.version === record.sourceRunVersion &&
        target.version === record.targetRunVersion &&
        source.status === "in_progress" &&
        target.status === "in_progress" &&
        source.phase === "paused" &&
        target.phase === "paused";
      if (ready) {
        if (ownSource && !record.sourceAcknowledgedBy)
          allowedActions.push("acknowledge_source");
        if (ownTarget && !record.targetAcknowledgedBy)
          allowedActions.push("acknowledge_target");
        if (
          manages &&
          record.sourceAcknowledgedBy &&
          record.targetAcknowledgedBy
        )
          allowedActions.push("complete");
      }
    }
    return { ...record, allowedActions };
  };
  const append = async (
    client: PoolClient,
    actor: FleetActor,
    record: FleetCargoTransfer,
    operationId: string,
    hash: string,
  ) => {
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_cargo','cargo-transfer-snapshot','fleet-cargo-transfer',$3,$4::jsonb,'completed')",
      [
        actor.userId,
        actor.companyId,
        record.id,
        JSON.stringify({ ...record, allowedActions: [] }),
      ],
    );
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_cargo','cargo-transfer-operation','fleet-cargo-operation',$3,$4::jsonb,'completed')",
      [
        actor.userId,
        actor.companyId,
        operationId,
        JSON.stringify({
          actorUserId: actor.userId,
          fingerprint: hash,
          result: { ...record, allowedActions: [] },
        }),
      ],
    );
  };
  const replay = async (
    client: PoolClient,
    actor: FleetActor,
    id: string,
    hash: string,
  ) => {
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-cargo-operation' AND target_id=$2 ORDER BY id LIMIT 1",
      [actor.companyId, id],
    );
    if (!rows.rows.length) return null;
    const saved = rows.rows[0].tool_output;
    if (saved.actorUserId !== actor.userId || saved.fingerprint !== hash)
      throw new FleetError("fleet.operation_conflict");
    return FleetCargoTransferSchema.parse(saved.result);
  };
  const currentDriver = async (
    state: FleetState,
    client: PoolClient,
    run: FleetRun,
  ) => {
    const grant = state.grants.find((row) => row.userId === run.driverUserId);
    if (
      !grant?.roles.includes("driver") ||
      !grant.fleetIds.includes(run.fleetId) ||
      !run.siteIds.every((id) => grant.siteIds.includes(id))
    )
      throw new FleetError("fleet.driver_grant_required", 403);
    const person = await client.query(
      "SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=vp.vendor_id AND m.org_type='vendor' WHERE vp.user_id=$1 AND vp.vendor_id=$2 AND vp.is_active=true AND vp.deleted_at IS NULL AND u.suspended_at IS NULL FOR SHARE OF vp,u,m",
      [run.driverUserId, run.companyId],
    );
    if (!person.rows.length)
      throw new FleetError("fleet.driver_unavailable", 403);
  };
  const validateContext = (
    source: FleetRun,
    target: FleetRun,
    record: Pick<
      FleetCargoTransfer,
      "siteId" | "sourceLoadId" | "targetDeliveryStopId" | "quantity"
    >,
  ) => {
    if (
      source.id === target.id ||
      source.status !== "in_progress" ||
      target.status !== "in_progress" ||
      source.phase !== "paused" ||
      target.phase !== "paused"
    )
      throw new FleetError("fleet.action_forbidden", 403);
    const sourceStop = source.stops.find(
        (row) => row.id === source.currentStopId,
      ),
      targetStop = target.stops.find((row) => row.id === target.currentStopId),
      delivery = target.stops.find(
        (row) => row.id === record.targetDeliveryStopId,
      ),
      load = source.loads.find((row) => row.id === record.sourceLoadId);
    if (
      !sourceStop ||
      !targetStop ||
      sourceStop.siteId !== record.siteId ||
      targetStop.siteId !== record.siteId ||
      targetStop.kind !== "pickup" ||
      !delivery ||
      delivery.kind !== "delivery" ||
      delivery.sequence <= targetStop.sequence ||
      !load ||
      load.deliveredAt ||
      load.transferOut ||
      load.quantity !== record.quantity
    )
      throw new FleetError("fleet.invalid_request", 400);
    return { load, targetStop };
  };
  return {
    cargoTransfers: (actor: FleetActor, runId: string) => {
      const bound = { ...actor, runId };
      return transaction(bound, async (state, client) => {
        const run = state.runs.find((row) => row.id === runId);
        if (!run || !permitted(state, bound, run, "view"))
          throw new FleetError("fleet.not_found", 404);
        const rows = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-cargo-transfer' ORDER BY target_id,id DESC) latest WHERE tool_output->>'sourceRunId'=$2 OR tool_output->>'targetRunId'=$2 ORDER BY id DESC LIMIT 51",
          [bound.companyId, runId],
        );
        if (rows.rows.length > 50)
          throw new FleetError("fleet.store_capacity_reached");
        const transfers: FleetCargoTransfer[] = [];
        for (const row of rows.rows) {
          const record = FleetCargoTransferSchema.parse(row.tool_output);
          await hydrate(state, bound, client, record);
          try {
            transfers.push(project(state, bound, record));
          } catch (error) {
            if (!(error instanceof FleetError) || error.status !== 404)
              throw error;
          }
        }
        return { runId, transfers };
      });
    },
    cargoTransfer: (actor: FleetActor, id: string) => {
      const bound = { ...actor };
      return transaction(bound, async (state, client) => {
        const record = await latest(client, bound.companyId, id);
        await hydrate(state, bound, client, record);
        return project(state, bound, record);
      });
    },
    prepareCargoTransfer: (actor: FleetActor, input: unknown) => {
      const body = FleetCargoTransferInputSchema.parse(input),
        bound = { ...actor, operationId: body.operationId };
      return transaction(bound, async (state, client) => {
        const { source, target } = pair(state, body);
        if (!manager(state, bound, source, target))
          throw new FleetError("fleet.not_found", 404);
        const hash = fingerprint(body),
          saved = await replay(client, bound, body.operationId, hash);
        if (saved)
          return { ...project(state, bound, saved), allowedActions: [] };
        if (
          source.version !== body.sourceExpectedVersion ||
          target.version !== body.targetExpectedVersion
        )
          throw new FleetError("fleet.version_conflict");
        const { load } = validateContext(source, target, body);
        if (
          !checkFleetManifestRequirements(
            target.operationalProfile,
            load.manifestValues,
          )
        )
          throw new FleetError("fleet.load_fields_required", 400);
        if (
          ![...source.siteIds, ...target.siteIds].every((id) =>
            bound.activeSiteIds?.includes(id),
          )
        )
          throw new FleetError("fleet.site_unavailable", 403);
        if (
          target.loads.some((row) => row.id === body.targetLoadId) ||
          source.driverUserId === target.driverUserId
        )
          throw new FleetError("fleet.invalid_request", 400);
        await currentDriver(state, client, source);
        await eligible(state, client, target);
        const pending = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-cargo-transfer' ORDER BY target_id,id DESC) latest WHERE tool_output->>'sourceRunId'=$2 AND tool_output->>'sourceLoadId'=$3 AND tool_output->>'status'='proposed' LIMIT 1",
          [bound.companyId, source.id, load.id],
        );
        if (pending.rows.length)
          throw new FleetError("fleet.operation_conflict");
        const time = new Date().toISOString();
        const record: FleetCargoTransfer = {
          id: randomUUID(),
          companyId: bound.companyId,
          sourceRunId: source.id,
          targetRunId: target.id,
          sourceLoadId: load.id,
          targetLoadId: body.targetLoadId,
          targetDeliveryStopId: body.targetDeliveryStopId,
          siteId: body.siteId,
          quantity: load.quantity,
          unit: load.unit,
          commodity: load.commodity,
          reason: body.reason,
          sourceDriverUserId: source.driverUserId,
          targetDriverUserId: target.driverUserId,
          sourceRunVersion: source.version,
          targetRunVersion: target.version,
          version: 1,
          status: "proposed",
          sourceAcknowledgedBy: null,
          targetAcknowledgedBy: null,
          recordedAt: time,
          completedAt: null,
          originalCapture: {
            manifestReference: load.manifestReference,
            recordedAt: load.recordedAt,
            recordedByUserId: load.recordedByUserId,
            source: load.source,
            ...(load.manifestValues
              ? { manifestValues: structuredClone(load.manifestValues) }
              : {}),
          },
          events: [
            {
              operationId: body.operationId,
              action: "propose",
              actorUserId: bound.userId,
              recordedAt: time,
              notes: body.reason,
            },
          ],
          source: "user_report",
          physicalHandoffVerified: false,
          inventoryCustodyChanged: false,
          allowedActions: [],
        };
        await append(client, bound, record, body.operationId, hash);
        return project(state, bound, record);
      });
    },
    cargoAction: (actor: FleetActor, id: string, input: unknown) => {
      const body = FleetCargoTransferActionSchema.parse(input),
        bound = { ...actor, operationId: body.operationId };
      return transaction(bound, async (state, client) => {
        const record = await latest(client, bound.companyId, id);
        await hydrate(state, bound, client, record);
        const visible = project(state, bound, record),
          { source, target } = pair(state, record, bound),
          hash = fingerprint({ id, ...body }),
          saved = await replay(client, bound, body.operationId, hash);
        if (saved)
          return { ...project(state, bound, saved), allowedActions: [] };
        if (
          record.version !== body.expectedVersion ||
          source.version !== body.sourceExpectedVersion ||
          target.version !== body.targetExpectedVersion
        )
          throw new FleetError("fleet.version_conflict");
        if (!visible.allowedActions.includes(body.action))
          throw new FleetError("fleet.action_forbidden", 403);
        if (body.action !== "cancel") {
          validateContext(source, target, record);
          if (
            ![...source.siteIds, ...target.siteIds].every((site) =>
              bound.currentSiteIds?.includes(site),
            ) &&
            manager(state, bound, source, target)
          )
            throw new FleetError("fleet.site_unavailable", 403);
        }
        if (body.action === "acknowledge_source")
          record.sourceAcknowledgedBy = bound.userId;
        if (body.action === "acknowledge_target")
          record.targetAcknowledgedBy = bound.userId;
        const time = new Date().toISOString();
        if (body.action === "complete") {
          if (
            source.driverUserId !== record.sourceAcknowledgedBy ||
            target.driverUserId !== record.targetAcknowledgedBy
          )
            throw new FleetError("fleet.action_forbidden", 403);
          await currentDriver(state, client, source);
          await eligible(state, client, target);
          if (
            ![...source.siteIds, ...target.siteIds].every((site) =>
              bound.activeSiteIds?.includes(site),
            )
          )
            throw new FleetError("fleet.site_unavailable", 403);
          if (
            source.events.length >= 200 ||
            target.events.length >= 200 ||
            target.loads.length >= 100 ||
            target.loads.some((row) => row.id === record.targetLoadId)
          )
            throw new FleetError("fleet.store_capacity_reached");
          const { load, targetStop } = validateContext(source, target, record);
          if (
            !checkFleetManifestRequirements(
              target.operationalProfile,
              load.manifestValues,
            )
          )
            throw new FleetError("fleet.load_fields_required", 400);
          load.transferOut = {
            transferId: record.id,
            otherRunId: target.id,
            otherLoadId: record.targetLoadId,
            recordedAt: time,
            source: "user_report",
            physicalHandoffVerified: false,
          };
          target.loads.push({
            ...structuredClone(load),
            id: record.targetLoadId,
            pickupStopId: targetStop.id,
            transferOut: undefined,
            transferIn: {
              transferId: record.id,
              otherRunId: source.id,
              otherLoadId: load.id,
              recordedAt: time,
              source: "user_report",
              physicalHandoffVerified: false,
            },
            plannedDeliveryStopId: record.targetDeliveryStopId,
          });
          source.version++;
          target.version++;
          record.sourceRunVersion = source.version;
          record.targetRunVersion = target.version;
          record.status = "completed";
          record.completedAt = time;
          for (const run of [source, target])
            run.events.push({
              id: randomUUID(),
              operationId: body.operationId,
              type: "cargo_transferred",
              actorUserId: bound.userId,
              recordedAt: time,
              details: {
                transferId: record.id,
                direction: run.id === source.id ? "out" : "in",
                source: "user_report",
                physicalHandoffVerified: false,
                inventoryCustodyChanged: false,
              },
            });
        }
        if (body.action === "cancel") record.status = "cancelled";
        record.version++;
        record.events.push({
          operationId: body.operationId,
          action: body.action,
          actorUserId: bound.userId,
          recordedAt: time,
          notes: body.notes,
        });
        await append(client, bound, record, body.operationId, hash);
        return project(state, bound, record);
      });
    },
  };
}
