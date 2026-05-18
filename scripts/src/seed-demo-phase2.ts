import bcrypt from "bcryptjs";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  ticketsTable,
  ticketCrewTable,
  ticketScheduledNotificationsTable,
} from "@workspace/db";

async function main() {
  const DEMO_PW = "vndrly123";
  const DEMO_USER_IDS = [5, 9, 10];
  const UNSCHEDULE_TICKET_IDS = [99, 101];

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "Refusing to run demo seed in production. Set ALLOW_DEMO_SEED=true to override.",
    );
    process.exit(1);
  }

  console.log("→ Resetting demo passwords");
  const hash = bcrypt.hashSync(DEMO_PW, 10);
  for (const uid of DEMO_USER_IDS) {
    const r = await db
      .update(usersTable)
      .set({ passwordHash: hash })
      .where(eq(usersTable.id, uid))
      .returning({ id: usersTable.id, username: usersTable.username });
    if (r.length === 0) {
      console.warn(`  - user ${uid}: NOT FOUND, skipped`);
    } else {
      console.log(`  - user ${uid} (${r[0].username}): password reset`);
    }
  }

  console.log("→ Unscheduling tickets to expose schedulable demo state");
  for (const tid of UNSCHEDULE_TICKET_IDS) {
    const upd = await db
      .update(ticketsTable)
      .set({
        scheduledStartAt: null,
        scheduledDurationMinutes: null,
        foremanUserId: null,
        scheduledAt: null,
        scheduledById: null,
        lateCheckInReminderSentAt: null,
      })
      .where(eq(ticketsTable.id, tid))
      .returning({ id: ticketsTable.id });
    if (upd.length === 0) {
      console.warn(`  - ticket ${tid}: NOT FOUND, skipped`);
      continue;
    }
    const removed = await db
      .update(ticketCrewTable)
      .set({ removedAt: new Date() })
      .where(and(eq(ticketCrewTable.ticketId, tid), isNull(ticketCrewTable.removedAt)))
      .returning({ id: ticketCrewTable.id });
    const delNotif = await db
      .delete(ticketScheduledNotificationsTable)
      .where(eq(ticketScheduledNotificationsTable.ticketId, tid))
      .returning({ id: ticketScheduledNotificationsTable.id });
    console.log(
      `  - ticket ${tid}: cleared schedule, removed ${removed.length} crew row(s), deleted ${delNotif.length} pending notif(s)`,
    );
  }

  console.log("→ Verifying acceptance");

  type CountRow = { total: number };
  type IdRow = { id: number };
  const unwrap = <T>(result: unknown): T[] => {
    if (Array.isArray(result)) return result as T[];
    if (result && typeof result === "object" && "rows" in result) {
      return (result as { rows: T[] }).rows;
    }
    return [];
  };

  const totalsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM tickets t JOIN site_locations sl ON sl.id = t.site_location_id
    WHERE t.vendor_id = 3 AND sl.partner_id = 19
  `);
  const schedulableResult = await db.execute(sql`
    SELECT t.id
    FROM tickets t JOIN site_locations sl ON sl.id = t.site_location_id
    LEFT JOIN ticket_crew tc ON tc.ticket_id = t.id AND tc.removed_at IS NULL
    WHERE t.vendor_id = 3 AND sl.partner_id = 19
      AND t.status = 'draft'
      AND t.scheduled_start_at IS NULL
    GROUP BY t.id
    HAVING COUNT(tc.id) = 0
    ORDER BY t.id
  `);

  const totalRows = unwrap<CountRow>(totalsResult);
  const schedRows = unwrap<IdRow>(schedulableResult);
  const total = totalRows[0]?.total ?? 0;
  console.log(`  total Winchester×Mach tickets: ${total}`);
  console.log(
    `  schedulable (draft, no crew, no scheduled_start_at): ${schedRows.length} → ids ${schedRows.map((r) => r.id).join(", ")}`,
  );

  console.log("✓ Done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
