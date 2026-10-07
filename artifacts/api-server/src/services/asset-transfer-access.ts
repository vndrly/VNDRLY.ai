import { AssetTransferReceiptSchema } from "@workspace/api-zod";
import type { AssetOwner, AssetRecord } from "./assets";

export type TransferActor = {
  userId: number;
  owner: AssetOwner | null;
  isPlatformAdmin: boolean;
  isAssetManager: boolean;
  isGateSupervisor: boolean;
  canCheckOutAsset: boolean;
};
export function canTransferAsset(
  actor: TransferActor,
  asset: AssetRecord,
): boolean {
  const sameOwner =
    actor.owner?.type === asset.responsibleOwner.type &&
    actor.owner?.id === asset.responsibleOwner.id;
  return (
    (sameOwner || actor.isPlatformAdmin) &&
    actor.canCheckOutAsset &&
    asset.status === "checked_out" &&
    asset.holderUserId !== null &&
    (actor.isAssetManager ||
      actor.isGateSupervisor ||
      actor.userId === asset.holderUserId)
  );
}
export async function readTransferRecipients(
  database: {
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>;
  },
  asset: AssetRecord,
) {
  const result = await database.query(
    `SELECT u.id AS user_id, u.display_name FROM users u
    WHERE u.suspended_at IS NULL AND u.id <> $3 AND (
      EXISTS (SELECT 1 FROM user_org_memberships m WHERE m.user_id=u.id AND m.org_type=$1
        AND (($1='vendor' AND m.vendor_id=$2) OR ($1='partner' AND m.partner_id=$2)))
      OR ($1='vendor' AND EXISTS (SELECT 1 FROM managed_subcontractor_worker_sponsorships s
        WHERE s.worker_user_id=u.id AND s.sponsor_vendor_id=$2 AND s.status = 'active')))
    ORDER BY u.display_name, u.id LIMIT 51`,
    [
      asset.responsibleOwner.type,
      asset.responsibleOwner.id,
      asset.holderUserId,
    ],
  );
  return {
    recipients: result.rows
      .slice(0, 50)
      .map((row) => ({
        userId: Number(row.user_id),
        displayName: String(row.display_name).slice(0, 200) || "Company member",
      })),
    truncated: result.rows.length > 50,
  };
}
export function assetTransferReceipt(
  asset: AssetRecord,
  operationId: string,
  actorUserId: number,
) {
  const event = asset.history.find(
    (row) =>
      row.id === operationId &&
      row.type === "transfer" &&
      row.actorUserId === actorUserId,
  );
  if (!event) return null;
  return AssetTransferReceiptSchema.parse({
    assetId: asset.id,
    operationId,
    actorUserId,
    fromHolderUserId: event.fromHolderUserId,
    toHolderUserId: event.toHolderUserId,
    condition: event.condition,
    commandFingerprint: event.commandFingerprint,
    recordedAt: event.occurredAt.toISOString(),
    physicalHandoffVerified: false,
  });
}
