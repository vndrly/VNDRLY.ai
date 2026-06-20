/**
 * Assign canonical AFE-YYYY-NNNNNN numbers to sites missing site_locations.afe,
 * then copy onto work assignments.
 *
 *   pnpm --filter @workspace/api-server run backfill:missing-site-afes
 *   pnpm --filter @workspace/api-server run backfill:missing-site-afes -- --dry-run
 *   pnpm --filter @workspace/api-server run backfill:missing-site-afes -- --all-sites
 */
import { pool } from "@workspace/db";
import { backfillMissingSiteAfes } from "../src/lib/backfill-missing-site-afes";

const DRY_RUN = process.argv.includes("--dry-run");
const ALL_SITES = process.argv.includes("--all-sites");

async function main() {
  console.log(
    `Missing site AFE backfill${DRY_RUN ? " (DRY RUN)" : ""}${ALL_SITES ? " — all blank sites" : " — sites with assignments only"}`,
  );

  const result = await backfillMissingSiteAfes({
    assignmentsOnly: !ALL_SITES,
    dryRun: DRY_RUN,
    log: (message) => console.log(message),
  });

  console.log(
    `\nDone. ${result.sitesUpdated} site(s) ${DRY_RUN ? "would update" : "updated"}; ${result.assignmentsSynced} assignment row(s) synced.`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
