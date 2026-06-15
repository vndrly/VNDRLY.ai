import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api";

/** Sync the iOS/Android home-screen badge with server unread count. */
export async function syncAppIconBadge(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const r = await apiFetch<{ count: number }>("/api/notifications/unread-count");
    const count = Math.max(0, Math.floor(r?.count ?? 0));
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Silent — badge is best-effort.
  }
}

export async function applyPushBadgeFromPayload(
  data: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (Platform.OS === "web" || !data) return;
  const raw = data.badge ?? data.unreadCount;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(raw)));
    return;
  }
  await syncAppIconBadge();
}
