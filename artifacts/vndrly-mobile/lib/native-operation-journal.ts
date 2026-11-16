export type JournalScope = {
  userId: number;
  membershipId: number;
  orgType: "vendor" | "partner";
  orgId: number;
};
export type JournalEntry = {
  operationId: string;
  domain: "custody" | "gate" | "note";
  capturedAt: string;
  payload: unknown;
  state: "pending" | "conflict" | "revoked" | "failed" | "synced";
  receipt?: { id: number };
  syncedAt?: string;
  attempts: number;
  resolution?: string;
};
export type JournalStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
const locks = new WeakMap<JournalStore, Map<string, Promise<unknown>>>();
const flushes = new WeakMap<JournalStore, Map<string, Promise<JournalEntry[]>>>();
export function journalScopeKey(scope: JournalScope) {
  if (
    ![scope.userId, scope.membershipId, scope.orgId].every(
      (id) => Number.isSafeInteger(id) && id > 0,
    ) ||
    !["vendor", "partner"].includes(scope.orgType)
  )
    throw new Error("Invalid offline account scope");
  return `vndrly.native.journal.${scope.userId}.${scope.membershipId}.${scope.orgType}.${scope.orgId}`;
}
export function createNativeOperationJournal(store: JournalStore) {
  async function read(scope: JournalScope): Promise<JournalEntry[]> {
    const raw = await store.getItem(journalScopeKey(scope));
    if (!raw) return [];
    if (raw.length > 10_000_000) throw new Error("Offline journal is too large");
    const parsed = JSON.parse(raw) as {
      scope: JournalScope;
      entries: JournalEntry[];
    };
    if (
      journalScopeKey(parsed.scope) !== journalScopeKey(scope) ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > 5000
    )
      throw new Error("Offline journal scope changed");
    return parsed.entries;
  }
  async function write(scope: JournalScope, entries: JournalEntry[]) {
    const raw = JSON.stringify({ scope, entries });
    if (raw.length > 10_000_000 || entries.length > 5000)
      throw new Error("Offline journal is full");
    await store.setItem(journalScopeKey(scope), raw);
  }
  async function exclusive<T>(
    scope: JournalScope,
    work: () => Promise<T>,
  ): Promise<T> {
    let scoped = locks.get(store);
    if (!scoped) {
      scoped = new Map();
      locks.set(store, scoped);
    }
    const key = journalScopeKey(scope),
      before = scoped.get(key) ?? Promise.resolve();
    const task = before.catch(() => undefined).then(work);
    scoped.set(key, task);
    try {
      return await task;
    } finally {
      if (scoped.get(key) === task) scoped.delete(key);
    }
  }
  return {
    inspect: read,
    compactClosedGateReceipts(scope: JournalScope, siteId: number, snapshotAt: number, openVisitIds: number[]) {
      return exclusive(scope, async () => {
        const entries = await read(scope), open = new Set(openVisitIds);
        const linkedPending = new Set(entries.filter(e => e.state !== "synced")
          .map(e => (e.payload as { entryOperationId?: string }).entryOperationId));
        await write(scope, entries.filter(e => e.domain !== "gate" || e.state !== "synced" ||
          (e.payload as { siteLocationId?: number }).siteLocationId !== siteId ||
          !e.receipt || !e.syncedAt || Date.parse(e.syncedAt) >= snapshotAt || open.has(e.receipt.id) || linkedPending.has(e.operationId)));
      });
    },
    enqueue(
      scope: JournalScope,
      input: Omit<JournalEntry, "state" | "attempts" | "resolution">,
    ) {
      return exclusive(scope, async () => {
        if (
          !/^[0-9a-f-]{36}$/i.test(input.operationId) ||
          !Number.isFinite(Date.parse(input.capturedAt)) ||
          !["custody", "gate", "note"].includes(input.domain)
        )
          throw new Error("Invalid offline event");
        const entries = await read(scope),
          prior = entries.find(
            (entry) => entry.operationId === input.operationId,
          );
        if (prior) {
          if (
            prior.domain !== input.domain ||
            prior.capturedAt !== input.capturedAt ||
            JSON.stringify(prior.payload) !== JSON.stringify(input.payload)
          )
            throw new Error(
              "Offline operation identity cannot be reused for changed work",
            );
          return prior;
        }
        const entry: JournalEntry = { ...input, state: "pending", attempts: 0 };
        await write(scope, [...entries, entry]);
        return entry;
      });
    },
    flush(
      scope: JournalScope,
      transport: (entry: JournalEntry) => Promise<unknown>,
      include: (entry: JournalEntry) => boolean = () => true,
      retainReceipt: (entry: JournalEntry) => boolean = () => false,
    ) {
      let scoped = flushes.get(store);
      if (!scoped) { scoped = new Map(); flushes.set(store, scoped); }
      const key = journalScopeKey(scope);
      const running = scoped.get(key);
      if (running) return running;
      const work = (async () => {
        // Snapshot the batch, but never hold the storage lock across network I/O.
        const batch = (await read(scope)).filter(e => include(e) && e.state === "pending").slice(0, 50);
        for (const entry of batch) {
          const linkedEntry = entry.domain === "gate"
            ? (entry.payload as { entryOperationId?: string })?.entryOperationId : undefined;
          if (linkedEntry && (await read(scope)).some(prior => prior.operationId === linkedEntry && prior.state !== "synced")) continue;
          let next: JournalEntry | null = null;
          let stop = false;
          try {
            const receipt = await transport(entry);
            if (retainReceipt(entry)) {
              const id = (receipt as { id?: number } | undefined)?.id;
              if (!Number.isSafeInteger(id) || Number(id) <= 0) throw new Error("Missing canonical receipt");
              next = { ...entry, state: "synced", receipt: { id: id! }, syncedAt: new Date().toISOString(), resolution: undefined };
            }
          } catch (error) {
            const status = (error as { status?: number }).status;
            next = { ...entry, attempts: entry.attempts + 1,
              state: status === 409 || status === 412 ? "conflict" : status === 401 || status === 403 ? "revoked"
                : status && status < 500 && status !== 408 && status !== 429 ? "failed" : "pending",
              resolution: status === 409 || status === 412 ? "Both reported operations are retained. Authorized reconciliation is required."
                : status === 401 || status === 403 ? "Current access was refused. This operation remains quarantined."
                : "Not canonically saved; reconnect to retry the original operation.",
            };
            stop = !status || status >= 500 || status === 408 || status === 429;
          }
          await exclusive(scope, async () => {
            const entries = await read(scope);
            const index = entries.findIndex(e => e.operationId === entry.operationId);
            if (index < 0) return;
            if (next) entries[index] = next; else entries.splice(index, 1);
            await write(scope, entries);
          });
          if (stop) break;
        }
        return read(scope);
      })();
      scoped.set(key, work);
      void work.finally(() => { if (scoped!.get(key) === work) scoped!.delete(key); }).catch(() => undefined);
      return work;
    },
  };
}
