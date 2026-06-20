import { and, eq, gte, ne, or, sql } from "drizzle-orm";
import { ticketsTable } from "@workspace/db";

/** Partner/vendor mobile Site tickets — completed rows stay visible this long for audit/review. */
export const MOBILE_OFFICE_COMPLETED_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function cutoffDateForMobileOfficeCompleted(
  nowMs = Date.now(),
  retentionDays = MOBILE_OFFICE_COMPLETED_RETENTION_DAYS,
): Date {
  return new Date(nowMs - retentionDays * DAY_MS);
}

/**
 * Mobile office ticket list visibility (partner / vendor / admin on iOS):
 * every ticket except `completed`, plus `completed` tickets within the
 * retention window (checkout → updated → created).
 */
export function mobileOfficeTicketVisibilityCondition(
  now = new Date(),
  retentionDays = MOBILE_OFFICE_COMPLETED_RETENTION_DAYS,
) {
  const cutoff = cutoffDateForMobileOfficeCompleted(now.getTime(), retentionDays);
  return or(
    ne(ticketsTable.status, "completed"),
    and(
      eq(ticketsTable.status, "completed"),
      gte(
        sql`COALESCE(${ticketsTable.checkOutTime}, ${ticketsTable.updatedAt}, ${ticketsTable.createdAt})`,
        cutoff,
      ),
    ),
  )!;
}
