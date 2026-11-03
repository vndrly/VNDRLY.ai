type Entry = { value?: unknown; updatedAt: number; pending?: Promise<unknown> };
const entries = new Map<string, Entry>();
const FRESH_MS = 15_000;
const MAX_AGE_MS = 60_000;

/** Presentation-only summaries; callers must authorize before reading. */
export async function cachedTrainingProgress<T>(key: string, load: () => Promise<T>): Promise<T> {
  let entry = entries.get(key);
  if (!entry) {
    if (entries.size >= 200) entries.delete(entries.keys().next().value!);
    entry = { updatedAt: 0 };
    entries.set(key, entry);
  }
  const age = Date.now() - entry.updatedAt;
  if (entry.value !== undefined && age < FRESH_MS) return entry.value as T;
  if (!entry.pending) {
    const current = entry;
    current.pending = Promise.resolve().then(load).then(value => {
      if (entries.get(key) === current) {
        current.value = value;
        current.updatedAt = Date.now();
      }
      return value;
    }).finally(() => { current.pending = undefined; });
  }
  if (entry.value !== undefined && age < MAX_AGE_MS) {
    void entry.pending!.catch(() => {});
    return entry.value as T;
  }
  return entry.pending as Promise<T>;
}

export function invalidateTrainingProgress(ownerKey: string) {
  for (const key of entries.keys()) if (key.startsWith(`${ownerKey}:`)) entries.delete(key);
}
