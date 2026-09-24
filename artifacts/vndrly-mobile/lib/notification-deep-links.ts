import type { Href } from "expo-router";
import { apiFetch } from "./api";
import type { NotificationRow } from "./notifications-ui";
import {
  parseNotificationTarget,
  type NotificationTarget,
} from "./notification-destination";
import { captureAuthScope, isAuthScopeCurrent, type AuthScope } from "./auth";

type NotificationRouter = { push: (href: Href) => void | Promise<void> };

type OpenResult = "opened" | "unavailable";
type OpenRequest = {
  notificationId: number;
  href: string;
  target: NotificationTarget;
  scope: AuthScope;
  finish: (result: OpenResult) => void;
  timer: ReturnType<typeof setTimeout>;
  completion: Promise<OpenResult>;
  confirmation?: Promise<OpenResult>;
};
const requests = new Map<string, OpenRequest>();
let sequence = 0;

export function getNotificationOpenRequest(requestId: string) {
  const request = requests.get(requestId);
  if (request && !isAuthScopeCurrent(request.scope)) {
    cancelNotificationOpen(requestId);
    return undefined;
  }
  return request;
}
export function cancelNotificationOpen(requestId: string) {
  const request = requests.get(requestId);
  if (!request) return;
  clearTimeout(request.timer);
  requests.delete(requestId);
  request.finish("unavailable");
}

/** Called by the destination's effect only after its exact record has rendered. */
export function confirmNotificationRendered(
  requestId: string,
): Promise<OpenResult> {
  const request = getNotificationOpenRequest(requestId);
  if (!request) return Promise.resolve("unavailable");
  if (request.confirmation) return request.confirmation;
  request.confirmation = (async () => {
    try {
      // Recheck after loading, before writing read state (membership may have changed).
      const resolved = await apiFetch<{ href: string }>(
        `/api/notifications/${request.notificationId}/resolve`,
        { method: "POST" },
      );
      if (
        getNotificationOpenRequest(requestId) !== request ||
        resolved.href !== request.href
      )
        throw new Error("notification.unavailable");
      clearTimeout(request.timer);
      await apiFetch(`/api/notifications/${request.notificationId}/read`, {
        method: "POST",
      });
      requests.delete(requestId);
      request.finish("opened");
      return "opened";
    } catch {
      cancelNotificationOpen(requestId);
      return "unavailable";
    }
  })();
  return request.confirmation;
}

/** The saved link is only a pointer; use the server's freshly authorized href. */
export async function resolveNotificationHref(
  row: NotificationRow,
): Promise<string | null> {
  try {
    const result = await apiFetch<{ href: unknown }>(
      `/api/notifications/${row.id}/resolve`,
      { method: "POST" },
    );
    return typeof result?.href === "string" &&
      parseNotificationTarget(result.href)
      ? result.href
      : null;
  } catch {
    return null;
  }
}

export async function openNotificationDestination(
  row: NotificationRow,
  router: NotificationRouter,
): Promise<"opened" | "unavailable"> {
  const scope = captureAuthScope();
  const href = await resolveNotificationHref(row);
  if (!href || !isAuthScopeCurrent(scope)) return "unavailable";
  const target = parseNotificationTarget(href)!;
  const requestId = `${Date.now()}-${++sequence}`;
  let finish!: (result: OpenResult) => void;
  const result = new Promise<OpenResult>((resolve) => {
    finish = resolve;
  });
  const timer = setTimeout(() => cancelNotificationOpen(requestId), 30_000);
  requests.set(requestId, {
    notificationId: row.id,
    href,
    target,
    scope,
    finish,
    timer,
    completion: result,
  });
  try {
    await router.push(`/work-hub/notification?requestId=${requestId}` as Href);
  } catch {
    cancelNotificationOpen(requestId);
  }
  return result;
}
