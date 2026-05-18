import { and, eq, lt, sql } from "drizzle-orm";
import { db, ticketsTable, siteLocationsTable, notificationsTable } from "@workspace/db";
import { notifyUsers, findVendorUserIds, findPartnerUserIds } from "../routes/notifications";
import { logger } from "./logger";

const INACTIVITY_DAYS = 30;
const ACTIVE_STATUSES = ["initiated", "draft", "in_progress", "pending_review", "kicked_back", "submitted"] as const;

export async function runInactivityScan(): Promise<number> {
  const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

  const stale = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      partnerId: siteLocationsTable.partnerId,
      updatedAt: ticketsTable.updatedAt,
      status: ticketsTable.status,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(
      and(
        lt(ticketsTable.updatedAt, cutoff),
        sql`${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review', 'kicked_back', 'submitted')`,
      ),
    );

  let inserted = 0;
  for (const t of stale) {
    const link = `/tickets/${t.id}`;
    const [existing] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.type, "ticket_inactive"),
          eq(notificationsTable.link, link),
          sql`${notificationsTable.createdAt} > ${t.updatedAt}`,
        ),
      )
      .limit(1);
    if (existing) continue;

    const userIds = new Set<number>();
    if (t.vendorId) (await findVendorUserIds(t.vendorId)).forEach((id) => userIds.add(id));
    if (t.partnerId) (await findPartnerUserIds(t.partnerId)).forEach((id) => userIds.add(id));
    if (!userIds.size) continue;

    await notifyUsers([...userIds], {
      type: "ticket_inactive",
      title: "Tracking number is inactive",
      body: `Tracking #${String(t.id).padStart(4, "0")} has had no activity for over ${INACTIVITY_DAYS} days.`,
      link,
    });
    inserted += userIds.size;
  }
  return inserted;
}

export function startInactivityNotifier(): void {
  const intervalMs = 6 * 60 * 60 * 1000;
  const tick = () => {
    runInactivityScan()
      .then((n) => { if (n > 0) logger.info({ inserted: n }, "Inactivity notifications enqueued"); })
      .catch((err) => logger.error({ err }, "Inactivity scan failed"));
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, intervalMs);
}
