import { captureAuthScope, isAuthScopeCurrent, type StoredUser } from "./auth";
import { getNativeWorkHubQueueStore } from "./work-hub-queue-native";
import { nativeJournalScope } from "./native-operation-journal-runtime";
import { journalScopeKey } from "./native-operation-journal";
const MAX_AGE = 24 * 60 * 60_000;
function key(user: StoredUser, subject: string) {
  if (!/^[a-z0-9.-]{1,100}$/i.test(subject)) throw new Error("Invalid assigned cache subject");
  return `${journalScopeKey(nativeJournalScope(user))}.cache.${subject}`;
}
/** Only called after a successful scoped API read. Never masks denial with cached authority. */
export async function cacheAssignedRead(user: StoredUser, subject: string, value: unknown) {
  const raw = JSON.stringify({ capturedAt: Date.now(), value });
  if (raw.length > 1_000_000) return;
  await (await getNativeWorkHubQueueStore()).setItem(key(user, subject), raw);
  await (await getNativeWorkHubQueueStore()).setItem(`${key(user, subject)}.denied`, "false");
}
export async function denyAssignedCache(user: StoredUser, subject: string) {
  await (await getNativeWorkHubQueueStore()).setItem(`${key(user, subject)}.denied`, "true");
}
export async function readAssignedCache<T>(user: StoredUser, subject: string): Promise<{ capturedAt: number; value: T } | null> {
  if (await (await getNativeWorkHubQueueStore()).getItem(`${key(user, subject)}.denied`) === "true") return null;
  const raw = await (await getNativeWorkHubQueueStore()).getItem(key(user, subject));
  if (!raw || raw.length > 1_000_000) return null;
  const result = JSON.parse(raw) as { capturedAt: number; value: T };
  return Number.isFinite(result.capturedAt) && result.capturedAt <= Date.now() && Date.now() - result.capturedAt < MAX_AGE ? result : null;
}
export async function assignedReadWithOfflineFallback<T>(user: StoredUser, subject: string, fetcher: () => Promise<T>): Promise<T> {
  const scope = captureAuthScope();
  try {
    const value = await fetcher();
    if (!isAuthScopeCurrent(scope)) throw Object.assign(new Error("Account changed"), { status: 403 });
    await cacheAssignedRead(user, subject, value).catch(() => undefined); return value;
  } catch (error) {
    if (isAuthScopeCurrent(scope) && [401, 403, 404].includes((error as { status?: number }).status ?? 0)) await denyAssignedCache(user, subject).catch(() => undefined);
    if (!isAuthScopeCurrent(scope) || (error as { code?: string }).code !== "network.unreachable") throw error;
    const cached = await readAssignedCache<T>(user, subject);
    if (!cached) throw error;
    return cached.value;
  }
}
