import { randomUUID } from "node:crypto";
import {retainFleetWorkOriginal} from "./fleet-work-originals";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkScopeSchema,
  FleetWorkReceiptSchema,
  FleetWorkMappingSchema,
  FleetReconciliationCaseSchema,
  type FleetWorkCommand,
  type FleetWorkScope,
  type FleetWorkReference,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import {
  databaseFleetRepository,
  FleetError,
  type FleetRepository,
  type FleetState,
} from "./fleet-repository";
import type { FleetActor } from "./fleet-ops";
import type {
  FleetWorkRepository,
  FleetWorkExecution,
  FleetWorkTransaction,
} from "./fleet-work";

const provisionSchema = z
  .object({
    version: z.literal(2),
    scope: FleetWorkScopeSchema,
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    appVersion: z.string().trim().min(1).max(100),
    revokedAt: z.iso.datetime().nullable(),
    renewedAt:z.iso.datetime().optional(),
  })
  .strict();
const provisionInput = z
  .object({ deviceId: z.uuid(), appVersion: z.string().trim().min(1).max(100) })
  .strict();
export type FleetWorkExecutionContext = {
  actor: FleetActor;
  state: FleetState;
  client: PoolClient;
};
type Execute = (
  context: FleetWorkExecutionContext,
  command: FleetWorkCommand,
) => Promise<FleetWorkExecution>;
const mappingKey = (
  scope: FleetWorkScope,
  local: Pick<FleetWorkReference, "kind" | "id">,
) => `${scope.provisioningId}:${local.kind}:${local.id}`;
async function append(
  client: PoolClient,
  actor: FleetActor,
  type: string,
  id: string,
  value: unknown,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_work',$3,$4,$5,$6::jsonb,'completed')",
    [
      actor.userId,
      actor.companyId,
      `${type}-record`,
      type,
      id,
      JSON.stringify(value),
    ],
  );
}
/** Existing vendor/session transaction and indexed itemized audit are reused.
 * No raw original command, clinical value, source document or photo is written
 * to the ordinary audit. Safe immutable receipts survive bounded run views. */
