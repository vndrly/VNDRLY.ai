/**
 * Backfill tax jurisdiction (ZIP + rates) for all active site locations.
 *
 *   pnpm --filter @workspace/api-server run backfill:site-tax-jurisdictions
 *   pnpm --filter @workspace/api-server run backfill:site-tax-jurisdictions -- --dry-run
 *
 * Resolves situs from state rubrics + county-seat ZIP proxies (Census / Nominatim geocoding).
 */
import { isNull } from "drizzle-orm";
import { db, pool, siteLocationsTable } from "@workspace/db";
import { persistSiteTaxJurisdiction } from "../src/lib/tax-jurisdiction";

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const sites = await db
    .select({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      state: siteLocationsTable.state,
    })
    .from(siteLocationsTable)
    .where(isNull(siteLocationsTable.supersededAt));

  console.log(
    `Site tax jurisdiction backfill — ${sites.length} site(s)${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  let ok = 0;
  let failed = 0;

  for (const site of sites) {
    if (DRY_RUN) {
      console.log(`  would resolve #${site.id} ${site.name}`);
      ok++;
      continue;
    }

    const resolved = await persistSiteTaxJurisdiction(
      site.id,
      site.latitude,
      site.longitude,
      site.state,
      site.address,
    );
    if (resolved) {
      ok++;
      console.log(
        `  ✓ #${site.id} ${site.name} — ${resolved.jurisdictionLabel} (${resolved.provider})`,
      );
    } else {
      failed++;
      console.log(`  ✗ #${site.id} ${site.name} — could not resolve`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${ok} resolved, ${failed} failed.`);
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
