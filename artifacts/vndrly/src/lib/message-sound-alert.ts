import type { NotificationCreatedBrowserDetail } from "./notifications-api";

const MAX_AGE_MS = 120_000;
type SoundStorage = Pick<Storage, "getItem" | "setItem">;
type Lock = (name: string, work: () => Promise<boolean>) => Promise<boolean>;

/** One sound per recipient/device/message, including concurrent tabs and SSE retries. */
export function createMessageSoundAlert(input: {
  userId: number;
  enabled: () => boolean;
  play: () => Promise<boolean>;
  storage?: SoundStorage;
  lock?: Lock;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const key = `vndrly:message-sound-seen:${input.userId}`;
  let seen: Record<string, number> = {};
  let pending = Promise.resolve(false);
  const work = async (event: NotificationCreatedBrowserDetail): Promise<boolean> => {
    const time = now();
    const created = Date.parse(event.createdAt ?? "");
    if (event.type !== "notification.created" || event.userId !== input.userId
      || event.audible !== true || !input.enabled()
      || !["work_hub_message", "work_hub_mention"].includes(event.notifType ?? "")
      || !Number.isSafeInteger(event.notificationId) || event.notificationId! <= 0
      || !Number.isFinite(created) || time - created > MAX_AGE_MS || created - time > 30_000) return false;
    try {
      if (input.storage) {
        const saved = JSON.parse(input.storage.getItem(key) ?? "{}");
        if (saved && typeof saved === "object" && !Array.isArray(saved)) seen = { ...seen, ...saved };
      }
    } catch { /* Storage blocked: retain this tab's deduplication. */ }
    seen = Object.fromEntries(Object.entries(seen).filter(([, value]) => typeof value === "number" && value > time - MAX_AGE_MS));
    const id = String(event.notificationId);
    if (seen[id]) return false;
    // Blocked audio is not successful playback; do not consume the alert.
    if (!(await input.play())) return false;
    seen[id] = time;
    try { input.storage?.setItem(key, JSON.stringify(seen)); } catch { /* Per-tab fallback. */ }
    return true;
  };
  return (event: NotificationCreatedBrowserDetail): Promise<boolean> => {
    const run = () => input.lock ? input.lock(key, () => work(event)) : work(event);
    pending = pending.then(run, run).catch(() => false);
    return pending;
  };
}
