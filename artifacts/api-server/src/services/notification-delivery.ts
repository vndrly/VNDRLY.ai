import { and, eq, isNull, lte } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";

export type NotificationCriticality = "normal" | "shift_critical" | "safety";
export type DeliveryNotice = {
  id: number;
  userId: number;
  link: string | null;
  attempts: number;
  acknowledgementRequired: boolean;
  title?: string;
  body?: string | null;
  type?: string;
};

export interface NotificationDeliveryRepository {
  markDelivered(input: { id: number; at: Date; attempt: number }): Promise<unknown>;
  markAttemptFailed(input: { id: number; at: Date; attempt: number; nextAttemptAt: Date | null; final: boolean; detail: string; link: string | null }): Promise<unknown>;
  acknowledge(input: { id: number; userId: number; at: Date }): Promise<{ acknowledged: boolean }>;
  listDue?(at: Date, limit: number): Promise<DeliveryNotice[]>;
  listUnacknowledged?(at: Date, limit: number): Promise<Array<DeliveryNotice & { escalationId: string | null }>>;
  markEscalated?(input: { id: number; escalationId: string; at: Date }): Promise<unknown>;
}

export type NotificationSender = (notice: DeliveryNotice) => Promise<{ delivered: boolean; detail?: string }>;
export type NotificationDeliveryDependencies = {
  repository: NotificationDeliveryRepository;
  sender: NotificationSender;
  now?: () => Date;
  maximumAttempts?: number;
};

function inQuietHours(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

export function deliveryWindow(
  notice: { criticality: NotificationCriticality },
  quietHours: { startHour: number | null; endHour: number | null; localHour: number },
): { sendNow: boolean; reason: "critical" | "available" | "quiet_hours" } {
  if (notice.criticality === "safety" || notice.criticality === "shift_critical") return { sendNow: true, reason: "critical" };
  if (quietHours.startHour === null || quietHours.endHour === null || !inQuietHours(quietHours.localHour, quietHours.startHour, quietHours.endHour)) return { sendNow: true, reason: "available" };
  return { sendNow: false, reason: "quiet_hours" };
}

export function retryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt), 3_600_000);
}

export async function deliverNotification(notice: DeliveryNotice, dependencies: NotificationDeliveryDependencies) {
  const now = dependencies.now?.() ?? new Date();
  const attempt = notice.attempts + 1;
  const maximumAttempts = dependencies.maximumAttempts ?? 6;
  try {
    const result = await dependencies.sender(notice);
    if (result.delivered) {
      await dependencies.repository.markDelivered({ id: notice.id, at: now, attempt });
      return { delivered: true as const, retrying: false as const, attempt };
    }
    const final = attempt >= maximumAttempts;
    await dependencies.repository.markAttemptFailed({ id: notice.id, at: now, attempt, nextAttemptAt: final ? null : new Date(now.getTime() + retryDelayMs(attempt - 1)), final, detail: result.detail ?? "delivery_not_confirmed", link: notice.link });
    return { delivered: false as const, retrying: !final, attempt };
  } catch (error) {
    const final = attempt >= maximumAttempts;
    await dependencies.repository.markAttemptFailed({ id: notice.id, at: now, attempt, nextAttemptAt: final ? null : new Date(now.getTime() + retryDelayMs(attempt - 1)), final, detail: error instanceof Error ? error.message.slice(0, 500) : "delivery_failed", link: notice.link });
    return { delivered: false as const, retrying: !final, attempt };
  }
}

export async function acknowledgeNotification(input: { notificationId: number; userId: number }, dependencies: NotificationDeliveryDependencies) {
  return dependencies.repository.acknowledge({ id: input.notificationId, userId: input.userId, at: dependencies.now?.() ?? new Date() });
}

export async function retryDueNotifications(dependencies: NotificationDeliveryDependencies, limit = 100) {
  if (!dependencies.repository.listDue) throw new Error("notification_delivery.list_due_unavailable");
  const due = await dependencies.repository.listDue(dependencies.now?.() ?? new Date(), limit);
  const results = [];
  for (const notice of due) results.push(await deliverNotification(notice, dependencies));
  return results;
}

