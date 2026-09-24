import { and, eq } from "drizzle-orm";
import { db, siteWorkAssignmentsTable, userOrgMembershipsTable } from "@workspace/db";
import { currentNotificationRecipients } from "../work-hub/notification-recipients";
import { notifyUsers } from "../routes/notifications";
import { logger } from "../lib/logger";

/** Call after the gate transaction commits. The existing inbox owns deduplication. */
export async function notifyGateSiteEvent(siteId: number, notice: {
  type: "gate_handoff_ready" | "gate_handoff_revised" | "gate_handoff_ack_required" | "gate_closed";
  title: string; body?: string; link: string; dedupeKey: string;
}): Promise<void> {
  try {
    const candidates = await db.select({ vendorId: userOrgMembershipsTable.vendorId, userId: userOrgMembershipsTable.userId })
      .from(userOrgMembershipsTable)
      .innerJoin(siteWorkAssignmentsTable, eq(siteWorkAssignmentsTable.vendorId, userOrgMembershipsTable.vendorId))
      .where(and(eq(userOrgMembershipsTable.orgType, "vendor"), eq(siteWorkAssignmentsTable.siteLocationId, siteId)));
    const recipients = new Set<number>();
    for (const vendorId of new Set(candidates.map(row => row.vendorId).filter((id): id is number => id != null))) {
      const ids = candidates.filter(row => row.vendorId === vendorId).map(row => row.userId);
      for (const id of await currentNotificationRecipients({ type: "vendor", id: vendorId }, ids, notice.link, true)) recipients.add(id);
    }
    if (recipients.size) await notifyUsers([...recipients], notice);
  } catch (err) {
    // A committed handoff/closure must never appear to have failed because its
    // best-effort notification failed. No provider work is held inside its locks.
    logger.warn({ err, type: notice.type, siteId }, "Gate event notification failed");
  }
}
