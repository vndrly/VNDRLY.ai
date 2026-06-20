/**
 * One-off: set state=NJ on E522 test sites with null state, ensure tax_rates row exists.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/fix-e522-nj-state.ts
 */
import { inArray, like, or, eq } from "drizzle-orm";
import { db, pool, siteLocationsTable, taxRatesTable } from "@workspace/db";

const E522_IDS = [232, 235, 180, 188, 190, 198, 205];

async function main() {
  const before = await db
    .select({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
      state: siteLocationsTable.state,
      address: siteLocationsTable.address,
    })
    .from(siteLocationsTable)
    .where(
      or(
        inArray(siteLocationsTable.id, E522_IDS),
        like(siteLocationsTable.name, "E522 Site%"),
      ),
    );

  console.log("Before:", JSON.stringify(before, null, 2));

  const updated = await db
    .update(siteLocationsTable)
    .set({ state: "NJ" })
    .where(
      or(
        inArray(siteLocationsTable.id, E522_IDS),
        like(siteLocationsTable.name, "E522 Site%"),
      ),
    )
    .returning({ id: siteLocationsTable.id, name: siteLocationsTable.name, state: siteLocationsTable.state });

  console.log(`Updated ${updated.length} site(s) to NJ.`);

  const [existingNj] = await db
    .select()
    .from(taxRatesTable)
    .where(eq(taxRatesTable.state, "NJ"));

  if (!existingNj) {
    await db.insert(taxRatesTable).values({
      state: "NJ",
      stateName: "New Jersey",
      rate: "0.0663",
    });
    console.log("Inserted tax_rates row for NJ (6.625%).");
  } else {
    console.log("tax_rates NJ already present:", existingNj.rate);
  }

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
