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
  if (tokens.length === 0) return false;
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
      return false;
    }
    const payload = await res.json().catch(() => null) as { data?: Array<{ status?: string }> } | null;
    return Array.isArray(payload?.data) && payload.data.length === messages.length && payload.data.every((ticket) => ticket.status === "ok");
  } catch (err) {
    logger.warn({ err }, "Expo push send threw");
    return false;
  }
}

/** One destination per request: an ambiguous response must never retry an accepted sibling. */
export async function sendExpoPushDestination(token: string, msg: ExpoPushMessage): Promise<{
  status: "accepted" | "retryable" | "failed" | "unknown"; providerMessageId?: string; errorCode?: string;
}> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify([{ to: token, sound: VNDRLY_PUSH_NOTIFICATION_SOUND, ...msg,
        interruptionLevel: resolveInterruptionLevel(msg) }]),
    });
    if (!res.ok) return { status: res.status === 429 ? "retryable" : res.status >= 400 && res.status < 500 && res.status !== 408 ? "failed" : "unknown", errorCode: String(res.status) };
    const payload = await res.json() as { data?: Array<{ status?: string; id?: string; details?: { error?: string } }> } | null;
    const ticket = Array.isArray(payload?.data) && payload.data.length === 1 ? payload.data[0] : null;
    if (ticket?.status === "ok") return { status: "accepted", providerMessageId: typeof ticket.id === "string" ? ticket.id : undefined };
    const code = ticket?.details?.error;
    if (ticket?.status === "error" && code === "MessageRateExceeded") return { status: "retryable", errorCode: code };
    if (ticket?.status === "error" && code && ["DeviceNotRegistered", "MessageTooBig", "MismatchSenderId", "InvalidCredentials"].includes(code)) return { status: "failed", errorCode: code };
    return { status: "unknown", errorCode: "invalid_response" };
  } catch { return { status: "unknown", errorCode: "provider_exception" }; }
}

export async function sendPushToUser(userId: number, msg: ExpoPushMessage) {
  const rows = await db
    .select({ token: fieldPushTokensTable.expoToken })
    .from(fieldPushTokensTable)
    .where(eq(fieldPushTokensTable.userId, userId));
  const delivered = await sendExpoPushBatch(rows.map((r) => r.token), msg);
  return { delivered, recipientCount: rows.length };
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