export async function escalateUnacknowledged(input: { at?: Date; limit?: number; escalate: (notice: DeliveryNotice) => Promise<string> }, dependencies: NotificationDeliveryDependencies) {
  if (!dependencies.repository.listUnacknowledged || !dependencies.repository.markEscalated) throw new Error("notification_delivery.escalation_unavailable");
  const at = input.at ?? dependencies.now?.() ?? new Date();
  const rows = await dependencies.repository.listUnacknowledged(at, input.limit ?? 100);
  for (const row of rows) {
    if (row.escalationId) continue;
    const escalationId = await input.escalate(row);
    await dependencies.repository.markEscalated({ id: row.id, escalationId, at });
  }
  return rows.length;
}

export const databaseNotificationDeliveryRepository: NotificationDeliveryRepository = {
  async markDelivered(input) {
    await db.update(notificationsTable).set({ deliveryStatus: "delivered", deliveryAttempts: input.attempt, deliveredAt: input.at, nextDeliveryAttemptAt: null, finalDeliveryFailureAt: null, finalDeliveryFailureReason: null }).where(eq(notificationsTable.id, input.id));
  },
  async markAttemptFailed(input) {
    await db.update(notificationsTable).set({ deliveryStatus: input.final ? "failed" : "retrying", deliveryAttempts: input.attempt, nextDeliveryAttemptAt: input.nextAttemptAt, finalDeliveryFailureAt: input.final ? input.at : null, finalDeliveryFailureReason: input.final ? input.detail : null }).where(eq(notificationsTable.id, input.id));
  },
  async acknowledge(input) {
    const [row] = await db.update(notificationsTable).set({ acknowledgedAt: input.at, acknowledgedByUserId: input.userId }).where(and(eq(notificationsTable.id, input.id), eq(notificationsTable.userId, input.userId), eq(notificationsTable.acknowledgementRequired, true), isNull(notificationsTable.acknowledgedAt))).returning({ id: notificationsTable.id });
    return { acknowledged: Boolean(row) };
  },
  async listDue(at, limit) {
    const rows = await db.select().from(notificationsTable).where(and(lte(notificationsTable.nextDeliveryAttemptAt, at), isNull(notificationsTable.deliveredAt), isNull(notificationsTable.finalDeliveryFailureAt))).limit(limit);
    return rows.map((row) => ({ id: row.id, userId: row.userId, link: row.link, attempts: row.deliveryAttempts, acknowledgementRequired: row.acknowledgementRequired, title: row.title, body: row.body, type: row.type }));
  },
  async listUnacknowledged(at, limit) {
    const rows = await db.select().from(notificationsTable).where(and(eq(notificationsTable.acknowledgementRequired, true), lte(notificationsTable.acknowledgementDueAt, at), isNull(notificationsTable.acknowledgedAt))).limit(limit);
    return rows.map((row) => ({ id: row.id, userId: row.userId, link: row.link, attempts: row.deliveryAttempts, acknowledgementRequired: row.acknowledgementRequired, escalationId: row.escalationId }));
  },
  async markEscalated(input) {
    await db.update(notificationsTable).set({ escalationId: input.escalationId, escalatedAt: input.at }).where(and(eq(notificationsTable.id, input.id), isNull(notificationsTable.escalatedAt)));
  },
};
let reliableNotificationHandle: ReturnType<typeof setInterval> | null = null;

export async function runReliableNotificationDelivery(): Promise<number> {
  const { sendPushToUser } = await import("../lib/expo-push");
  const results = await retryDueNotifications({
    repository: databaseNotificationDeliveryRepository,
    sender: async (notice) => {
      const receipt = await sendPushToUser(notice.userId, {
        title: notice.title ?? "VNDRLY update",
        body: notice.body ?? "You have a new update.",
        data: { type: notice.type ?? "system", link: notice.link, notificationId: notice.id },
      });
      return { delivered: receipt.delivered, detail: receipt.delivered ? undefined : "push_not_confirmed" };
    },
  });
  return results.length;
}

export function startReliableNotificationWorker(intervalMs = 60_000): void {
  if (reliableNotificationHandle) return;
  const run = () => {
    void runReliableNotificationDelivery().catch((error) => console.error("Reliable notification worker failed", error));
    void import("./gate-alert-repository").then(({ retryGateAlertChannels }) => retryGateAlertChannels())
      .catch(() => console.error("Gate alert channel retry worker failed"));
  };
  run();
  reliableNotificationHandle = setInterval(run, intervalMs);
  reliableNotificationHandle.unref?.();
}

export function stopReliableNotificationWorker(): void {
  if (reliableNotificationHandle) clearInterval(reliableNotificationHandle);
  reliableNotificationHandle = null;
}
