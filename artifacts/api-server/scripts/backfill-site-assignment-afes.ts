/**
 * Copy site_locations.afe onto site_work_assignments.afe for every assignment.
 *
 *   pnpm --filter @workspace/api-server run backfill:site-assignment-afes
 *   pnpm --filter @workspace/api-server run backfill:site-assignment-afes -- --dry-run
 *   pnpm --filter @workspace/api-server run backfill:site-assignment-afes -- --site-id=42
 */
import { pool } from "@workspace/db";
import { backfillSiteAssignmentAfes } from "../src/lib/backfill-site-assignment-afes";

const DRY_RUN = process.argv.includes("--dry-run");
const siteIdArg = process.argv.find((a) => a.startsWith("--site-id="));
const SITE_ID = siteIdArg ? Number(siteIdArg.split("=")[1]) : null;

async function main() {
  console.log(
    `Site assignment AFE backfill (site → assignments)${DRY_RUN ? " (DRY RUN)" : ""}${SITE_ID ? ` — site #${SITE_ID}` : ""}`,
  );

  const result = await backfillSiteAssignmentAfes({
    siteLocationId: SITE_ID && Number.isFinite(SITE_ID) ? SITE_ID : undefined,
    dryRun: DRY_RUN,
    log: (message) => console.log(message),
  });

  console.log(
    `\nDone. ${result.updated} assignment row(s) ${DRY_RUN ? "would update" : "updated"}.`,
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
