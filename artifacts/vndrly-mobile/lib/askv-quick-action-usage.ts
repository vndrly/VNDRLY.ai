import AsyncStorage from "@react-native-async-storage/async-storage";

import type { QuickAction } from "@/lib/assistant-quick-actions";

export type QuickActionUsage = Record<string, number>;

function storageKey(userId: number, membershipId: number | null) {
  return `askv:quick-action-usage:${userId}:${membershipId ?? "none"}`;
}

export async function readQuickActionUsage(userId: number, membershipId: number | null) {
  const raw = await AsyncStorage.getItem(storageKey(userId, membershipId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as QuickActionUsage;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, count]) => Number.isFinite(count) && count > 0),
    );
  } catch {
    return {};
  }
}

export async function recordQuickActionUsage(
  userId: number,
  membershipId: number | null,
  labelKey: string,
) {
  const usage = await readQuickActionUsage(userId, membershipId);
  usage[labelKey] = (usage[labelKey] ?? 0) + 1;
  await AsyncStorage.setItem(storageKey(userId, membershipId), JSON.stringify(usage));
  return usage;
}

export function rankQuickActions(actions: QuickAction[], usage: QuickActionUsage) {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => (usage[b.action.labelKey] ?? 0) - (usage[a.action.labelKey] ?? 0) || a.index - b.index)
    .map(({ action }) => action);
}
