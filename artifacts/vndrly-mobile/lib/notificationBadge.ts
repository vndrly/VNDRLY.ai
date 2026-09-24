import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { useEffect, useSyncExternalStore } from "react";

import { apiFetch } from "@/lib/api";
import { captureAuthScope, getCachedToken, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { isRateLimited, noteRateLimit } from "@/lib/rateLimitGate";

let snapshot = { generation: -1, count: 0 };
let pending: { generation: number; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const generation = () => captureAuthScope().generation;
const countSnapshot = () => snapshot.generation === generation() ? snapshot.count : 0;
let pollingConsumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  const token = subscribeToken(listener);
  const user = subscribeUser(listener);
  return () => { listeners.delete(listener); token(); user(); };
}

/** One polling lifetime shared by the shell and headers, including pages outside tabs. */
export function useUnreadNotificationCount(poll = false): number {
  const authGeneration = useSyncExternalStore(subscribe, generation, generation);
  const count = useSyncExternalStore(subscribe, countSnapshot, countSnapshot);
  useEffect(() => {
    if (!poll || !getCachedToken()) return;
    pollingConsumers += 1;
    if (pollingConsumers === 1) {
      void syncAppIconBadge();
      pollTimer = setInterval(() => void syncAppIconBadge(), 30_000);
    }
    return () => {
      pollingConsumers -= 1;
      if (pollingConsumers === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, [poll, authGeneration]);
  return count;
}

/** One authoritative count shared by the bell, read/SSE refreshes and native badge. */
export async function syncAppIconBadge(): Promise<void> {
  const scope = captureAuthScope();
  if (!getCachedToken() || isRateLimited("notifications.rate_limited")) return;
  if (pending?.generation === scope.generation) return pending.promise;
  const promise = (async () => {
    try {
      // The API already sums only categories visible to this session (including preferences).
      const r = await apiFetch<{ count: number }>("/api/notifications/unread-count");
      if (!isAuthScopeCurrent(scope)) return;
      const count = Number.isFinite(r?.count) ? Math.max(0, Math.floor(r.count)) : 0;
      snapshot = { generation: scope.generation, count };
      emit();
      if (Platform.OS !== "web") await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      if (isAuthScopeCurrent(scope)) noteRateLimit(error, "notifications.rate_limited");
    } finally {
      if (pending?.generation === scope.generation) pending = null;
    }
  })();
  pending = { generation: scope.generation, promise };
  return promise;
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
