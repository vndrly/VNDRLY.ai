import type { PoolClient } from "pg";
import { z } from "zod/v4";

// Filter after selecting current heads. Filtering the history first would
// resurrect a driver's old assignment after the activity was reassigned.
const currentAssignments = `WITH current_heads AS (
  SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit
  WHERE vendor_id=$1 AND target_type='fleet-run' ORDER BY target_id,id DESC
), assigned AS (
  SELECT tool_output FROM current_heads
  WHERE tool_output->>'companyId'=$1::text
    AND tool_output->>'driverUserId'=$2::text
    AND tool_output->>'fleetId'=ANY($3::text[])
)`;

/** Assignment-derived read context, never a personal customer/site grant.
 * The caller must still resolve these sites through current company authority. */
export async function readFleetDriverAssignmentSites(
  client: PoolClient,
  actor: { companyId: number; userId: number },
  groupIds: readonly string[],
): Promise<number[]> {
  if (!groupIds.length) return [];
  const result = await client.query(
    `${currentAssignments}
    SELECT DISTINCT site.value::int AS "siteId" FROM assigned
    CROSS JOIN LATERAL jsonb_array_elements_text(tool_output->'siteIds') site(value)
    ORDER BY "siteId"`,
    [actor.companyId, actor.userId, groupIds],
  );
  return result.rows.map(row => z.number().int().positive().parse(row.siteId));
}

/** Only current nonterminal assigned resources at currently authorized sites.
 * Return identities, without loading a company's unbounded run/price history. */
export async function readFleetDriverAssignedAssetIds(
  client: PoolClient,
  actor: { companyId: number; userId: number; currentSiteIds?: number[] },
  groupIds: readonly string[],
): Promise<string[]> {
  if (!groupIds.length || !actor.currentSiteIds?.length) return [];
  const result = await client.query(
    `${currentAssignments}, authorized AS (
      SELECT tool_output FROM assigned
      WHERE tool_output->>'status' NOT IN ('completed','cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(tool_output->'siteIds') site(value)
          WHERE NOT (site.value::int=ANY($4::int[]))
        )
    ), assigned_assets AS (
      SELECT tool_output->>'vehicleAssetId' AS id FROM authorized
      UNION SELECT tool_output->>'trailerAssetId' FROM authorized
      UNION SELECT component->>'assetId' FROM authorized
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(
          tool_output#>'{resourceAssignment,snapshot,rigPackage,components}',
          '[]'::jsonb)) component
    ) SELECT DISTINCT id FROM assigned_assets WHERE id IS NOT NULL ORDER BY id`,
    [actor.companyId, actor.userId, groupIds, actor.currentSiteIds],
  );
  return result.rows.map(row => z.uuid().parse(row.id));
}
