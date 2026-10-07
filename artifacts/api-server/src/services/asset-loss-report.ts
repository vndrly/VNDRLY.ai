import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AssetLossReportInputSchema } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { authorizeAssetHoldRelease } from "./asset-hold-release";
import { AssetServiceError } from "./assets";
export function createAssetLossReportService(database: Pick<Pool, "connect">) {
  return {
    async report(session: SessionPayload, assetId: string, value: unknown) {
      const input = AssetLossReportInputSchema.parse(value),
        client = await database.connect();
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            assetId,
            session.userId,
            input.expectedVersion,
            input.condition,
            input.reason,
          ]),
        )
        .digest("hex");
      try {
        await client.query("BEGIN");
        const assets = await client.query(
          "SELECT * FROM assets WHERE id=$1 FOR UPDATE",
          [assetId],
        );
        const asset = assets.rows[0];
        if (!asset) throw new AssetServiceError("asset.not_found", 404);
        try {
          await authorizeAssetHoldRelease(client, session, asset);
        } catch (error) {
          if (
            !(error instanceof AssetServiceError) ||
            error.code !== "asset.asset_manager_required" ||
            asset.current_holder_user_id !== session.userId
          )
            throw error;
          if (session.role === "field_employee") {
            const active = await client.query(
              "SELECT id FROM vendor_people WHERE user_id=$1 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL FOR SHARE",
              [session.userId, session.vendorId],
            );
            if (!active.rows.length)
              throw new AssetServiceError(
                "asset.current_membership_required",
                403,
              );
          }
        }
        const prior = await client.query(
          "SELECT * FROM asset_custody_events WHERE operation_id=$1",
          [input.operationId],
        );
        const receipt = (event: Record<string, any>) => ({
          assetId,
          operationId: input.operationId,
          version: event.asset_version,
          status: "applied" as const,
          condition: input.condition,
          holderUserId: event.from_holder_user_id,
          reportedAt: new Date(event.occurred_at).toISOString(),
          physicalLossVerified: false as const,
        });
        if (prior.rows.length) {
          const event = prior.rows[0];
          if (
            event.asset_id !== assetId ||
            event.actor_user_id !== session.userId ||
            event.event_type !== "condition" ||
            event.command_fingerprint !== fingerprint
          )
            throw new AssetServiceError("asset.operation_reused");
          await client.query("COMMIT");
          return receipt(event);
        }
        if (asset.version !== input.expectedVersion)
          throw new AssetServiceError("asset.version_conflict");
        if (["retired", "merged"].includes(asset.status))
          throw new AssetServiceError("asset.loss_report_unavailable", 409);
        const version = asset.version + 1;
        const event = await client.query(
          "INSERT INTO asset_custody_events(id,asset_id,event_type,actor_user_id,from_holder_user_id,to_holder_user_id,condition,note,operation_id,asset_version,command_fingerprint) VALUES($1,$2,'condition',$3,$4,$4,$5,$6,$1,$7,$8) RETURNING *",
          [
            input.operationId,
            assetId,
            session.userId,
            asset.current_holder_user_id,
            input.condition,
            input.reason,
            version,
            fingerprint,
          ],
        );
        await client.query(
          "INSERT INTO asset_condition_evidence(asset_id,custody_event_id,condition,note,reported_by_user_id) VALUES($1,$2,$3,$4,$5)",
          [
            assetId,
            input.operationId,
            input.condition,
            input.reason,
            session.userId,
          ],
        );
        await client.query(
          "INSERT INTO asset_holds(asset_id,reason,placed_by_user_id) VALUES($1,$2,$3)",
          [assetId, `${input.condition}: ${input.reason}`, session.userId],
        );
        await client.query(
          "UPDATE assets SET status='held',version=$1,updated_at=now() WHERE id=$2",
          [version, assetId],
        );
        await client.query("COMMIT");
        return receipt(event.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505")
          throw new AssetServiceError("asset.operation_reused");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
