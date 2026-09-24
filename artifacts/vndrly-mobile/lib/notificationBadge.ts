import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { useEffect, useSyncExternalStore } from "react";

import { apiFetch } from "@/lib/api";
import { captureAuthScope, getCachedToken, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { isRateLimited, noteRateLimit } from "@/lib/rateLimitGate";

let snapshot = { generation: -1, count: 0 };
let pending: { generation: number; invalidated: boolean; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const generation = () => captureAuthScope().generation;
const countSnapshot = () => snapshot.generation === generation() ? snapshot.count : 0;
let pollingConsumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lifecycleEpoch = 0;
let appActive = AppState.currentState !== "background" && AppState.currentState !== "inactive";
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
const foreground = () => pollingConsumers > 0 ? appActive : AppState.currentState !== "background" && AppState.currentState !== "inactive";

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  // A parked or unmounted lifetime cannot publish a late response into a resumed one.
  lifecycleEpoch += 1;
  pending = null;
}

function startPolling() {
  if (pollTimer || !foreground()) return;
  void refreshCount(false);
  pollTimer = setInterval(() => void refreshCount(false), 30_000);
}
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
      appActive = AppState.currentState !== "background" && AppState.currentState !== "inactive";
      appStateSubscription = AppState.addEventListener("change", state => {
        const next = state === "active";
        if (next === appActive) return;
        appActive = next;
        if (next) startPolling();
        else stopPolling();
      });
      startPolling();
    }
    return () => {
      pollingConsumers -= 1;
      if (pollingConsumers === 0) {
        stopPolling();
        appStateSubscription?.remove();
        appStateSubscription = null;
      }
    };
  }, [poll, authGeneration]);
  return count;
}

/** One authoritative count shared by the bell, read/SSE refreshes and native badge. */
export async function syncAppIconBadge(): Promise<void> {
  return refreshCount(true);
}

async function refreshCount(invalidate: boolean): Promise<void> {
  const scope = captureAuthScope();
  if (!foreground() || !getCachedToken() || isRateLimited("notifications.rate_limited")) return;
  if (pending?.generation === scope.generation) {
    // Reads, read-all and events may arrive after this GET captured its snapshot.
    // Collapse a burst into one trailing GET, rather than returning a stale total.
    if (invalidate) pending.invalidated = true;
    return pending.promise;
  }
  const epoch = lifecycleEpoch;
  const valid = () => epoch === lifecycleEpoch && foreground() && isAuthScopeCurrent(scope);
  const request = { generation: scope.generation, invalidated: false, promise: Promise.resolve() };
  pending = request;
  request.promise = (async () => {
    try {
      do {
        request.invalidated = false;
        // The API sums only categories visible to this session, including preferences.
        const r = await apiFetch<{ count: number }>("/api/notifications/unread-count");
        if (!valid()) return;
        if (!request.invalidated) {
          const count = Number.isFinite(r?.count) ? Math.max(0, Math.floor(r.count)) : 0;
          snapshot = { generation: scope.generation, count };
          emit();
          if (Platform.OS !== "web") await Notifications.setBadgeCountAsync(count);
        }
      } while (request.invalidated && valid());
    } catch (error) {
      if (valid()) noteRateLimit(error, "notifications.rate_limited");
    } finally {
      if (pending === request) pending = null;
    }
  })();
  return request.promise;
}

export async function applyPushBadgeFromPayload(
  data: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (Platform.OS === "web" || !data) return;
  // Foreground push handling owns count invalidation for every page, including Home.
  // In the background the payload can still update the native badge without polling.
  if (foreground()) {
    await syncAppIconBadge();
    return;
  }
  const raw = data.badge ?? data.unreadCount;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(raw)));
    return;
  }
  await syncAppIconBadge();
}
