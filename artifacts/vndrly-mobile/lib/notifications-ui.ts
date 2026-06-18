import type { Feather } from "@expo/vector-icons";
import type React from "react";

export type NotificationRow = {
  id: number;
  type: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export const NOTIFICATION_CATEGORY_LABEL_KEYS: Record<string, string> = {
  ticket: "notifications.rows.tickets",
  tickets: "notifications.rows.tickets",
  hotlist: "notifications.rows.hotlist",
  compliance: "notifications.rows.compliance",
  crew: "notifications.rows.crew",
  system: "notifications.rows.system",
  comment: "notifications.rows.comments",
  comments: "notifications.rows.comments",
};

export const NOTIFICATION_TYPE_META: Record<string, { icon: FeatherName; labelKey: string }> = {
  ticket_assigned: { icon: "briefcase", labelKey: "notifications.types.ticket_assigned" },
  ticket_note_added: { icon: "file-text", labelKey: "notifications.types.ticket_note_added" },
  ticket_forwarded: { icon: "send", labelKey: "notifications.types.ticket_forwarded" },
  crew_added: { icon: "user-plus", labelKey: "notifications.types.crew_added" },
  schedule_changed: { icon: "clock", labelKey: "notifications.types.schedule_changed" },
  crew_removed: { icon: "user-minus", labelKey: "notifications.types.crew_removed" },
  hotlist_match: { icon: "zap", labelKey: "notifications.types.hotlist_match" },
  bid_outbid: { icon: "trending-down", labelKey: "notifications.types.bid_outbid" },
  job_awarded: { icon: "award", labelKey: "notifications.types.job_awarded" },
  cert_expiring: { icon: "calendar", labelKey: "notifications.types.cert_expiring" },
  cert_expired: { icon: "alert-octagon", labelKey: "notifications.types.cert_expired" },
  long_checkin: { icon: "clock", labelKey: "notifications.types.long_checkin" },
  rating_received: { icon: "star", labelKey: "notifications.types.rating_received" },
  comment_added: { icon: "message-square", labelKey: "notifications.types.comment_added" },
  comment_mention: { icon: "at-sign", labelKey: "notifications.types.comment_mention" },
};

export function notificationTypeLabel(
  item: NotificationRow,
  t: (key: string) => string,
): string {
  const meta = NOTIFICATION_TYPE_META[item.type];
  const categoryKey = NOTIFICATION_CATEGORY_LABEL_KEYS[item.category];
  if (meta) return t(meta.labelKey);
  if (categoryKey) return t(categoryKey);
  return item.category.toUpperCase();
}
