import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  AssetIdentifierClaimInputSchema,
  AssetIdentifierClaimContinuationSchema,
  AssetIdentifierClaimResolutionSchema,
  type AssetIdentifierClaim,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { authorizeAssetHoldRelease } from "./asset-hold-release";
import { AssetServiceError } from "./assets";
type StoredClaim = AssetIdentifierClaim & {
  requesterOwner: { type: string; id: number };
  existingAssetId: string;
  assetVersion: number;
};
const normalize = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
function project(claim: StoredClaim): AssetIdentifierClaim {
  const {
    requesterOwner: _owner,
    existingAssetId: _existing,
    assetVersion: _version,
    ...visible
  } = claim;
  return visible;
}
function requesterActions(session: SessionPayload, claim: StoredClaim): ("respond" | "withdraw")[] {
  const owner = session.vendorId ? { type: "vendor", id: session.vendorId } : session.partnerId ? { type: "partner", id: session.partnerId } : null;
  if (session.role === "admin" || !owner || owner.type !== claim.requesterOwner.type || owner.id !== claim.requesterOwner.id) return [];
  return claim.status === "awaiting_evidence" ? ["respond", "withdraw"] : claim.status === "pending_review" ? ["withdraw"] : [];
}
async function append(
  client: PoolClient,
  session: SessionPayload,
  claim: StoredClaim,
  operationId: string,
  fingerprint: string,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,'inventory','typed','canonical','asset_identifier_claim','claim-snapshot','asset-identifier-claim',$3,$4::jsonb,$5::jsonb,'completed')",
    [
      session.userId,
      session.role,
      claim.id,
      JSON.stringify({ operationId, fingerprint }),
      JSON.stringify(claim),
    ],
  );
}
async function prior(
  client: PoolClient,
  operationId: string,
  fingerprint: string,
  actorId: number | undefined,
  assetId: string,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    operationId,
  ]);
  const result = await client.query(
    "SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE target_type='asset-identifier-claim' AND tool_input->>'operationId'=$1 ORDER BY id DESC LIMIT 1",
    [operationId],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (
    row.user_id !== actorId ||
    row.tool_input.fingerprint !== fingerprint ||
    row.tool_output.assetId !== assetId
  )
    throw new AssetServiceError("asset.operation_reused");
  return row.tool_output as StoredClaim;
}
export function createAssetIdentifierClaimService(
  database: Pick<Pool, "connect">,
) {
  async function transaction<T>(
    session: SessionPayload,
    assetId: string,
    work: (client: PoolClient, asset: Record<string, any>) => Promise<T>,
  ) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM assets WHERE id=$1 FOR UPDATE",
        [assetId],
      );
      const asset = result.rows[0];
      if (!asset) throw new AssetServiceError("asset.not_found", 404);
      await authorizeAssetHoldRelease(client, session, asset);
      const output = await work(client, asset);
      await client.query("COMMIT");
      return output;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new AssetServiceError("asset.identifier_in_use");
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    async reviewQueue(session: SessionPayload) {
      const client = await database.connect();
      try {
        const user = await client.query(
          "SELECT role FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL",
          [session.userId, session.sv],
        );
        if (session.role !== "admin" || user.rows[0]?.role !== "admin")
          throw new AssetServiceError("asset.mediator_required", 403);
        const rows = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,id FROM assistant_action_audit WHERE target_type='asset-identifier-claim' ORDER BY target_id,id DESC) latest WHERE tool_output->>'status' IN ('pending_review','awaiting_evidence') ORDER BY id DESC LIMIT 101",
        );
        return {
          claims: rows.rows
            .slice(0, 100)
            .map((row) => project(row.tool_output)),
          truncated: rows.rows.length > 100,
        };
      } finally {
        client.release();
      }
    },
    async list(session: SessionPayload, assetId: string) {
      return transaction(session, assetId, async (client) => {
        const rows = await client.query(
          "SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE target_type='asset-identifier-claim' AND tool_output->>'assetId'=$1 ORDER BY target_id,id DESC LIMIT 101",
          [assetId],
        );
        const incoming = await client.query("SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE target_type='asset-identifier-claim' AND tool_output->>'existingAssetId'=$1 ORDER BY target_id,id DESC LIMIT 101", [assetId]);
        return {
          incoming: incoming.rows.slice(0, 100).map(row => { const claim = row.tool_output as StoredClaim; return { id: claim.id, assetId, alias: claim.alias, status: claim.status, submittedAt: claim.submittedAt, reviewedAt: claim.reviewedAt, ownershipTransferred: false, requesterDisclosed: false }; }),
          incomingTruncated: incoming.rows.length > 100,
          claims: rows.rows
            .slice(0, 100)
            .map((row) => ({ ...project(row.tool_output), requesterActions: requesterActions(session, row.tool_output) })),
          truncated: rows.rows.length > 100,
        };
      });
    },
    async submit(session: SessionPayload, assetId: string, value: unknown) {
      const input = AssetIdentifierClaimInputSchema.parse(value),
        fingerprint = createHash("sha256")
          .update(JSON.stringify(["submit", session.userId, assetId, input]))
          .digest("hex");
      return transaction(session, assetId, async (client, asset) => {
        const replay = await prior(
          client,
          input.operationId,
          fingerprint,
          session.userId,
          assetId,
        );
        if (replay) return { claim: project(replay), notice: null };
        if (asset.version !== input.expectedVersion)
          throw new AssetServiceError("asset.version_conflict");
        if (["retired", "merged"].includes(asset.status))
          throw new AssetServiceError("asset.claim_unavailable");
        const value = normalize(input.alias.value);
        if (!value)
          throw new AssetServiceError("asset.invalid_identifier", 400);
        const existing = await client.query(
          "SELECT a.id,a.responsible_org_type,a.responsible_org_id FROM asset_aliases x JOIN assets a ON a.id=x.asset_id WHERE x.kind=$1 AND x.jurisdiction=$2 AND x.normalized_value=$3 FOR SHARE OF x,a",
          [
            input.alias.kind,
            input.alias.jurisdiction?.trim().toUpperCase() ?? "",
            value,
          ],
        );
        if (!existing.rows.length || existing.rows[0].id === assetId)
          throw new AssetServiceError(
            "asset.identifier_collision_required",
            409,
          );
        const duplicate = await client.query(
          "SELECT id FROM assistant_action_audit WHERE target_type='asset-identifier-claim' AND target_id=$1 LIMIT 1",
          [input.claimId],
        );
        if (duplicate.rows.length)
          throw new AssetServiceError("asset.operation_reused");
        const other = existing.rows[0];
        const claim: StoredClaim = {
          id: input.claimId,
          assetId,
          alias: input.alias,
          status: "pending_review",
          version: 1,
          operationId: input.operationId,
          submittedAt: new Date().toISOString(),
          reviewedAt: null,
          reason: input.reason,
          reviewReason: null,
          ownershipTransferred: false,
          otherOwnerDisclosed: false,
          requesterOwner: {
            type: asset.responsible_org_type,
            id: asset.responsible_org_id,
          },
          existingAssetId: other.id,
          assetVersion: asset.version,
        };
        await append(client, session, claim, input.operationId, fingerprint);
        const recipients = await client.query(
          "SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_type=$1 AND COALESCE(m.vendor_id,m.partner_id)=$2 AND u.role IN ('vendor','partner','field_employee') AND u.suspended_at IS NULL AND (m.role='admin' OR (m.org_type='vendor' AND EXISTS(SELECT 1 FROM vendor_people p WHERE p.id=m.vendor_people_id AND p.user_id=m.user_id AND p.vendor_id=m.vendor_id AND p.vendor_role='asset_manager' AND p.is_active=true AND p.deleted_at IS NULL)))",
          [other.responsible_org_type, other.responsible_org_id],
        );
        return {
          claim: project(claim),
          notice: {
            userIds: recipients.rows.map((row) => Number(row.user_id)),
            operationId: input.operationId,
          },
        };
      });
    },
    async continueClaim(session: SessionPayload, assetId: string, claimId: string, action: "respond" | "withdraw", value: unknown) {
      const input = AssetIdentifierClaimContinuationSchema.parse(value);
      const fingerprint = createHash("sha256").update(JSON.stringify([action, session.userId, assetId, claimId, input])).digest("hex");
      return transaction(session, assetId, async (client, asset) => {
        const owner = session.vendorId ? { type: "vendor", id: session.vendorId } : session.partnerId ? { type: "partner", id: session.partnerId } : null;
        // Company requester authority never substitutes platform mediation.
        if (session.role === "admin" || !owner || owner.type !== asset.responsible_org_type || owner.id !== asset.responsible_org_id)
          throw new AssetServiceError("asset.not_found", 404);
        const saved = await client.query("SELECT tool_output FROM assistant_action_audit WHERE target_type='asset-identifier-claim' AND target_id=$1 AND tool_output->>'assetId'=$2 ORDER BY id DESC LIMIT 1", [claimId, assetId]);
        const claim = saved.rows[0]?.tool_output as StoredClaim | undefined;
        if (!claim || claim.requesterOwner.type !== owner.type || claim.requesterOwner.id !== owner.id)
          throw new AssetServiceError("asset.claim_not_found", 404);
        const replay = await prior(client, input.operationId, fingerprint, session.userId, assetId);
        if (replay) return project(replay);
        if (claim.version !== input.expectedVersion) throw new AssetServiceError("asset.version_conflict");
        if (action === "respond" ? claim.status !== "awaiting_evidence" : !["pending_review", "awaiting_evidence"].includes(claim.status))
          throw new AssetServiceError("asset.claim_terminal", 409);
        const now = new Date().toISOString();
        const updated: StoredClaim = { ...claim, version: claim.version + 1, operationId: input.operationId,
          status: action === "respond" ? "pending_review" : "withdrawn", responseReason: input.reason,
          ...(action === "respond" ? { respondedAt: now } : { withdrawnAt: now }), physicalEvidenceVerified: false };
        await append(client, session, updated, input.operationId, fingerprint);
        return project(updated);
      });
    },
    async resolve(
      session: SessionPayload,
      assetId: string,
      claimId: string,
      value: unknown,
    ) {
      const input = AssetIdentifierClaimResolutionSchema.parse(value),
        fingerprint = createHash("sha256")
          .update(
            JSON.stringify([
              "resolve",
              session.userId,
              assetId,
              claimId,
              input,
            ]),
          )
          .digest("hex");
      return transaction(session, assetId, async (client, asset) => {
        const user = await client.query(
          "SELECT role FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL FOR SHARE",
          [session.userId, session.sv],
        );
        if (session.role !== "admin" || user.rows[0]?.role !== "admin")
          throw new AssetServiceError("asset.mediator_required", 403);
        const replay = await prior(
          client,
          input.operationId,
          fingerprint,
          session.userId,
          assetId,
        );
        if (replay) return project(replay);
        const saved = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='asset-identifier-claim' AND target_id=$1 AND tool_output->>'assetId'=$2 ORDER BY id DESC LIMIT 1",
          [claimId, assetId],
        );
        const claim = saved.rows[0]?.tool_output as StoredClaim | undefined;
        if (!claim) throw new AssetServiceError("asset.claim_not_found", 404);
        if (claim.version !== input.expectedVersion)
          throw new AssetServiceError("asset.version_conflict");
        if (!["pending_review", "awaiting_evidence"].includes(claim.status))
          throw new AssetServiceError("asset.claim_terminal", 409);
        if (input.correctedAlias) {
          if (
            asset.version !== claim.assetVersion ||
            ["retired", "merged"].includes(asset.status)
          )
            throw new AssetServiceError("asset.version_conflict");
          const normalized = normalize(input.correctedAlias.value);
          if (!normalized)
            throw new AssetServiceError("asset.invalid_identifier", 400);
          const added = await client.query(
            "INSERT INTO asset_aliases(asset_id,kind,jurisdiction,normalized_value,display_value) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,jurisdiction,normalized_value) DO NOTHING RETURNING id",
            [
              assetId,
              input.correctedAlias.kind,
              input.correctedAlias.jurisdiction?.trim().toUpperCase() ?? "",
              normalized,
              input.correctedAlias.value.trim(),
            ],
          );
          if (!added.rows.length)
            throw new AssetServiceError("asset.identifier_in_use");
          await client.query(
            "UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1",
            [assetId],
          );
        }
        const status = {
          request_evidence: "awaiting_evidence",
          reject: "rejected",
          retain_existing: "resolved_existing_retained",
          correct_requester_alias: "resolved_requester_corrected",
        } as const;
        const updated: StoredClaim = {
          ...claim,
          status: status[input.decision],
          version: claim.version + 1,
          operationId: input.operationId,
          reviewedAt: new Date().toISOString(),
          reviewReason: input.reason,
          ...(input.correctedAlias ? { correctedAlias: input.correctedAlias } : {}),
        };
        await append(client, session, updated, input.operationId, fingerprint);
        return project(updated);
      });
    },
  };
}
