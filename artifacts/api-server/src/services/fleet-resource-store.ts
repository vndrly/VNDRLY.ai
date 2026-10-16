import {
  FleetResourcesRegistrySchema,
  emptyFleetResourcesRegistry,
  type FleetResourcesRegistry,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";

export type FleetResourcesTransaction = {
  state: FleetState;
  client: PoolClient;
};
export async function readFleetResourceRegistry(
  client: PoolClient,
  companyId: number,
): Promise<FleetResourcesRegistry> {
  const result = await client.query(
    "SELECT fleet_resources FROM vendors WHERE id=$1 FOR UPDATE",
    [companyId],
  );
  if (!result.rows.length) throw new FleetError("fleet.not_found", 404);
  return FleetResourcesRegistrySchema.parse(
    result.rows[0].fleet_resources ?? emptyFleetResourcesRegistry(),
  );
}
export async function writeFleetResourceRegistry(
  client: PoolClient,
  actor: FleetActor,
  registry: FleetResourcesRegistry,
) {
  await client.query(
    "UPDATE vendors SET fleet_resources=$2::jsonb WHERE id=$1",
    [
      actor.companyId,
      JSON.stringify(FleetResourcesRegistrySchema.parse(registry)),
    ],
  );
}
export async function appendFleetResourceRecord(
  client: PoolClient,
  actor: FleetActor,
  targetType: string,
  targetId: string,
  value: unknown,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,'fleet','typed','canonical','fleet_resources','resource-snapshot',$4,$5,$6::jsonb,'completed')",
    [
      actor.userId,
      actor.companyId,
      actor.role ?? null,
      targetType,
      targetId,
      JSON.stringify(value),
    ],
  );
}
export async function readFleetResourceRecord(
  client: PoolClient,
  companyId: number,
  targetType: string,
  targetId: string,
  version?: number,
): Promise<unknown | null> {
  const result = await client.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 AND target_id=$3 AND ($4::int IS NULL OR tool_output->>'version'=$4::text) ORDER BY id DESC LIMIT 1",
    [companyId, targetType, targetId, version ?? null],
  );
  return result.rows[0]?.tool_output ?? null;
}
export type FleetResourceAsset = {
  id: string;
  name: string;
  category: string;
  status: string;
  responsible_org_type: string;
  responsible_org_id: number;
  current_holder_user_id: number | null;
  retired_at: Date | null;
  merged_into_id: string | null;
  provisional: boolean;
  enrolled: boolean;
};
export async function readFleetResourceAssets(
  client: PoolClient,
  actor: FleetActor,
  state: FleetState,
  ids: string[],
  allowHistorical = false,
): Promise<FleetResourceAsset[]> {
  const unique = [...new Set(ids)].sort();
  const result = await client.query<FleetResourceAsset>(
    "SELECT a.*,EXISTS(SELECT 1 FROM asset_attachment_links l WHERE l.asset_id=a.id AND l.attachment_type='fleet_inventory' AND l.attachment_id=$2::text) AS enrolled FROM assets a WHERE a.id=ANY($1::uuid[]) ORDER BY a.id FOR UPDATE OF a",
    [unique, actor.companyId],
  );
  if (
    result.rows.length !== unique.length ||
    result.rows.some(
      (row) =>
        row.responsible_org_type !== "vendor" ||
        row.responsible_org_id !== actor.companyId,
    )
  )
    throw new FleetError("fleet.asset_not_found", 404);
  if (
    !allowHistorical &&
    result.rows.some(
      (row) =>
        row.retired_at ||
        row.merged_into_id ||
        row.provisional ||
        ["retired", "merged"].includes(row.status),
    )
  )
    throw new FleetError("fleet.equipment_unavailable");
  if (
    !allowHistorical &&
    result.rows.some(
      (row) =>
        !row.enrolled &&
        !state.fleets.some((group) => group.equipmentAssetIds.includes(row.id)),
    )
  )
    throw new FleetError("fleet.inventory_required", 403);
  return result.rows;
}
