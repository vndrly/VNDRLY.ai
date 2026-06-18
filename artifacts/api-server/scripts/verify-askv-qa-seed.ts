/**
 * Quick read-only sanity check for [ASKV-QA] seeded tickets.
 *   pnpm --filter @workspace/api-server exec tsx scripts/verify-askv-qa-seed.ts
 */
import { and, eq, isNotNull, like, sql } from "drizzle-orm";
import {
  db,
  pool,
  ticketCheckInsTable,
  ticketCrewTable,
  ticketLineItemsTable,
  ticketsTable,
} from "@workspace/db";

const MARKER = "[ASKV-QA]";

async function main() {
  const [totals] = await db
    .select({
      tickets: sql<number>`count(*)::int`,
      vendors: sql<number>`count(distinct ${ticketsTable.vendorId})::int`,
      sites: sql<number>`count(distinct ${ticketsTable.siteLocationId})::int`,
    })
    .from(ticketsTable)
    .where(like(ticketsTable.description, `${MARKER}%`));

  const byStatus = await db
    .select({
      status: ticketsTable.status,
      n: sql<number>`count(*)::int`,
    })
    .from(ticketsTable)
    .where(like(ticketsTable.description, `${MARKER}%`))
    .groupBy(ticketsTable.status)
    .orderBy(ticketsTable.status);

  const [checkIns] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      withCheckout: sql<number>`count(*) filter (where ${ticketCheckInsTable.checkOutAt} is not null)::int`,
    })
    .from(ticketCheckInsTable)
    .innerJoin(ticketsTable, eq(ticketCheckInsTable.ticketId, ticketsTable.id))
    .where(like(ticketsTable.description, `${MARKER}%`));

  const [crew] = await db
    .select({ rows: sql<number>`count(*)::int` })
    .from(ticketCrewTable)
    .innerJoin(ticketsTable, eq(ticketCrewTable.ticketId, ticketsTable.id))
    .where(like(ticketsTable.description, `${MARKER}%`));

  const [lineItems] = await db
    .select({ rows: sql<number>`count(*)::int` })
    .from(ticketLineItemsTable)
    .innerJoin(ticketsTable, eq(ticketLineItemsTable.ticketId, ticketsTable.id))
    .where(like(ticketsTable.description, `${MARKER}%`));

  const [hoursReady] = await db
    .select({
      ticketsWithCheckout: sql<number>`count(distinct ${ticketsTable.id})::int`,
    })
    .from(ticketsTable)
    .where(
      and(
        like(ticketsTable.description, `${MARKER}%`),
        isNotNull(ticketsTable.checkOutTime),
      ),
    );

  console.log("AskV QA seed verification");
  console.log("-------------------------");
  console.log(totals);
  console.log("\nBy status:");
  for (const row of byStatus) console.log(`  ${row.status}: ${row.n}`);
  console.log("\nChild rows:", { checkIns, crew, lineItems });
  console.log("Tickets with check-out (hours queryable):", hoursReady);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  void pool.end();
  process.exit(1);
});
