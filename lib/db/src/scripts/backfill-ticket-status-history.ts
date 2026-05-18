/**
 * One-shot backfill for Task #493 (ticket lifecycle schema foundation).
 *
 * - Sets `intake_channel` to `partner_self_service` on any ticket that is
 *   still NULL after the schema migration. The schema default backfills
 *   newly added rows, but this guards against any row inserted between the
 *   migration plan and the column-default arrival.
 * - Inserts ONE synthetic `ticket_status_history` row per ticket capturing
 *   `null → currentStatus, actorUserId = createdById, createdAt = createdAt`,
 *   so analytics has a complete history starting from day one even though
 *   no real transitions were captured before this task landed.
 *
 * The backfill is idempotent: it only inserts a synthetic row when no
 * history exists yet for that ticket (NOT EXISTS subquery), so re-running
 * the script is safe.
 *
 * Run with:  pnpm --filter @workspace/db run backfill:status-history
 */
import { eq, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  ticketsTable,
  ticketStatusHistoryTable,
  usersTable,
} from "../index";

async function main(): Promise<void> {
  // 1. Backfill intake_channel for any pre-default rows.
  const intakeUpdate = await db
    .update(ticketsTable)
    .set({ intakeChannel: "partner_self_service" })
    .where(isNull(ticketsTable.intakeChannel))
    .returning({ id: ticketsTable.id });
  console.log(
    `[backfill] intake_channel set on ${intakeUpdate.length} ticket(s)`,
  );

  // 2. Insert one synthetic history row per ticket that has none yet.
  //    Use the typed query builder + a NOT EXISTS predicate so re-running
  //    the script is a no-op and we never need to cast the result shape.
  const ticketsNeedingHistory = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      createdById: ticketsTable.createdById,
      createdAt: ticketsTable.createdAt,
      actorRole: usersTable.role,
    })
    .from(ticketsTable)
    .leftJoin(usersTable, eq(usersTable.id, ticketsTable.createdById))
    .where(
      sql`NOT EXISTS (SELECT 1 FROM ${ticketStatusHistoryTable} h WHERE h.ticket_id = ${ticketsTable.id})`,
    );

  if (ticketsNeedingHistory.length === 0) {
    console.log("[backfill] no synthetic history rows needed");
  } else {
    const values = ticketsNeedingHistory.map((row) => ({
      ticketId: row.id,
      fromStatus: null,
      toStatus: row.status,
      actorUserId: row.createdById,
      actorRole: row.actorRole,
      reason: "backfill: synthetic initial-state row (Task #493)",
      createdAt: row.createdAt,
    }));
    await db.insert(ticketStatusHistoryTable).values(values);
    console.log(
      `[backfill] inserted ${values.length} synthetic history row(s)`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] FAILED", err);
  process.exit(1);
});
