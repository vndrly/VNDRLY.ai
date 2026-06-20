import { eq, sql } from "drizzle-orm";
import { db, siteLocationsTable } from "@workspace/db";
import { syncSiteAfeToAssignments } from "./resolve-site-assignment-afe";

const CANONICAL_AFE_PATTERN = /^AFE-(\d{4})-(\d+)$/;

export function formatSiteAfe(sequence: number, year = new Date().getFullYear()): string {
  if (!Number.isFinite(sequence) || sequence < 1) {
    throw new Error(`Invalid AFE sequence: ${sequence}`);
  }
  return `AFE-${year}-${String(Math.trunc(sequence)).padStart(6, "0")}`;
}

export function parseSiteAfe(value: string | null | undefined): { year: number; sequence: number } | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = CANONICAL_AFE_PATTERN.exec(trimmed);
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

/** Highest numeric suffix among canonical AFE-YYYY-NNNNNN values on sites. */
export async function loadMaxSiteAfeSequence(): Promise<{ year: number; sequence: number }> {
  const result = await db.execute<{ year: number | null; sequence: number | null }>(sql`
    SELECT
      max((regexp_match(btrim(afe), '^AFE-([0-9]{4})-([0-9]+)$'))[1]::int) AS year,
      max((regexp_match(btrim(afe), '^AFE-([0-9]{4})-([0-9]+)$'))[2]::int) AS sequence
    FROM site_locations
    WHERE afe IS NOT NULL AND btrim(afe) <> ''
  `);

  const row = (result as { rows?: { year: number | null; sequence: number | null }[] }).rows?.[0];
  const year = row?.year ?? new Date().getFullYear();
  const sequence = row?.sequence ?? 0;
  return { year, sequence };
}

export async function backfillMissingSiteAfes(args?: {
  assignmentsOnly?: boolean;
  dryRun?: boolean;
  log?: (message: string) => void;
}): Promise<{ sitesUpdated: number; assignmentsSynced: number }> {
  const dryRun = args?.dryRun ?? false;
  const log = args?.log ?? (() => {});
  const assignmentsOnly = args?.assignmentsOnly ?? true;

  const siteFilter = assignmentsOnly
    ? sql`AND EXISTS (
        SELECT 1 FROM site_work_assignments swa
        WHERE swa.site_location_id = sl.id
      )`
    : sql``;

  const blankSites = await db.execute<{ id: number; name: string; site_code: string }>(sql`
    SELECT sl.id, sl.name, sl.site_code
    FROM site_locations sl
    WHERE (sl.afe IS NULL OR btrim(sl.afe) = '')
      AND sl.superseded_at IS NULL
      ${siteFilter}
    ORDER BY sl.id ASC
  `);

  const rows = (blankSites as { rows?: { id: number; name: string; site_code: string }[] }).rows ?? [];
  if (rows.length === 0) {
    log("  no sites with blank AFE");
    return { sitesUpdated: 0, assignmentsSynced: 0 };
  }

  const { year, sequence: maxSequence } = await loadMaxSiteAfeSequence();
  let nextSequence = maxSequence;

  let sitesUpdated = 0;
  for (const site of rows) {
    nextSequence += 1;
    const afe = formatSiteAfe(nextSequence, year);
    if (dryRun) {
      log(`  would set site #${site.id} (${site.site_code}) → ${afe}`);
      sitesUpdated++;
      continue;
    }

    await db
      .update(siteLocationsTable)
      .set({ afe })
      .where(eq(siteLocationsTable.id, site.id));
    log(`  ✓ site #${site.id} (${site.site_code}) → ${afe}`);
    sitesUpdated++;
  }

  if (dryRun) {
    log(`  dry run — would sync assignments for ${sitesUpdated} site(s)`);
    return { sitesUpdated, assignmentsSynced: 0 };
  }

  const assignmentsSynced = await syncSiteAfeToAssignments();
  if (assignmentsSynced > 0) {
    log(`  ✓ synced AFE onto ${assignmentsSynced} assignment row(s)`);
  }

  return { sitesUpdated, assignmentsSynced };
}
