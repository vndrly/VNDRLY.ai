import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkScopeSchema,
  FleetEvidenceUploadSessionSchema,
  FleetEvidencePartReceiptSchema,
  type FleetWorkScope,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import type {
  FleetEvidenceUploadRepository,
  FleetEvidenceUploadTransaction,
} from "./fleet-evidence-upload";

type ScopedRepository = {
  withScope<T>(
    actor: FleetActor,
    scope: FleetWorkScope,
    work: (context: FleetWorkExecutionContext) => Promise<T>,
  ): Promise<T>;
};
const pointerSchema = z
  .object({ scope: FleetWorkScopeSchema, sessionId: z.uuid() })
  .strict();
const partSchema = z
  .object({ scope: FleetWorkScopeSchema, part: FleetEvidencePartReceiptSchema })
  .strict();
async function append(
  client: PoolClient,
  actor: FleetActor,
  target: string,
  id: string,
  value: unknown,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_evidence_upload','upload-metadata',$3,$4,$5::jsonb,'completed')",
    [actor.userId, actor.companyId, target, id, JSON.stringify(value)],
  );
}
/** Stores only bounded descriptors, exact part hashes/lengths and completion
 * metadata. Document/photo bytes never enter database audit or tool outputs. */
export function createDatabaseFleetEvidenceUploadRepository(
  repository: ScopedRepository,
  options: {
    authorize: (
      context: FleetWorkExecutionContext,
      ...args: Parameters<FleetEvidenceUploadTransaction["authorize"]>
    ) => ReturnType<FleetEvidenceUploadTransaction["authorize"]>;
    associate: (
      context: FleetWorkExecutionContext,
      ...args: Parameters<FleetEvidenceUploadTransaction["associate"]>
    ) => ReturnType<FleetEvidenceUploadTransaction["associate"]>;
  },
): FleetEvidenceUploadRepository {
  return {
    transaction: (actor, scope, operation) =>
      repository.withScope(actor, scope, async (context) => {
        const { client } = context;
        const row = async (target: string, id: string) => {
          const rows = await client.query(
            "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
            [actor.companyId, target, id],
          );
          const value = rows.rows[0];
          if (value && value.user_id !== actor.userId)
            throw new FleetError("fleet.work_scope_changed", 403);
          return value?.tool_output ?? null;
        };
        const tx: FleetEvidenceUploadTransaction = {
          authorize: (command) => options.authorize(context, command),
          async readSession(key) {
            let id: string;
            if ("operationId" in key) {
              const raw = await row(
                "fleet-evidence-upload-operation",
                key.operationId,
              );
              if (!raw) return null;
              const pointer = pointerSchema.parse(raw);
              if (!isDeepStrictEqual(pointer.scope, scope))
                throw new FleetError("fleet.work_scope_changed", 403);
              id = pointer.sessionId;
            } else id = key.sessionId;
            const raw = await row("fleet-evidence-upload-session", id);
            if (!raw) return null;
            const value = FleetEvidenceUploadSessionSchema.parse(raw);
            if (!isDeepStrictEqual(value.scope, scope))
              throw new FleetError("fleet.work_scope_changed", 403);
            return value;
          },
          async saveSession(raw) {
            const value = FleetEvidenceUploadSessionSchema.parse(raw);
            if (!isDeepStrictEqual(value.scope, scope))
              throw new FleetError("fleet.work_scope_changed", 403);
            const prior = await tx.readSession({ sessionId: value.id });
            if (prior) {
              if (
                !isDeepStrictEqual(
                  { ...prior, completion: null },
                  { ...value, completion: null },
                ) ||
                (prior.completion &&
                  !isDeepStrictEqual(prior.completion, value.completion))
              )
                throw new FleetError("fleet.evidence_session_conflict", 409);
              if (isDeepStrictEqual(prior, value)) return;
            } else {
              const old = await tx.readSession({
                operationId: value.operationId,
              });
              if (old) throw new FleetError("fleet.operation_conflict");
              await append(
                client,
                actor,
                "fleet-evidence-upload-operation",
                value.operationId,
                { scope, sessionId: value.id },
              );
            }
            await append(
              client,
              actor,
              "fleet-evidence-upload-session",
              value.id,
              value,
            );
          },
          async readPart(sessionId, index) {
            if (!(await tx.readSession({ sessionId })))
              throw new FleetError("fleet.evidence_session_not_found", 404);
            const raw = await row(
              "fleet-evidence-upload-part",
              `${sessionId}:${index}`,
            );
            if (!raw) return null;
            const value = partSchema.parse(raw);
            if (
              !isDeepStrictEqual(value.scope, scope) ||
              value.part.partNumber !== index
            )
              throw new FleetError("fleet.work_scope_changed", 403);
            return value.part;
          },
          async savePart(sessionId, raw) {
            const value = FleetEvidencePartReceiptSchema.parse(raw),
              session = await tx.readSession({ sessionId });
            if (!session)
              throw new FleetError("fleet.evidence_session_not_found", 404);
            const expected =
              value.partNumber === session.partCount - 1
                ? session.byteSize - value.partNumber * session.partSize
                : session.partSize;
            if (
              value.partNumber >= session.partCount ||
              value.byteSize !== expected
            )
              throw new FleetError("fleet.invalid_evidence_part", 400);
            const prior = await tx.readPart(sessionId, value.partNumber);
            if (prior) {
              if (!isDeepStrictEqual(prior, value))
                throw new FleetError("fleet.evidence_part_conflict", 409);
              return;
            }
            await append(
              client,
              actor,
              "fleet-evidence-upload-part",
              `${sessionId}:${value.partNumber}`,
              { scope, part: value },
            );
          },
          associate: (session, bytes) =>
            options.associate(context, session, bytes),
        };
        return operation(tx);
      }),
  };
}
