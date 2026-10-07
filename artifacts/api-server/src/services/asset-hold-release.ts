import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "@workspace/db";
import { AssetHoldReleaseInputSchema } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { AssetServiceError } from "./assets";
type Asset = {
  id: string;
  responsible_org_type: string;
  responsible_org_id: number;
  version: number;
  status: string;
  current_holder_user_id: number | null;
};
export async function authorizeAssetHoldRelease(
  client: PoolClient,
  session: SessionPayload,
  asset: Asset,
) {
  const user = await client.query(
    "SELECT role FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL FOR SHARE",
    [session.userId, session.sv],
  );
  if (!user.rows.length)
    throw new AssetServiceError("asset.current_session_required", 403);
  if (session.role === "admin" && user.rows[0].role === "admin") return;
  const owner = session.vendorId
    ? { type: "vendor", id: session.vendorId }
    : session.partnerId
      ? { type: "partner", id: session.partnerId }
      : null;
  if (
    !owner ||
    owner.type !== asset.responsible_org_type ||
    owner.id !== asset.responsible_org_id
  )
    throw new AssetServiceError("asset.not_found", 404);
  const members = await client.query(
    "SELECT role,vendor_people_id FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND org_type=$3 AND COALESCE(vendor_id,partner_id)=$4 FOR SHARE",
    [session.activeMembershipId, session.userId, owner.type, owner.id],
  );
  if (!members.rows.length)
    throw new AssetServiceError("asset.current_membership_required", 403);
  if (members.rows[0].role === "admin") return;
  if (owner.type === "vendor") {
    if (members.rows[0].vendor_people_id) {
      const people = await client.query("SELECT id FROM vendor_people WHERE id=$1 AND user_id=$2 AND vendor_id=$3 AND vendor_role='asset_manager' AND is_active=true AND deleted_at IS NULL FOR SHARE", [members.rows[0].vendor_people_id, session.userId, owner.id]);
      if (people.rows.length) return;
    }
    const grants = await client.query(
      "SELECT g.id FROM managed_subcontractor_role_grants g JOIN managed_subcontractor_worker_sponsorships s ON s.id=g.sponsorship_id WHERE s.worker_user_id=$1 AND s.sponsor_vendor_id=$2 AND s.status='active' AND g.status='active' AND g.role='asset_manager' FOR SHARE OF g,s",
      [session.userId, owner.id],
    );
    if (grants.rows.length) return;
  }
  throw new AssetServiceError("asset.asset_manager_required", 403);
}
export async function readAssetHolds(
  client: Pick<PoolClient, "query">,
  assetId: string,
) {
  const result = await client.query(
    "SELECT h.id,h.reason,h.placed_at,EXISTS(SELECT 1 FROM assistant_action_audit a WHERE a.target_type='fleet-maintenance' AND a.tool_output->>'holdId'=h.id::text) AS fleet_owned FROM asset_holds h WHERE h.asset_id=$1 AND h.released_at IS NULL ORDER BY h.placed_at,h.id",
    [assetId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    reason: String(row.reason),
    placedAt: new Date(row.placed_at).toISOString(),
    source: row.fleet_owned
      ? ("fleet_maintenance" as const)
      : ("inventory" as const),
  }));
}
export function createAssetHoldReleaseService(
  database: Pick<Pool, "connect"> = pool,
) {
  return {
    async release(
      session: SessionPayload,
      assetId: string,
      holdId: string,
      input: unknown,
    ) {
      const body = AssetHoldReleaseInputSchema.parse(input),
        client = await database.connect();
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            assetId,
            holdId,
            session.userId,
            body.expectedVersion,
            body.reason,
          ]),
        )
        .digest("hex");
      try {
        await client.query("BEGIN");
        const assets = await client.query(
          "SELECT * FROM assets WHERE id=$1 FOR UPDATE",
          [assetId],
        );
        const asset = assets.rows[0] as Asset | undefined;
        if (!asset) throw new AssetServiceError("asset.not_found", 404);
        await authorizeAssetHoldRelease(client, session, asset);
        const prior = await client.query(
          "SELECT asset_id,actor_user_id,event_type,command_fingerprint,asset_version FROM asset_custody_events WHERE operation_id=$1",
          [body.operationId],
        );
        if (prior.rows.length) {
          const event = prior.rows[0];
          if (
            event.asset_id !== assetId ||
            event.actor_user_id !== session.userId ||
            event.event_type !== "hold_release" ||
            event.command_fingerprint !== fingerprint
          )
            throw new AssetServiceError("asset.operation_reused");
          await client.query("COMMIT");
          return {
            assetId,
            holdId,
            operationId: body.operationId,
            version: event.asset_version,
            status: "applied",
            physicalRepairVerified: false as const,
          };
        }
        if (asset.version !== body.expectedVersion)
          throw new AssetServiceError("asset.version_conflict");
        if (["merged", "retired"].includes(asset.status))
          throw new AssetServiceError("asset.hold_release_unavailable", 409);
        const holds = await readAssetHolds(client, assetId),
          hold = holds.find((row) => row.id === holdId);
        if (!hold) throw new AssetServiceError("asset.hold_not_found", 404);
        if (hold.source === "fleet_maintenance")
          throw new AssetServiceError(
            "asset.fleet_maintenance_release_required",
            403,
          );
        const changed = await client.query(
          "UPDATE asset_holds SET released_at=now(),released_by_user_id=$1 WHERE id=$2 AND asset_id=$3 AND released_at IS NULL RETURNING id",
          [session.userId, holdId, assetId],
        );
        if (changed.rows.length !== 1)
          throw new AssetServiceError("asset.version_conflict");
        const status =
          holds.length > 1
            ? "held"
            : asset.current_holder_user_id === null
              ? "available"
              : "checked_out";
        await client.query(
          "UPDATE assets SET status=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3",
          [status, assetId, body.expectedVersion],
        );
        await client.query(
          "INSERT INTO asset_custody_events(id,asset_id,event_type,actor_user_id,operation_id,asset_version,command_fingerprint,note) VALUES($1,$2,'hold_release',$3,$1,$4,$5,$6)",
          [
            body.operationId,
            assetId,
            session.userId,
            asset.version + 1,
            fingerprint,
            JSON.stringify({
              holdId,
              reason: body.reason,
              physicalRepairVerified: false,
            }),
          ],
        );
        await client.query("COMMIT");
        return {
          assetId,
          holdId,
          operationId: body.operationId,
          version: asset.version + 1,
          status: "applied",
          physicalRepairVerified: false as const,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505") throw new AssetServiceError("asset.operation_reused");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
