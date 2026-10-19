import { SEMANTIC_SERVICE_MARKETPLACE_FLAG } from "@workspace/db/schema";
export { SEMANTIC_SERVICE_MARKETPLACE_FLAG } from "@workspace/db/schema";

export interface SemanticMarketplaceScope {
  ownerOrgType: "partner" | "vendor";
  ownerOrgId: number;
  siteId?: number | null;
}

/** Admin support must select the same organization scope; there is no global admin bypass. */
export async function isSemanticMarketplaceEnabled(
  scope: SemanticMarketplaceScope | null,
): Promise<boolean> {
  if (
    !scope ||
    !["partner", "vendor"].includes(scope.ownerOrgType) ||
    !Number.isSafeInteger(scope.ownerOrgId) ||
    scope.ownerOrgId <= 0 ||
    (scope.siteId != null &&
      (!Number.isSafeInteger(scope.siteId) || scope.siteId <= 0))
  )
    return false;
  const { pool } = await import("@workspace/db");
  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM capability_flags
     WHERE owner_org_type=$1 AND owner_org_id=$2 AND flag_name=$3
       AND (site_id IS NULL OR site_id=$4)
     ORDER BY site_id NULLS LAST LIMIT 1`,
    [
      scope.ownerOrgType,
      scope.ownerOrgId,
      SEMANTIC_SERVICE_MARKETPLACE_FLAG,
      scope.siteId ?? null,
    ],
  );
  return result.rows[0]?.enabled === true;
}
