import { apiFetch } from "./api";
import { captureAuthScope, isAuthScopeCurrent, type StoredUser } from "./auth";
import { getNativeWorkHubQueueStore } from "./work-hub-queue-native";
import { createNativeOperationJournal, journalScopeKey } from "./native-operation-journal";
import { nativeJournalScope, synchronizeNativeJournal } from "./native-operation-journal-runtime";
import { parseOfflineGateSnapshot, type OfflineGateSnapshot, type OfflineGateVisit } from "./gate-offline";

function key(user: StoredUser) { return `${journalScopeKey(nativeJournalScope(user))}.gate-outage-context`; }
export async function readOfflineGate(user: StoredUser): Promise<OfflineGateSnapshot | null> {
  const raw = await (await getNativeWorkHubQueueStore()).getItem(key(user));
  if (!raw) return null;
  if (raw.length > 5_000_000) throw new Error("Gate cache exceeds capacity");
  return parseOfflineGateSnapshot(JSON.parse(raw));
}
export async function saveOfflineGate(user: StoredUser, raw: unknown) {
  const snapshot = parseOfflineGateSnapshot(raw);
  if (!snapshot) throw new Error("Invalid gate context");
  const store = await getNativeWorkHubQueueStore();
  const previous = await readOfflineGate(user);
  if (previous?.stationId === snapshot.stationId && previous.capturedAt > snapshot.capturedAt) return;
  await store.setItem(key(user), JSON.stringify(snapshot));
}
/** Probe actual authenticated visits, not navigator.onLine or a public health page. */
export async function refreshOfflineGate(user: StoredUser, snapshot: OfflineGateSnapshot) {
  const scope = captureAuthScope();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const capturedAt = Date.now();
    const visits: OfflineGateVisit[] = [];
    for (let offset = 0; ; offset += 1000) {
      const rows = await apiFetch<OfflineGateVisit[]>(`/api/visits?activeOnly=true&siteLocationId=${snapshot.siteId}&limit=1000&offset=${offset}`, { signal: controller.signal }, scope);
      visits.push(...rows);
      if (visits.length > 5000) throw new Error("Gate cache exceeds capacity");
      if (rows.length < 1000) break;
    }
    if (!isAuthScopeCurrent(scope)) return;
    // Do not replace a gate selected in the meantime with an older request's context.
    const current = await readOfflineGate(user);
    if (current?.siteId !== snapshot.siteId || current.stationId !== snapshot.stationId) return;
    await saveOfflineGate(user, { ...snapshot, capturedAt, visits, complete: true });
    await createNativeOperationJournal(await getNativeWorkHubQueueStore())
      .compactClosedGateReceipts(nativeJournalScope(user), snapshot.siteId, capturedAt, visits.filter(v => !v.checkOutTime).map(v => v.id));
    await synchronizeNativeJournal(user);
  } finally { clearTimeout(timer); }
}
