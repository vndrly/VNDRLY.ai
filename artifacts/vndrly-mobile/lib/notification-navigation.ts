import { router } from "expo-router";

import {
  parseSafetyEventIdFromHref,
  parseTicketIdFromNotificationLink,
} from "@/lib/notification-link";

export {
  parseSafetyEventIdFromHref,
  parseSiteLocationFromHref,
  parseTicketIdFromNotificationLink,
  stripLinkQuery,
} from "@/lib/notification-link";

/** Dismiss the notifications modal (if present) before pushing ticket detail. */
export function navigateToTicketFromNotification(ticketId: number): void {
  if (router.canDismiss()) {
    router.dismiss();
  }
  queueMicrotask(() => {
    router.push(`/ticket/${ticketId}`);
  });
}

export function navigateToSafetyEventFromNotification(eventId: number): void {
  if (router.canDismiss()) {
    router.dismiss();
  }
  queueMicrotask(() => {
    router.push({ pathname: "/safety-event/[id]", params: { id: String(eventId) } });
  });
}

/** Route from a persisted notification `link` column. */
export function navigateFromNotificationLink(link: string | null): void {
  const safetyId = parseSafetyEventIdFromHref(link ?? "");
  if (safetyId !== null) {
    navigateToSafetyEventFromNotification(safetyId);
    return;
  }

  const ticketId = parseTicketIdFromNotificationLink(link ?? "");
  if (ticketId !== null) {
    navigateToTicketFromNotification(ticketId);
    return;
  }

  if (link === "/tickets") {
    if (router.canDismiss()) {
      router.dismiss();
    }
    queueMicrotask(() => {
      router.push("/(tabs)");
    });
  }
}
