import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FleetRun } from "@workspace/api-zod";

type ReturnActor = { companyId: number; userId: number };

function returnAssetIds(run: FleetRun) {
  const snapshot = run.resourceAssignment?.snapshot ?? run.recoveredWork?.snapshot;
  return [...new Set([
    run.vehicleAssetId,
    ...(run.trailerAssetId ? [run.trailerAssetId] : []),
    ...(snapshot?.rigPackage?.components.map(component => component.assetId) ?? []),
  ])];
}

/** Records the physical return before closeout is submitted. Attached rigging
 * keeps following the truck until Yard verifies detach/transfer/discrepancies. */
export async function recordFleetReturn(client: PoolClient, actor: ReturnActor, run: FleetRun, notes: string) {
  const assetIds = returnAssetIds(run);
  const detailId = run.resourceAssignment?.snapshot.detail.id ?? run.recoveredWork?.snapshot.detail.id ?? null;
  const yard = await client.query(
    "SELECT id FROM fleet_yards WHERE company_id=$1 AND active=true ORDER BY is_home_base DESC,id LIMIT 1",
    [actor.companyId],
  );
  const yardId = (yard.rows[0]?.id as string | undefined) ?? null;
  const observedAt = new Date().toISOString();
  for (const assetId of assetIds) {
    const saved = await client.query(
      "INSERT INTO fleet_asset_custody(id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,run_id,detail_id,latitude,longitude,notes,version) VALUES($1,$2,$3,$4,'driver_app',$5,$6,$7,$8,$9,NULL,NULL,$10,1) ON CONFLICT(company_id,asset_id) DO UPDATE SET state=EXCLUDED.state,method=EXCLUDED.method,observed_at=EXCLUDED.observed_at,observed_by_user_id=EXCLUDED.observed_by_user_id,yard_id=EXCLUDED.yard_id,run_id=EXCLUDED.run_id,detail_id=EXCLUDED.detail_id,latitude=NULL,longitude=NULL,notes=EXCLUDED.notes,version=fleet_asset_custody.version+1,updated_at=now() RETURNING version",
      [randomUUID(), actor.companyId, assetId, "returned", observedAt, actor.userId, yardId, run.id, detailId, notes],
    );
    const version = Number(saved.rows[0]?.version ?? 1);
    await client.query(
      "INSERT INTO fleet_asset_custody_events(operation_id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,run_id,detail_id,latitude,longitude,notes,asset_version) VALUES($1,$2,$3,'returned','driver_app',$4,$5,$6,$7,$8,NULL,NULL,$9,$10)",
      [randomUUID(), actor.companyId, assetId, observedAt, actor.userId, yardId, run.id, detailId, notes, version],
    );
  }
  await client.query(
    "UPDATE assets SET current_holder_user_id=NULL WHERE responsible_org_type='vendor' AND responsible_org_id=$1 AND id=ANY($2::uuid[])",
    [actor.companyId, assetIds],
  );

  const existing = await client.query(
    "SELECT id FROM fleet_yard_orders WHERE company_id=$1 AND run_id=$2 AND notes LIKE 'Return verification:%' AND status<>'reported' ORDER BY requested_at DESC LIMIT 1",
    [actor.companyId, run.id],
  );
  let yardOrderId = (existing.rows[0]?.id as string | undefined) ?? null;
  if (!yardOrderId) {
    yardOrderId = randomUUID();
    const orderNotes = `Return verification: ${notes || "Verify returned Detail, condition, detach, and final Yard placement."}`;
    await client.query(
      "INSERT INTO fleet_yard_orders(id,company_id,yard_id,detail_id,run_id,status,outcome,requested_by_user_id,assigned_to_user_id,requested_at,scheduled_at,started_at,reported_at,requested_asset_ids,actual_asset_ids,findings,notes,version) VALUES($1,$2,$3,$4,$5,'requested',NULL,$6,NULL,$7,NULL,NULL,NULL,$8::uuid[],'{}'::uuid[],'[]'::jsonb,$9,1)",
      [yardOrderId, actor.companyId, yardId, detailId, run.id, actor.userId, observedAt, assetIds, orderNotes],
    );
    await client.query(
      "INSERT INTO fleet_yard_order_events(company_id,order_id,operation_id,actor_user_id,event_type,order_version,detail) VALUES($1,$2,$3,$4,'requested',1,$5::jsonb)",
      [actor.companyId, yardOrderId, randomUUID(), actor.userId, JSON.stringify({ source: "driver_return", runId: run.id })],
    );
  }
  return { assetIds, yardOrderId, yardId };
}
