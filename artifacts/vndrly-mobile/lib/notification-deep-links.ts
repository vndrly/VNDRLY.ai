import type { Href } from "expo-router";
import { apiFetch } from "./api";
import type { NotificationRow } from "./notifications-ui";

type NotificationRouter = { push: (href: Href) => void | Promise<void> };

function isSupportedInternalHref(href: unknown): href is string {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return false;
  try {
    const decoded = decodeURIComponent(href);
    if (decoded.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(decoded)) return false;
    if (decoded.split(/[/?#]/).some((part) => part === "." || part === "..")) return false;
    const url = new URL(href, "https://notification.invalid");
    if (url.origin !== "https://notification.invalid" || url.hash) return false;
    const path = url.pathname.replace(/^\/\(tabs\)(?=\/)/, "");
    return /^\/(work-hub(?:\/(?:channels|tasks|meetings)\/[0-9a-f-]+|\/calendar|\/tasks)?|shift-notes|gate|gate-change-over|profile)$/.test(path);
  } catch {
    return false;
  }
}

/** The saved link is only a pointer; use the server's freshly authorized href. */
export async function resolveNotificationHref(row: NotificationRow): Promise<string | null> {
  try {
    const result = await apiFetch<{ href: unknown }>(`/api/notifications/${row.id}/resolve`, { method: "POST" });
    return isSupportedInternalHref(result?.href) ? result.href : null;
  } catch {
    return null;
  }
}

export async function openNotificationDestination(
  row: NotificationRow,
  router: NotificationRouter,
): Promise<"opened" | "unavailable"> {
  const href = await resolveNotificationHref(row);
  if (!href) return "unavailable";
  try {
    await router.push(href as Href);
  } catch {
    return "unavailable";
  }
  // Let the caller surface a read failure without falsely updating local state.
  await apiFetch(`/api/notifications/${row.id}/read`, { method: "POST" });
  return "opened";
}