export function createDatabaseFleetWorkRepository(options: {
  execute: Execute;
  base?: FleetRepository;
  now?: () => Date;
}) {
  const base = options.base ?? databaseFleetRepository,
    now = options.now ?? (() => new Date());
  async function requireDevice(
    client: PoolClient,
    actor: FleetActor,
    deviceId: string,
  ) {
    const device = await client.query(
      "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type='vendor' AND owner_org_id=$3 AND revoked_at IS NULL FOR SHARE",
      [deviceId, actor.userId, actor.companyId],
    );
    if (!device.rows.length)
      throw new FleetError("fleet.work_device_unavailable", 403);
  }
  const provision = (actor: FleetActor, raw: unknown) =>
    base.transaction(
      actor.companyId,
      actor.userId,
      async (state, client) => {
        const input = provisionInput.parse(raw);
        if (actor.readOnly) throw new FleetError("fleet.read_only", 403);
        if (
          !state.enabled ||
          !(
            actor.membershipRole === "admin" ||
            state.grants.some(
              (g) =>
                g.userId === actor.userId &&
                g.roles.length &&
                g.fleetIds.some((id) => state.fleets.some((f) => f.id === id)),
            )
          )
        )
          throw new FleetError("fleet.grant_required", 403);
        await requireDevice(client, actor, input.deviceId);
        const issuedAt = now().toISOString(),
          scope = FleetWorkScopeSchema.parse({
            owner: { type: "vendor", id: actor.companyId },
            userId: actor.userId,
            membershipId: actor.activeMembershipId,
            sessionVersion: actor.sv,
            deviceId: input.deviceId,
            provisioningId: randomUUID(),
          });
        const value = provisionSchema.parse({
          version: 2,
          scope,
          appVersion: input.appVersion,
          issuedAt,
          expiresAt: new Date(
            Date.parse(issuedAt) + 7 * 86400000,
          ).toISOString(),
          revokedAt: null,
        });
        await append(
          client,
          actor,
          "fleet-work-provision",
          scope.provisioningId,
          value,
        );
        return value;
      },
      actor,
    );
  function scopedTransaction<T>(
    actor: FleetActor,
    operation: (
      tx: FleetWorkTransaction,
      context: FleetWorkExecutionContext,
    ) => Promise<T>,
  ): Promise<T> {
    return base.transaction(
      actor.companyId,
      actor.userId,
      async (state, client) => {
        const tx: FleetWorkTransaction = {
          async requireProvisioning(scope, write) {
            if (
              scope.owner.type !== "vendor" ||
              scope.owner.id !== actor.companyId ||
              scope.userId !== actor.userId ||
              scope.membershipId !== actor.activeMembershipId ||
              scope.sessionVersion !== actor.sv
            )
              throw new FleetError("fleet.work_scope_changed", 403);
            await requireDevice(client, actor, z.uuid().parse(scope.deviceId));
            const rows = await client.query(
              "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-provision' AND target_id=$2 ORDER BY id DESC LIMIT 1",
              [actor.companyId, scope.provisioningId],
            );
            const row = rows.rows[0],
              value = provisionSchema.safeParse(row?.tool_output);
            if (
              row?.user_id !== actor.userId ||
              !value.success ||
              !isDeepStrictEqual(value.data.scope, scope) ||
              value.data.revokedAt
            )
              throw new FleetError("fleet.work_scope_changed", 403);
            if (
              write &&
              (actor.readOnly ||
                Date.parse(value.data.expiresAt) <= now().getTime())
            )
              throw new FleetError(
                actor.readOnly
                  ? "fleet.read_only"
                  : "fleet.work_provisioning_expired",
                403,
              );
          },
          async readReceipt(scope, operationId) {
            z.uuid().parse(operationId);
            const rows = await client.query(
              "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type IN ('fleet-work-operation','fleet-work-resolution-receipt') AND target_id=$2 ORDER BY id DESC LIMIT 1",
              [actor.companyId, operationId],
            );
            if (!rows.rows.length) return null;
            const row = rows.rows[0],
              receipt = FleetWorkReceiptSchema.parse(row.tool_output);
            if (
              row.user_id !== actor.userId ||
              !isDeepStrictEqual(receipt.scope, scope)
            )
              throw new FleetError("fleet.work_scope_changed", 403);
            return receipt;
          },
          async saveReceipt(receipt) {
            for (const mapping of "mappings" in receipt
              ? receipt.mappings
              : []) {
              const key = mappingKey(receipt.scope, mapping.local),
                rows = await client.query(
                  "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-mapping' AND target_id=$2 ORDER BY id DESC LIMIT 1",
                  [actor.companyId, key],
                );
              if (rows.rows.length) {
                const prior = z
                  .object({
                    scope: FleetWorkScopeSchema,
                    mapping: FleetWorkMappingSchema,
                  })
                  .strict()
                  .parse(rows.rows[0].tool_output);
                if (
                  rows.rows[0].user_id !== actor.userId ||
                  !isDeepStrictEqual(prior.scope, receipt.scope) ||
                  !isDeepStrictEqual(prior.mapping, mapping)
                )
                  throw new FleetError("fleet.work_mapping_conflict");
              } else
                await append(client, actor, "fleet-work-mapping", key, {
                  scope: receipt.scope,
                  mapping,
                });
            }
            if (await tx.readReceipt(receipt.scope, receipt.operationId))
              throw new FleetError("fleet.operation_conflict");
            await append(
              client,
              actor,
              "fleet-work-operation",
              receipt.operationId,
              FleetWorkReceiptSchema.parse(receipt),
            );
          },
          async saveCase(value,original) {
            if(original)await retainFleetWorkOriginal(client,original);
            await append(
              client,
              actor,
              "fleet-work-case",
              value.id,
              FleetReconciliationCaseSchema.parse(value),
            );
          },
          async execute(command) {
            const original = structuredClone(state);
            await client.query("SAVEPOINT fleet_work_business");
            try {
              const result = await options.execute(
                { actor, state, client },
                command,
              );
              await client.query("RELEASE SAVEPOINT fleet_work_business");
              return result;
            } catch (error) {
              await client.query("ROLLBACK TO SAVEPOINT fleet_work_business");
              await client.query("RELEASE SAVEPOINT fleet_work_business");
              Object.assign(state, original);
              throw error;
            }
          },
        };
        return operation(tx, { actor, state, client });
      },
      actor,
    );
  }
  const repository: FleetWorkRepository = {
    transaction: (actor, operation) =>
      scopedTransaction(actor, (tx) => operation(tx)),
  };
  const withScope = <T>(
    actor: FleetActor,
    scope: FleetWorkScope,
    work: (context: FleetWorkExecutionContext) => Promise<T>,
  ) =>
    scopedTransaction(actor, async (tx, context) => {
      await tx.requireProvisioning(FleetWorkScopeSchema.parse(scope), true);
      return work(context);
    });
  const readScope = <T>(
    actor: FleetActor,
    scope: FleetWorkScope,
    work: (context: FleetWorkExecutionContext) => Promise<T>,
  ) =>
    scopedTransaction(actor, async (tx, context) => {
      // Read-only/expired provisioning may recover retained facts. The actual
      // session, membership, original scope and nonrevoked device still apply.
      await tx.requireProvisioning(FleetWorkScopeSchema.parse(scope), false);
      return work(context);
    });
  const renewProvision=(actor:FleetActor,raw:unknown)=>scopedTransaction(actor,async(tx,context)=>{
    const {scope}=z.object({scope:FleetWorkScopeSchema}).strict().parse(raw);await tx.requireProvisioning(scope,false);
    if(actor.readOnly||!context.state.enabled||!(actor.membershipRole==="admin"||context.state.grants.some(grant=>grant.userId===actor.userId&&grant.roles.length&&grant.fleetIds.some(id=>context.state.fleets.some(group=>group.id===id)))))throw new FleetError("fleet.grant_required",403);
    const row=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-provision' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,scope.provisioningId])).rows[0];
    const original=provisionSchema.parse(row.tool_output),renewedAt=now().toISOString(),saved=provisionSchema.parse({...original,renewedAt,expiresAt:new Date(Date.parse(renewedAt)+7*86400000).toISOString()});
    await append(context.client,actor,"fleet-work-provision",scope.provisioningId,saved);return saved;
  });
  return { ...repository, provision, renewProvision, withScope, readScope };
}
