import { eq, sql } from "drizzle-orm";
import {
  db,
  siteLocationsTable,
  siteWorkAssignmentsTable,
} from "@workspace/db";

export function trimAfe(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Site locations carry one AFE; all work at the well uses it. */
export async function loadSiteAssignmentAfe(args: {
  siteLocationId: number;
}): Promise<string | null> {
  const [site] = await db
    .select({ afe: siteLocationsTable.afe })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, args.siteLocationId))
    .limit(1);
  return trimAfe(site?.afe);
}

/** Copy site_locations.afe onto every work assignment at the site (tickets/invoices read this row). */
export async function syncSiteAfeToAssignments(args?: {
  siteLocationId?: number;
}): Promise<number> {
  const siteFilter =
    args?.siteLocationId != null
      ? sql`AND sl.id = ${args.siteLocationId}`
      : sql``;

  const result = await db.execute(sql`
    UPDATE site_work_assignments AS swa
    SET afe = NULLIF(btrim(sl.afe), '')
    FROM site_locations AS sl
    WHERE swa.site_location_id = sl.id
      ${siteFilter}
      AND (
        swa.afe IS NULL
        OR btrim(swa.afe) = ''
        OR btrim(swa.afe) IS DISTINCT FROM btrim(coalesce(sl.afe, ''))
      )
  `);

  return Number(
    (result as { rowCount?: number | null }).rowCount ??
      (result as { rows?: unknown[] }).rows?.length ??
      0,
  );
}
