import type { NotificationRow } from "@/lib/notifications-api";

export const NOTIFICATION_CATEGORY_IDS = [
  "all",
  "tickets",
  "hotlist",
  "compliance",
  "crew",
  "comments",
  "visitor",
  "system",
  "safety",
] as const;

const SAFETY_NOTIFICATION_TYPES = new Set([
  "safety_event_submitted",
  "safety_stop_work",
  "safety_event_hipo",
  "safety_event_update",
  "safety_event_closed",
]);

export function effectiveNotificationCategory(notification: NotificationRow): string {
  if (SAFETY_NOTIFICATION_TYPES.has(notification.type) || notification.category === "safety") {
    return "safety";
  }
  return notification.category ?? "system";
}
