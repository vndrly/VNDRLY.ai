import { router } from "expo-router";

import { parseTicketIdFromHref } from "@/lib/assistant-deep-links";

/** Dismiss the notifications modal (if present) before pushing ticket detail. */
export function navigateToTicketFromNotification(ticketId: number): void {
  if (router.canDismiss()) {
    router.dismiss();
  }
  queueMicrotask(() => {
    router.push(`/ticket/${ticketId}`);
  });
}

/** Route from a persisted notification `link` column. */
export function navigateFromNotificationLink(link: string | null): void {
  const ticketId = parseTicketIdFromHref(link ?? "");
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
