import { db, fieldPushTokensTable, vendorPeopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Must match `PUSH_NOTIFICATION_SOUND` in vndrly-mobile/lib/notificationSounds.ts */
export const VNDRLY_PUSH_NOTIFICATION_SOUND = "vndrly_bell_ring.wav";

/** iOS interruption levels for crew/schedule/ticket alerts (Focus-aware). */
export const TIME_SENSITIVE_PUSH_TYPES = new Set([
  "crew_added",
  "schedule_changed",
  "ticket_assigned",
  "ticket_scheduled",
  "ticket_kicked_back",
  "crew_removed",
  "ticket_unblocked",
  "ticket_warning",
  "late_check_in_nudge",
  "workflow_nudge",
  "ticket_flagged",
  "direct_assignment_offered",
  "direct_assignment_committed",
  "direct_assignment_passed",
  "comment_mention",
  "ticket_note_added",
  "ticket_inactive",
]);

export type ExpoPushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  priority?: "default" | "normal" | "high";
  interruptionLevel?: "active" | "critical" | "passive" | "time-sensitive";
};

function resolvePushType(msg: ExpoPushMessage): string | undefined {
  const t = msg.data?.type;
  return typeof t === "string" ? t : undefined;
}

function resolveInterruptionLevel(msg: ExpoPushMessage): ExpoPushMessage["interruptionLevel"] {
  if (msg.interruptionLevel) return msg.interruptionLevel;
  const type = resolvePushType(msg);
  return type && TIME_SENSITIVE_PUSH_TYPES.has(type) ? "time-sensitive" : "active";
}

async function sendExpoPushBatch(tokens: string[], msg: ExpoPushMessage) {
  if (tokens.length === 0) return;
  const interruptionLevel = resolveInterruptionLevel(msg);
  const type = resolvePushType(msg);
  const messages = tokens.map((to) => ({
    to,
    sound: VNDRLY_PUSH_NOTIFICATION_SOUND,
    title: msg.title,
    body: msg.body,
    data: msg.data ?? {},
    priority: msg.priority ?? (type && TIME_SENSITIVE_PUSH_TYPES.has(type) ? "high" : "default"),
    interruptionLevel,
    ...(msg.badge != null && Number.isFinite(msg.badge)
      ? { badge: Math.max(0, Math.floor(msg.badge)) }
      : {}),
  }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, body: await res.text().catch(() => "") },
        "Expo push send failed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Expo push send threw");
  }
}

export async function sendPushToUser(userId: number, msg: ExpoPushMessage) {
  const rows = await db
    .select({ token: fieldPushTokensTable.expoToken })
    .from(fieldPushTokensTable)
    .where(eq(fieldPushTokensTable.userId, userId));
  await sendExpoPushBatch(rows.map((r) => r.token), msg);
}

/**
 * @deprecated Route through `notifyFieldEmployee` / `notifyUsers` so prefs,
 * inbox rows, and badge counts stay consistent.
 */
export async function sendPushToFieldEmployee(
  fieldEmployeeId: number,
  msg: ExpoPushMessage,
) {
  const { notifyFieldEmployeeFromLegacyPush } = await import("./push-fanout");
  await notifyFieldEmployeeFromLegacyPush(fieldEmployeeId, msg);
}
