import { createHash, randomUUID } from "node:crypto";
import {
  FleetEvidenceInputSchema,
  FleetEvidenceSchema,
  type FleetEvidence,
  type FleetRun,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import {
  getObjectStore,
  type ObjectStore,
  type StoredObject,
} from "../lib/objectStore";
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
type Saved = { record: FleetEvidence; fingerprint: string; objectPath: string };
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function safeObject(object: StoredObject) {
  const type = object.contentType.toLowerCase().split(";")[0].trim(),
    body = object.body;
  if (
    !body.length ||
    body.length > 10 * 1024 * 1024 ||
    object.size !== body.length
  )
    throw new FleetError("fleet.invalid_request", 400);
  const signature =
    type === "image/jpeg"
      ? body.length >= 3 &&
        body[0] === 255 &&
        body[1] === 216 &&
        body[2] === 255
      : type === "image/png"
        ? body
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : type === "image/webp"
          ? body.subarray(0, 4).toString() === "RIFF" &&
            body.subarray(8, 12).toString() === "WEBP"
          : type === "application/pdf"
            ? body.subarray(0, 5).toString() === "%PDF-"
            : false;
  if (!signature) throw new FleetError("fleet.invalid_request", 400);
  return type as FleetEvidence["contentType"];
}
export function createFleetEvidenceOperations(
  transaction: Transaction,
  permitted: Permitted,
  store: () => ObjectStore = getObjectStore,
) {
  const load = (state: FleetState, actor: FleetActor, runId: string) => {
    const run = state.runs.find((row) => row.id === runId);
    if (!run || !permitted(state, actor, run, "view"))
      throw new FleetError("fleet.not_found", 404);
    return run;
  };
  const saved = async (
    client: PoolClient,
    companyId: number,
    evidenceId: string,
  ) => {
    const found = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND target_id=$2 ORDER BY id LIMIT 1",
      [companyId, evidenceId],
    );
    return found.rows[0]?.tool_output as Saved | undefined;
  };
  return {
    evidence: (actor: FleetActor, runId: string) => {
      const bound = { ...actor, runId };
      return transaction(bound, async (state, client) => {
        load(state, bound, runId);
        const rows = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND tool_output->'record'->>'runId'=$2 ORDER BY id LIMIT 101",
          [actor.companyId, runId],
        );
        if (rows.rows.length > 100)
          throw new FleetError("fleet.store_capacity_reached");
        return {
          runId,
          evidence: rows.rows.map((row) =>
            FleetEvidenceSchema.parse((row.tool_output as Saved).record),
          ),
        };
      });
    },
    addEvidence: (actor: FleetActor, runId: string, input: unknown) => {
      const body = FleetEvidenceInputSchema.parse(input),
        bound = { ...actor, runId, operationId: body.operationId };
      return transaction(bound, async (state, client) => {
        const run = load(state, bound, runId);
        if (!permitted(state, bound, run, "perform_run"))
          throw new FleetError("fleet.action_forbidden", 403);
        const fingerprint = digest(
          Buffer.from(JSON.stringify({ runId, ...body })),
        );
        const replayRows = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND tool_output->'record'->>'operationId'=$2 ORDER BY id LIMIT 1",
          [bound.companyId, body.operationId],
        );
        const replay = replayRows.rows[0]?.tool_output as Saved | undefined;
        if (replay) {
          if (
            replay.record.recordedByUserId !== bound.userId ||
            replay.record.runId !== runId ||
            replay.fingerprint !== fingerprint
          )
            throw new FleetError("fleet.operation_conflict");
          return FleetEvidenceSchema.parse(replay.record);
        }
        if (!["acknowledged", "in_progress"].includes(run.status))
          throw new FleetError("fleet.action_forbidden", 403);
        if (run.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (run.events.length >= 200)
          throw new FleetError("fleet.store_capacity_reached");
        if (!run.siteIds.every((id) => bound.activeSiteIds?.includes(id)))
          throw new FleetError("fleet.site_unavailable", 403);
        if (
          (body.stopId && !run.stops.some((row) => row.id === body.stopId)) ||
          (body.loadId && !run.loads.some((row) => row.id === body.loadId))
        )
          throw new FleetError("fleet.invalid_request", 400);
        if (body.loadId && body.stopId) {
          const load = run.loads.find((row) => row.id === body.loadId)!;
          const currentDelivery =
            run.currentStopId === body.stopId &&
            run.stops.find((row) => row.id === body.stopId)?.kind ===
              "delivery";
          if (
            body.stopId !== load.pickupStopId &&
            body.stopId !== load.deliveryStopId &&
            !currentDelivery
          )
            throw new FleetError("fleet.invalid_request", 400);
        }
        if (body.capturedAt) {
          const age = Date.now() - Date.parse(body.capturedAt);
          if (age < -300000 || age > 30 * 86400000)
            throw new FleetError("fleet.capture_time_invalid", 400);
        }
        if (await saved(client, bound.companyId, body.evidenceId))
          throw new FleetError("fleet.operation_conflict");
        const count = await client.query(
          "SELECT count(*)::int AS count FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND tool_output->'record'->>'runId'=$2",
          [bound.companyId, runId],
        );
        if (Number(count.rows[0]?.count) >= 100)
          throw new FleetError("fleet.store_capacity_reached");
        const source = await store().getObject(body.objectPath);
        if (
          !source ||
          source.acl?.owner !== String(bound.userId) ||
          source.acl.visibility !== "private" ||
          source.acl.purpose
        )
          throw new FleetError("fleet.action_forbidden", 403);
        const contentType = safeObject(source),
          hash = digest(source.body),
          path = `/objects/fleet/${bound.companyId}/${runId}/${body.evidenceId}`;
        const existing = await store().getObject(path);
        if (existing) {
          if (
            existing.acl?.purpose !== "fleet-evidence" ||
            existing.acl.owner !== String(bound.userId) ||
            existing.acl.visibility !== "private" ||
            existing.contentType !== contentType ||
            digest(existing.body) !== hash
          )
            throw new FleetError("fleet.operation_conflict");
        } else
          await store().putObject(path, contentType, source.body, {
            owner: String(bound.userId),
            visibility: "private",
            purpose: "fleet-evidence",
          });
        const copied = await store().getObject(path);
        if (
          !copied ||
          copied.acl?.purpose !== "fleet-evidence" ||
          copied.acl.owner !== String(bound.userId) ||
          copied.acl.visibility !== "private" ||
          copied.contentType !== contentType ||
          copied.size !== source.size ||
          digest(copied.body) !== hash
        )
          throw new FleetError("fleet.internal_error", 500);
        const record = FleetEvidenceSchema.parse({
          evidenceId: body.evidenceId,
          runId,
          companyId: bound.companyId,
          operationId: body.operationId,
          runVersion: run.version + 1,
          kind: body.kind,
          stopId: body.stopId ?? null,
          loadId: body.loadId ?? null,
          notes: body.notes,
          size: source.size,
          contentType,
          sha256: hash,
          recordedByUserId: bound.userId,
          recordedAt: new Date().toISOString(),
          capturedAt: body.capturedAt ?? null,
          source: "device_upload",
          physicalProofVerified: false,
          signatureIdentityVerified: false,
          fileUrl: `/api/fleet/runs/${runId}/evidence/${body.evidenceId}/file`,
        });
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_evidence','evidence-associated','fleet-evidence',$3,$4::jsonb,'completed')",
          [
            bound.userId,
            bound.companyId,
            body.evidenceId,
            JSON.stringify({ record, fingerprint, objectPath: path }),
          ],
        );
        run.version++;
        run.events.push({
          id: randomUUID(),
          operationId: body.operationId,
          type: "evidence_associated",
          actorUserId: bound.userId,
          recordedAt: record.recordedAt,
          details: {
            evidenceId: body.evidenceId,
            kind: body.kind,
            source: record.source,
            sha256: hash,
            physicalProofVerified: false,
          },
        });
        return record;
      });
    },
    evidenceFile: (actor: FleetActor, runId: string, evidenceId: string) => {
      const bound = { ...actor, runId };
      return transaction(bound, async (state, client) => {
        load(state, bound, runId);
        const row = await saved(client, bound.companyId, evidenceId);
        if (
          !row ||
          row.record.runId !== runId ||
          row.record.companyId !== bound.companyId
        )
          throw new FleetError("fleet.not_found", 404);
        const object = await store().getObject(row.objectPath);
        if (
          !object ||
          object.acl?.purpose !== "fleet-evidence" ||
          object.acl.visibility !== "private" ||
          digest(object.body) !== row.record.sha256
        )
          throw new FleetError("fleet.not_found", 404);
        safeObject(object);
        return { object, record: FleetEvidenceSchema.parse(row.record) };
      });
    },
  };
}
