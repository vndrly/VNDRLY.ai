import { parseTicketIdFromHref } from "@/lib/assistant-deep-links";

export type PushRoute =
  | { type: "route"; path: string }
  | { type: "none" };

/** Resolve navigation target from an APNs/Expo push `data` payload. */
export function routeForPushData(data: unknown): PushRoute {
  if (!data || typeof data !== "object") return { type: "none" };
  const d = data as Record<string, unknown>;

  if (d.type === "crew_removed") {
    return { type: "route", path: "/(tabs)" };
  }

  const ticketFromId =
    typeof d.ticketId === "number"
      ? d.ticketId
      : typeof d.ticketId === "string"
        ? Number(d.ticketId)
        : null;
  if (ticketFromId != null && Number.isFinite(ticketFromId) && ticketFromId > 0) {
    return { type: "route", path: `/ticket/${ticketFromId}` };
  }

  if (typeof d.link === "string") {
    const ticketId = parseTicketIdFromHref(d.link);
    if (ticketId != null) {
      return { type: "route", path: `/ticket/${ticketId}` };
    }
    if (d.link.startsWith("/notifications")) {
      return { type: "route", path: "/notifications" };
    }
  }

  // Crew / schedule / ticket alerts without a ticket id still belong in inbox.
  const inboxTypes = new Set([
    "crew_added",
    "schedule_changed",
    "ticket_scheduled",
    "ticket_assigned",
    "ticket_note_added",
    "ticket_inactive",
    "comment_mention",
    "comment_added",
  ]);
  const pushType = typeof d.type === "string" ? d.type : "";
  if (inboxTypes.has(pushType)) {
    return { type: "route", path: "/notifications" };
  }

  return { type: "none" };
}

export function notificationIdFromPushData(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).notificationId;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
