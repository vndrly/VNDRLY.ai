import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "@workspace/db";
import {
  InventoryMergeCommandSchema,
  InventoryPolicyCommandSchema,
  InventoryPolicyReadSchema,
  InventoryManagementReceiptSchema,
  inventoryManagementFingerprintValues,
  type InventoryManagementReceipt,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { authorizeAssetHoldRelease } from "./asset-hold-release";
import { AssetServiceError } from "./assets";
type Owner = { type: "vendor" | "partner"; id: number };
type Asset = {
  id: string;
  responsible_org_type: string;
  responsible_org_id: number;
  version: number;
  status: string;
  current_holder_user_id: number | null;
  condition?: string;
};
export function managementFingerprint(
  ...args: Parameters<typeof inventoryManagementFingerprintValues>
) {
  return createHash("sha256")
    .update(JSON.stringify(inventoryManagementFingerprintValues(...args)))
    .digest("hex");
}
export function assertMergeableAssets(
  a: Asset,
  b: Asset,
  input: {
    expectedVersion: number;
    mergedExpectedVersion: number;
    mergedAssetId: string;
  },
) {
  if (a.id === b.id || b.id !== input.mergedAssetId)
    throw new AssetServiceError("asset.invalid_merge", 409);
  if (
    a.responsible_org_type !== b.responsible_org_type ||
    a.responsible_org_id !== b.responsible_org_id
  )
    throw new AssetServiceError("asset.cross_owner_merge_forbidden", 403);
  if (
    a.version !== input.expectedVersion ||
    b.version !== input.mergedExpectedVersion
  )
    throw new AssetServiceError("asset.version_conflict", 409);
  if (
    [a, b].some(
      (x) =>
        x.status !== "available" ||
        x.current_holder_user_id !== null ||
        ["damaged", "missing", "stolen"].includes(x.condition ?? ""),
    )
  )
    throw new AssetServiceError("asset.merge_unavailable", 409);
}
const defaults = {
  identifierRequired: false,
  photosRequiredOnCheckout: false,
  photosRequiredOnReturn: false,
  supervisorApprovalRequired: false,
  expectedReturnRequired: false,
};
function currentOwner(s: SessionPayload): Owner {
  if (!s.userId) throw new AssetServiceError("asset.unauthenticated", 401);
  const owner = s.vendorId
    ? { type: "vendor" as const, id: s.vendorId }
    : s.partnerId
      ? { type: "partner" as const, id: s.partnerId }
      : null;
  if (!owner) throw new AssetServiceError("asset.current_owner_required", 403);
  return owner;
}
async function authorize(c: PoolClient, s: SessionPayload, owner: Owner) {
  await authorizeAssetHoldRelease(c, s, {
    id: "",
    responsible_org_type: owner.type,
    responsible_org_id: owner.id,
    version: 0,
    status: "available",
    current_holder_user_id: null,
  });
}
function assertOwner(a: Asset, o: Owner) {
  if (a.responsible_org_type !== o.type || a.responsible_org_id !== o.id)
    throw new AssetServiceError("asset.not_found", 404);
}
async function lockOperation(c: PoolClient, op: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "inventory-management-operation:" + op,
  ]);
}
async function receipt(c: PoolClient, s: SessionPayload, o: Owner, op: string) {
  const rows = await c.query(
    "SELECT user_id,tool_output FROM assistant_action_audit WHERE target_type='inventory-management' AND tool_input->>'operationId'=$1 ORDER BY id DESC LIMIT 1",
    [op],
  );
  if (!rows.rows.length) return null;
  const r = InventoryManagementReceiptSchema.parse(rows.rows[0].tool_output);
  if (
    rows.rows[0].user_id !== s.userId ||
    r.actorUserId !== s.userId ||
    r.owner.type !== o.type ||
    r.owner.id !== o.id
  )
    throw new AssetServiceError("asset.operation_reused", 409);
  return r;
}
async function append(
  c: PoolClient,
  s: SessionPayload,
  r: InventoryManagementReceipt,
) {
  await c.query(
    "INSERT INTO assistant_action_audit(user_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status,vendor_id,partner_id) VALUES($1,$2,'inventory','typed','canonical','inventory_management',$3,'inventory-management',$4,$5::jsonb,$6::jsonb,'completed',$7,$8)",
    [
      s.userId,
      s.role,
      r.action,
      r.targetId,
      JSON.stringify({
        operationId: r.operationId,
        fingerprint: r.commandFingerprint,
      }),
      JSON.stringify(r),
      r.owner.type === "vendor" ? r.owner.id : null,
      r.owner.type === "partner" ? r.owner.id : null,
    ],
  );
}
function replay(r: InventoryManagementReceipt | null, hash: string) {
  if (r && r.commandFingerprint !== hash)
    throw new AssetServiceError("asset.operation_reused", 409);
  return r;
}
async function policy(c: PoolClient, o: Owner, category: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "inventory-policy:" + o.type + ":" + o.id + ":" + category,
  ]);
  const rows = await c.query(
    "SELECT * FROM asset_category_policies WHERE owner_org_type=$1 AND owner_org_id=$2 AND category=$3 FOR UPDATE",
    [o.type, o.id, category],
  );
  const row = rows.rows[0];
  const prior = await c.query(
    "SELECT tool_output FROM assistant_action_audit WHERE target_type='inventory-management' AND action_type='policy' AND tool_output->'owner'->>'type'=$1 AND tool_output->'owner'->>'id'=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
    [o.type, String(o.id), category],
  );
  const saved = prior.rows.length
    ? InventoryManagementReceiptSchema.parse(prior.rows[0].tool_output)
    : null;
  const fields = row
    ? {
        identifierRequired: row.identifier_required,
        photosRequiredOnCheckout: row.photos_required_on_checkout,
        photosRequiredOnReturn: row.photos_required_on_return,
        supervisorApprovalRequired: row.supervisor_approval_required,
        expectedReturnRequired: row.expected_return_required,
      }
    : defaults;
  if (saved && JSON.stringify(saved.policy) !== JSON.stringify(fields))
    throw new AssetServiceError("asset.policy_record_drift", 409);
  return InventoryPolicyReadSchema.parse({
    owner: o,
    category,
    version: saved?.version ?? 0,
    policy: fields,
  });
}
export function createInventoryManagementService(
  database: Pick<Pool, "connect"> = pool,
) {
  async function transaction<T>(
    s: SessionPayload,
    work: (c: PoolClient, o: Owner) => Promise<T>,
    authorizeFirst = true,
  ) {
    const o = currentOwner(s),
      c = await database.connect();
    try {
      await c.query("BEGIN");
      if (authorizeFirst) await authorize(c, s, o);
      const result = await work(c, o);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  return {
    readPolicy: (s: SessionPayload, category: string) =>
      transaction(s, (c, o) => policy(c, o, category)),
    readReceipt: (s: SessionPayload, operationId: string) =>
      transaction(
        s,
        async (c, o) => {
          const r = await receipt(c, s, o, operationId);
          if (r?.action === "merge") {
            const ids = [r.targetId, r.mergedAssetId!].sort();
            const rows = await c.query(
              "SELECT * FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
              [ids],
            );
            if (rows.rows.length !== 2)
              throw new AssetServiceError("asset.not_found", 404);
            for (const a of rows.rows) assertOwner(a, o);
          }
          await authorize(c, s, o);
          return { receipt: r };
        },
        false,
      ),
    configurePolicy: (s: SessionPayload, category: string, raw: unknown) =>
      transaction(s, async (c, o) => {
        const input = InventoryPolicyCommandSchema.parse(raw);
        await lockOperation(c, input.operationId);
        const hash = managementFingerprint(
            "policy",
            s.userId!,
            o,
            category,
            input,
          ),
          prior = replay(await receipt(c, s, o, input.operationId), hash);
        if (prior) return prior;
        const current = await policy(c, o, category);
        if (current.version !== input.expectedVersion)
          throw new AssetServiceError("asset.version_conflict", 409);
        const p = input.policy;
        await c.query(
          "INSERT INTO asset_category_policies(owner_org_type,owner_org_id,category,identifier_required,photos_required_on_checkout,photos_required_on_return,supervisor_approval_required,expected_return_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_org_type,owner_org_id,category) DO UPDATE SET identifier_required=EXCLUDED.identifier_required,photos_required_on_checkout=EXCLUDED.photos_required_on_checkout,photos_required_on_return=EXCLUDED.photos_required_on_return,supervisor_approval_required=EXCLUDED.supervisor_approval_required,expected_return_required=EXCLUDED.expected_return_required,updated_at=now()",
          [
            o.type,
            o.id,
            category,
            p.identifierRequired,
            p.photosRequiredOnCheckout,
            p.photosRequiredOnReturn,
            p.supervisorApprovalRequired,
            p.expectedReturnRequired,
          ],
        );
        const r = InventoryManagementReceiptSchema.parse({
          operationId: input.operationId,
          actorUserId: s.userId,
          owner: o,
          action: "policy",
          targetId: category,
          commandFingerprint: hash,
          previousVersion: current.version,
          version: current.version + 1,
          policy: p,
          previousPolicy: current.policy,
          recordedAt: new Date().toISOString(),
          status: "applied",
          physicalPossessionVerified: false,
          legalOwnershipVerified: false,
        });
        await append(c, s, r);
        return r;
      }),
    merge: (s: SessionPayload, assetId: string, raw: unknown) =>
      transaction(
        s,
        async (c, o) => {
          const input = InventoryMergeCommandSchema.parse(raw);
          await lockOperation(c, input.operationId);
          const hash = managementFingerprint(
            "merge",
            s.userId!,
            o,
            assetId,
            input,
          );
          const rows = await c.query(
            "SELECT * FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [[assetId, input.mergedAssetId].sort()],
          );
          // Match existing Inventory commands: assets first, then current actor locks.
          // No receipt or effect is returned before this transactional authorization.
          await authorize(c, s, o);
          const a = rows.rows.find((x) => x.id === assetId) as
              | Asset
              | undefined,
            b = rows.rows.find((x) => x.id === input.mergedAssetId) as
              | Asset
              | undefined;
          if (!a || !b) throw new AssetServiceError("asset.not_found", 404);
          assertOwner(a, o);
          assertOwner(b, o);
          const prior = replay(await receipt(c, s, o, input.operationId), hash);
          if (prior) return prior;
          assertMergeableAssets(a, b, input);
          const safety = await c.query(
            "SELECT EXISTS(SELECT 1 FROM asset_holds WHERE asset_id=ANY($1::uuid[]) AND released_at IS NULL) AS held,EXISTS(SELECT 1 FROM asset_condition_evidence e WHERE e.asset_id=ANY($1::uuid[]) AND e.condition IN ('damaged','missing','stolen') AND NOT EXISTS(SELECT 1 FROM asset_condition_evidence newer WHERE newer.asset_id=e.asset_id AND newer.condition NOT IN ('not_reported') AND (newer.reported_at,newer.id)>(e.reported_at,e.id))) AS unsafe",
            [[assetId, input.mergedAssetId]],
          );
          if (safety.rows[0]?.held || safety.rows[0]?.unsafe)
            throw new AssetServiceError("asset.merge_unavailable", 409);
          // Original custody, evidence, aliases and attachments retain their source IDs.
          await c.query(
            "UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1 AND version=$2",
            [assetId, input.expectedVersion],
          );
          await c.query(
            "UPDATE assets SET status='merged',merged_into_id=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3",
            [assetId, input.mergedAssetId, input.mergedExpectedVersion],
          );
          await c.query(
            "INSERT INTO asset_merges(surviving_asset_id,merged_asset_id,reason,merged_by_user_id) VALUES($1,$2,$3,$4)",
            [assetId, input.mergedAssetId, input.reason, s.userId],
          );
          await c.query(
            "INSERT INTO asset_custody_events(id,asset_id,event_type,note,actor_user_id,operation_id,asset_version,command_fingerprint) VALUES($4,$1,'merge',$2,$3,$4,$5,$6)",
            [
              assetId,
              input.reason,
              s.userId,
              input.operationId,
              input.expectedVersion + 1,
              hash,
            ],
          );
          const r = InventoryManagementReceiptSchema.parse({
            operationId: input.operationId,
            actorUserId: s.userId,
            owner: o,
            action: "merge",
            targetId: assetId,
            commandFingerprint: hash,
            previousVersion: input.expectedVersion,
            version: input.expectedVersion + 1,
            mergedAssetId: input.mergedAssetId,
            mergedPreviousVersion: input.mergedExpectedVersion,
            mergedVersion: input.mergedExpectedVersion + 1,
            recordedAt: new Date().toISOString(),
            status: "applied",
            physicalPossessionVerified: false,
            legalOwnershipVerified: false,
          });
          await append(c, s, r);
          return r;
        },
        false,
      ),
  };
}
