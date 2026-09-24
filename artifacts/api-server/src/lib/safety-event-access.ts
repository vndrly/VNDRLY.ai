import { pool } from "@workspace/db";
import type { SessionPayload } from "./session";
import { isGateNotificationSession } from "./gate-notification-policy";

type SafetyEventSubject = {
  siteLocationId: number;
  vendorId: number | null;
  partnerId: number;
  reportedByUserId: number | null;
};

/** Revalidate the exact safety subject; the notification itself grants nothing. */
export async function sessionCanReadSafetyEvent(
  session: SessionPayload,
  event: SafetyEventSubject,
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role === "vendor" && !!session.vendorId && !session.partnerId && event.vendorId === session.vendorId) return true;
  if (session.role === "partner" && !!session.partnerId && !session.vendorId && event.partnerId === session.partnerId) return true;
  if (session.role === "field_employee" && event.reportedByUserId === session.userId) return true;
  if (!isGateNotificationSession(session)) return false;
  try {
    // Stop-work deactivates the site before this alert is read. Preserve the
    // current grant check while allowing that exact inactive site subject.
    const { requireChangeOverAccess } = await import("../services/gate-change-over");
    await requireChangeOverAccess(pool, session, event.siteLocationId, { allowInactiveSite: true });
    return true;
  } catch {
    return false;
  }
}
