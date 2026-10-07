import type { Href } from "expo-router";
import { apiFetch } from "./api";
import { captureAuthScope, isAuthScopeCurrent } from "./auth";
import { notificationIdFromPushData } from "./pushDeepLinks";
import { parseNotificationTarget } from "./notification-destination";
import { openNotificationDestination } from "./notification-deep-links";

export const RECORD_NOTIFICATION_CATEGORY = "vndrly_record";
export const MEETING_NOTIFICATION_CATEGORY = "vndrly_meeting";
export const NOTIFICATION_ACTIONS = { open: "vndrly_open", read: "vndrly_mark_read", meeting: "vndrly_review_meeting" } as const;
export const notificationCategoryDefinitions = [
  { identifier: RECORD_NOTIFICATION_CATEGORY, actions: [
    { identifier: NOTIFICATION_ACTIONS.open, buttonTitle: "Open / Abrir", options: { opensAppToForeground: true } },
    { identifier: NOTIFICATION_ACTIONS.read, buttonTitle: "Mark read / Marcar leído", options: { opensAppToForeground: true } },
  ] },
  { identifier: MEETING_NOTIFICATION_CATEGORY, actions: [
    { identifier: NOTIFICATION_ACTIONS.meeting, buttonTitle: "Review response / Revisar respuesta", options: { opensAppToForeground: true } },
    { identifier: NOTIFICATION_ACTIONS.read, buttonTitle: "Mark read / Marcar leído", options: { opensAppToForeground: true } },
  ] },
];
const pending = new Map<string, Promise<"handled" | "unavailable">>();
const completed = new Set<string>();

/** Identifiers are pointers only. Canonical resolution rechecks the current recipient and record. */
export async function handleNotificationAction(action: string, data: unknown, router: { push(href: Href): void | Promise<void> }): Promise<"handled" | "unavailable"> {
  if (!Object.values(NOTIFICATION_ACTIONS).some(value => value === action)) return "unavailable";
  const id = notificationIdFromPushData(data);
  if (!id) return "unavailable";
  const scope = captureAuthScope();
  const key = `${scope.generation}:${id}:${action}`;
  if (completed.has(key)) return "handled";
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = (async (): Promise<"handled" | "unavailable"> => {
    try {
      const resolved = await apiFetch<{ href: unknown }>(`/api/notifications/${id}/resolve`, { method: "POST" }, scope);
      const target = parseNotificationTarget(resolved.href);
      if (!target || !isAuthScopeCurrent(scope) || (action === NOTIFICATION_ACTIONS.meeting && target.kind !== "meeting")) return "unavailable";
      if (action === NOTIFICATION_ACTIONS.read) {
        // Setting read is intrinsically idempotent for this exact owned notification.
        await apiFetch(`/api/notifications/${id}/read`, { method: "POST" }, scope);
        if (!isAuthScopeCurrent(scope)) return "unavailable";
      } else if (action === NOTIFICATION_ACTIONS.meeting && target.kind === "meeting") {
        const detail = await apiFetch<{ item: { occurrence?: { id?: string } } }>(`/api/work-hub/calendar/items/meeting/${target.id}`, {}, scope);
        if (detail?.item?.occurrence?.id !== target.id || !isAuthScopeCurrent(scope)) return "unavailable";
        await router.push({ pathname: "/work-hub/meeting/[occurrenceId]", params: { occurrenceId: target.id } } as Href);
        if (!isAuthScopeCurrent(scope)) return "unavailable";
      } else {
        const result = await openNotificationDestination({ id, type: "", category: "", title: "", body: null, link: null, isRead: false, createdAt: "" }, router, target.kind);
        if (result !== "opened" || !isAuthScopeCurrent(scope)) return "unavailable";
      }
      completed.add(key);
      if (completed.size > 128) completed.delete(completed.values().next().value!);
      return "handled";
    } catch { return "unavailable"; }
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
