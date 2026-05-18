/**
 * One-time backfill that tags pre-existing site_locations rows with the
 * correct `source_type` so that the new ingest-rrc-occ-wells.ts pipeline
 * can reason about provenance and supersession.
 *
 * Heuristic:
 *   - Rows with siteRadiusMeters = 30000 are the county-level area anchors
 *     inserted by seed-permian-site-locations.ts and seed-mach-site-locations.ts.
 *     → source_type = 'area-anchor'
 *   - All other pre-existing rows stay as 'manual' (the column default).
 *
 * Idempotent: only updates rows whose source_type is still the default
 * 'manual'. Safe to re-run.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/backfill-site-source-types.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, siteLocationsTable } from "@workspace/db";

async function main() {
  // Promote 30km-radius county-aggregate rows to source_type='area-anchor'
  const updated = await db
    .update(siteLocationsTable)
    .set({ sourceType: "area-anchor" })
    .where(
      and(
        eq(siteLocationsTable.siteRadiusMeters, 30000),
        eq(siteLocationsTable.sourceType, "manual"),
        isNull(siteLocationsTable.supersededAt),
      ),
    )
    .returning({ id: siteLocationsTable.id });

  console.log(`Tagged ${updated.length} county-area-anchor rows (radius=30000m) as source_type='area-anchor'.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
