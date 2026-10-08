export type JournalScope = { userId: number; membershipId: number; orgType: "vendor" | "partner"; orgId: number };
export type JournalEntry = { operationId: string; domain: "custody" | "gate" | "note"; capturedAt: string; payload: unknown; state: "pending" | "conflict" | "revoked" | "failed"; attempts: number; resolution?: string };
export type JournalStore = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
const locks = new WeakMap<JournalStore, Map<string, Promise<unknown>>>();
export function journalScopeKey(scope: JournalScope) {
  if (![scope.userId, scope.membershipId, scope.orgId].every(id => Number.isSafeInteger(id) && id > 0) || !["vendor", "partner"].includes(scope.orgType)) throw new Error("Invalid offline account scope");
  return `vndrly.native.journal.${scope.userId}.${scope.membershipId}.${scope.orgType}.${scope.orgId}`;
}
export function createNativeOperationJournal(store: JournalStore) {
  async function read(scope: JournalScope): Promise<JournalEntry[]> {
    const raw = await store.getItem(journalScopeKey(scope));
    if (!raw) return [];
    if (raw.length > 1_000_000) throw new Error("Offline journal is too large");
    const parsed = JSON.parse(raw) as { scope: JournalScope; entries: JournalEntry[] };
    if (journalScopeKey(parsed.scope) !== journalScopeKey(scope) || !Array.isArray(parsed.entries) || parsed.entries.length > 500) throw new Error("Offline journal scope changed");
    return parsed.entries;
  }
  async function write(scope: JournalScope, entries: JournalEntry[]) {
    const raw = JSON.stringify({ scope, entries });
    if (raw.length > 1_000_000 || entries.length > 500) throw new Error("Offline journal is full");
    await store.setItem(journalScopeKey(scope), raw);
  }
  async function exclusive<T>(scope: JournalScope, work: () => Promise<T>): Promise<T> {
    let scoped = locks.get(store); if (!scoped) { scoped = new Map(); locks.set(store, scoped); }
    const key = journalScopeKey(scope), before = scoped.get(key) ?? Promise.resolve();
    const task = before.catch(() => undefined).then(work); scoped.set(key, task);
    try { return await task; } finally { if (scoped.get(key) === task) scoped.delete(key); }
  }
  return {
    inspect: read,
    enqueue(scope: JournalScope, input: Omit<JournalEntry, "state" | "attempts" | "resolution">) {
      return exclusive(scope, async () => {
        if (!/^[0-9a-f-]{36}$/i.test(input.operationId) || !Number.isFinite(Date.parse(input.capturedAt)) || !["custody", "gate", "note"].includes(input.domain)) throw new Error("Invalid offline event");
        const entries = await read(scope), prior = entries.find(entry => entry.operationId === input.operationId);
        if (prior) {
          if (prior.domain !== input.domain || prior.capturedAt !== input.capturedAt || JSON.stringify(prior.payload) !== JSON.stringify(input.payload)) throw new Error("Offline operation identity cannot be reused for changed work");
          return prior;
        }
        const entry: JournalEntry = { ...input, state: "pending", attempts: 0 };
        await write(scope, [...entries, entry]); return entry;
      });
    },
    flush(scope: JournalScope, transport: (entry: JournalEntry) => Promise<unknown>) {
      return exclusive(scope, async () => {
        const entries = await read(scope), remaining: JournalEntry[] = [];
        for (const entry of entries) {
          if (entry.state !== "pending") { remaining.push(entry); continue; }
          const linkedEntry = entry.domain === "gate" ? (entry.payload as { entryOperationId?: string })?.entryOperationId : undefined;
          if (linkedEntry && remaining.some(prior => prior.operationId === linkedEntry)) {
            remaining.push({ ...entry, resolution: "The original entry needs reconciliation before its linked exit can synchronize." });
            continue;
          }
          try { await transport(entry); }
          catch (error) {
            const status = (error as { status?: number }).status;
            remaining.push({ ...entry, attempts: entry.attempts + 1,
              state: status === 409 || status === 412 ? "conflict" : status === 401 || status === 403 ? "revoked" : status && status < 500 ? "failed" : "pending",
              resolution: status === 409 || status === 412 ? "Both reported operations are retained. Authorized reconciliation is required." : status === 401 || status === 403 ? "Current access was refused. This operation remains quarantined." : "Not canonically saved; reconnect to retry the original operation.",
            });
            // Loss of connectivity preserves remaining order (especially gate entry before exit).
            if (!status || status >= 500) { remaining.push(...entries.slice(entries.indexOf(entry) + 1)); break; }
          }
        }
        await write(scope, remaining); return remaining;
      });
    },
  };
}
