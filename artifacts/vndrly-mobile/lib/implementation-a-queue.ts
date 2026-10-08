export type ImplementationADomain = "gate" | "custody" | "schedule" | "task" | "incident";

export type ImplementationAScope = {
  userId: number;
  ownerOrgType: "vendor" | "partner" | "admin";
  ownerOrgId: number;
  deviceId: string;
};

export type ImplementationAQueueItem = {
  operationId: string;
  domain: ImplementationADomain;
  domainVersion: number;
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  payload: unknown;
  originalEventAt: string;
  authScope: ImplementationAScope;
  deviceId: string;
  state: "pending" | "conflict" | "revoked" | "failed";
  attempts: number;
  visibleResolution?: string;
};

type QueueDocument = { version: 1; scope: ImplementationAScope; items: ImplementationAQueueItem[] };
export type ImplementationAQueueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
type QueueInput = Omit<ImplementationAQueueItem, "authScope" | "deviceId" | "state" | "attempts">;
type QueueTransport = (item: ImplementationAQueueItem) => Promise<unknown>;
const KEY = "implementation-a-offline-queue-v1";
const partitionKey = (scope: ImplementationAScope) => `${KEY}.${scope.userId}.${scope.ownerOrgType}.${scope.ownerOrgId}.${encodeURIComponent(scope.deviceId)}`;
const storeLocks = new WeakMap<ImplementationAQueueStore, Promise<unknown>>();
function exclusive<T>(store: ImplementationAQueueStore, work: () => Promise<T>): Promise<T> {
  const result = (storeLocks.get(store) ?? Promise.resolve()).catch(() => undefined).then(work);
  storeLocks.set(store, result); return result;
}

const sameScope = (left: ImplementationAScope, right: ImplementationAScope) =>
  left.userId === right.userId && left.ownerOrgType === right.ownerOrgType &&
  left.ownerOrgId === right.ownerOrgId && left.deviceId === right.deviceId;

export function createImplementationAQueue(store: ImplementationAQueueStore) {
  async function read(scope: ImplementationAScope): Promise<QueueDocument> {
    // Preserve the legacy document in its own partition before any scope switch.
    // The marker prevents an already replayed legacy operation being resurrected.
    if (!await store.getItem(`${KEY}.partitioned`)) {
      const legacy = await store.getItem(KEY);
      if (legacy) {
        const original = JSON.parse(legacy) as QueueDocument;
        if (original.version !== 1 || !original.scope || !Array.isArray(original.items)) throw new Error("invalid offline queue");
        const target = partitionKey(original.scope);
        if (!await store.getItem(target)) await store.setItem(target, legacy);
      }
      await store.setItem(`${KEY}.partitioned`, "true");
    }
    const value = await store.getItem(partitionKey(scope));
    if (!value) return { version: 1, scope, items: [] };
    const parsed = JSON.parse(value) as QueueDocument;
    if (parsed.version !== 1 || !sameScope(parsed.scope, scope)) throw new Error("scope mismatch");
    return parsed;
  }
  const write = (document: QueueDocument) => store.setItem(partitionKey(document.scope), JSON.stringify(document));

  return {
    async enqueue(scope: ImplementationAScope, input: QueueInput) {
      return exclusive(store, async () => {
      if (!input.path.startsWith("/api/implementation-a/")) throw new Error("unapproved offline API path");
      if (!Number.isInteger(input.domainVersion) || input.domainVersion < 1) throw new Error("invalid domain version");
      const document = await read(scope);
      const existing = document.items.find((item) => item.operationId === input.operationId);
      if (existing) {
        if (existing.path !== input.path || existing.method !== input.method || JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) throw new Error("offline operation changed");
        return existing;
      }
      const item: ImplementationAQueueItem = { ...input, authScope: scope, deviceId: scope.deviceId, state: "pending", attempts: 0 };
      document.items.push(item);
      await write(document);
      return item;
      });
    },
    async flush(scope: ImplementationAScope, transport: QueueTransport) {
      return exclusive(store, async () => {
      const document = await read(scope);
      const remaining: ImplementationAQueueItem[] = [];
      for (const item of document.items) {
        if (!sameScope(item.authScope, scope)) throw new Error("scope mismatch");
        if (item.state !== "pending") { remaining.push(item); continue; }
        try {
          await transport(item);
        } catch (error) {
          const status = (error as { status?: number }).status;
          const attempted = { ...item, attempts: item.attempts + 1 };
          if (status === 409 || status === 412) {
            remaining.push({ ...attempted, state: "conflict", visibleResolution: item.domain === "custody" ? "Review the latest custody history before retrying." : "Review the latest record before retrying." });
          } else if (status === 401 || status === 403) {
            remaining.push({ ...attempted, state: "revoked", visibleResolution: "Sign in again or ask an administrator to restore access." });
          } else if (status && status >= 400 && status < 500) {
            remaining.push({ ...attempted, state: "failed", visibleResolution: "Review this offline action." });
          } else {
            remaining.push(attempted);
          }
        }
      }
      document.items = remaining;
      await write(document);
      return document;
      });
    },
    inspect(scope: ImplementationAScope) { return exclusive(store, () => read(scope)); },
  };
}
