export type QueueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type WorkHubQueueScope = Readonly<{
  userId: number;
  ownerOrgType: "partner" | "vendor";
  ownerOrgId: number;
}>;

type QueueState = "pending" | "conflict" | "failed" | "revoked";
type QueueBase = {
  operationId: string;
  /** Kept for older callers and server-side idempotency headers. */
  idempotencyKey: string;
  path: string;
  queuedAt: string;
  attempts: number;
  nextAttemptAt: string;
  state: QueueState;
  dependsOn: string[];
};

export type QueuedWorkHubCommand = QueueBase & {
  kind: "command";
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  payload: unknown;
};

export type QueuedWorkHubUpload = QueueBase & {
  kind: "upload";
  method: "POST" | "PUT";
  fileUri: string;
  contentType: string;
  headers: Record<string, string>;
  removeAfterSend: boolean;
  payload: null;
};

export type QueuedWorkHubItem = QueuedWorkHubCommand | QueuedWorkHubUpload;

type QueueDocument = { version: 2; scope: WorkHubQueueScope; items: QueuedWorkHubItem[] };
type QueueOptions = { maxItems?: number; maxUploads?: number; maxPayloadBytes?: number; now?: () => Date; operationId?: () => string };
type FlushOptions = { now?: () => Date };

const SCOPED_PREFIX = "vndrly.workHub.queue.v2";
const DEFAULT_MAX_ITEMS = 500;
const DEFAULT_MAX_UPLOADS = 50;
const DEFAULT_MAX_PAYLOAD_BYTES = 1_000_000;
const locks = new WeakMap<object, Map<string, Promise<void>>>();

function scopeKey(scope: WorkHubQueueScope) {
  if (!Number.isSafeInteger(scope.userId) || scope.userId <= 0 || !Number.isSafeInteger(scope.ownerOrgId) || scope.ownerOrgId <= 0) {
    throw new Error("A valid user and organization are required for the Work Hub queue");
  }
  if (scope.ownerOrgType !== "partner" && scope.ownerOrgType !== "vendor") throw new Error("Invalid Work Hub organization type");
  return `${SCOPED_PREFIX}.${scope.ownerOrgType}.${scope.ownerOrgId}.user.${scope.userId}`;
}

function assertPath(path: string) {
  if (!path.startsWith("/api/work-hub/") || path.includes("..")) throw new Error("A Work Hub API path is required");
}

function createOperationId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure operation ID generation is unavailable");
  return uuid;
}

function utf8Bytes(value: string) {
  return typeof TextEncoder === "function" ? new TextEncoder().encode(value).byteLength : unescape(encodeURIComponent(value)).length;
}

async function locked<T>(store: QueueStore, key: string, action: () => Promise<T>): Promise<T> {
  let byKey = locks.get(store as object);
  if (!byKey) { byKey = new Map(); locks.set(store as object, byKey); }
  const previous = byKey.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  byKey.set(key, tail);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (byKey.get(key) === tail) byKey.delete(key);
  }
}

async function read(store: QueueStore, scope: WorkHubQueueScope): Promise<QueueDocument> {
  const raw = await store.getItem(scopeKey(scope));
  if (!raw) return { version: 2, scope, items: [] };
  try {
    const parsed = JSON.parse(raw) as QueueDocument;
    if (parsed.version !== 2 || parsed.scope.userId !== scope.userId || parsed.scope.ownerOrgId !== scope.ownerOrgId || parsed.scope.ownerOrgType !== scope.ownerOrgType || !Array.isArray(parsed.items)) {
      throw new Error("Offline queue scope mismatch");
    }
    return parsed;
  } catch (cause) {
    if (cause instanceof Error && cause.message === "Offline queue scope mismatch") throw cause;
    throw new Error("The encrypted offline queue could not be read; its stored data was preserved for recovery");
  }
}

async function append(store: QueueStore, scope: WorkHubQueueScope, item: QueuedWorkHubItem, options: QueueOptions) {
  const key = scopeKey(scope);
  return locked(store, key, async () => {
    const document = await read(store, scope);
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    if (document.items.length >= maxItems) throw new Error("The offline queue is full");
    if (item.kind === "upload" && document.items.filter((candidate) => candidate.kind === "upload").length >= (options.maxUploads ?? DEFAULT_MAX_UPLOADS)) {
      throw new Error("The offline upload queue is full");
    }
    document.items.push(item);
    await store.setItem(key, JSON.stringify(document));
    return item;
  });
}

export async function enqueueWorkHubCommand(
  store: QueueStore,
  scope: WorkHubQueueScope,
  input: { path: string; method: QueuedWorkHubCommand["method"]; payload: unknown; dependsOn?: string[]; operationId?: string },
  options: QueueOptions = {},
) {
  assertPath(input.path);
  const serialized = JSON.stringify(input.payload);
  if (serialized === undefined) throw new Error("The offline command payload is not serializable");
  if (utf8Bytes(serialized) > (options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES)) throw new Error("The offline command payload is too large");
  const operationId = input.operationId ?? options.operationId?.() ?? createOperationId();
  const now = (options.now ?? (() => new Date()))().toISOString();
  return append(store, scope, {
    kind: "command", operationId, idempotencyKey: operationId, path: input.path, method: input.method,
    payload: input.payload, dependsOn: [...new Set(input.dependsOn ?? [])], queuedAt: now, attempts: 0, nextAttemptAt: now, state: "pending",
  }, options) as Promise<QueuedWorkHubCommand>;
}

export async function enqueueWorkHubUpload(
  store: QueueStore,
  scope: WorkHubQueueScope,
  input: { path: string; method?: QueuedWorkHubUpload["method"]; fileUri: string; contentType: string; headers?: Record<string, string>; removeAfterSend?: boolean; dependsOn?: string[]; operationId?: string },
  options: QueueOptions = {},
) {
  assertPath(input.path);
  if (!input.fileUri.startsWith("file://")) throw new Error("Offline uploads require an app-local file");
  const headers = Object.fromEntries(Object.entries(input.headers ?? {}).map(([name, value]) => {
    const normalized = name.toLowerCase();
    if (!["x-file-name", "x-duration-ms"].includes(normalized) || typeof value !== "string" || value.length > 1_024) {
      throw new Error("Unsupported offline upload metadata");
    }
    return [normalized, value];
  }));
  const operationId = input.operationId ?? options.operationId?.() ?? createOperationId();
  const now = (options.now ?? (() => new Date()))().toISOString();
  return append(store, scope, {
    kind: "upload", operationId, idempotencyKey: operationId, path: input.path, method: input.method ?? "POST",
    fileUri: input.fileUri, contentType: input.contentType, headers, removeAfterSend: input.removeAfterSend ?? false,
    payload: null, dependsOn: [...new Set(input.dependsOn ?? [])],
    queuedAt: now, attempts: 0, nextAttemptAt: now, state: "pending",
  }, options) as Promise<QueuedWorkHubUpload>;
}

export async function inspectWorkHubQueue(store: QueueStore, scope: WorkHubQueueScope) {
  return read(store, scope);
}

function retryDelay(item: QueuedWorkHubItem, cause: any) {
  if (Number.isFinite(cause?.retryAfterMs) && cause.retryAfterMs >= 0) return Math.min(cause.retryAfterMs, 24 * 60 * 60_000);
  return Math.min(60_000, 1_000 * (2 ** Math.min(item.attempts, 6)));
}

export async function flushWorkHubCommands(
  store: QueueStore,
  scope: WorkHubQueueScope,
  send: (item: QueuedWorkHubItem) => Promise<void>,
  options: FlushOptions = {},
) {
  const key = scopeKey(scope);
  return locked(store, key, async () => {
    const document = await read(store, scope);
    const now = (options.now ?? (() => new Date()))();
    const remaining: QueuedWorkHubItem[] = [];
    const outstanding = new Set(document.items.map((item) => item.operationId));
    let sent = 0;
    let revoked = false;
    for (const item of document.items) {
      if (revoked) { remaining.push({ ...item, state: "revoked" }); continue; }
      if (item.state !== "pending" || new Date(item.nextAttemptAt).getTime() > now.getTime() || item.dependsOn.some((id) => outstanding.has(id))) {
        remaining.push(item); continue;
      }
      try {
        await send(item);
        outstanding.delete(item.operationId);
        sent += 1;
      } catch (cause: any) {
        const status = Number(cause?.status);
        if (status === 401 || status === 403) {
          revoked = true;
          remaining.push({ ...item, state: "revoked" });
        } else if (status === 409 || status === 412) {
          remaining.push({ ...item, state: "conflict" });
        } else if ((status >= 400 && status < 500 && status !== 408 && status !== 429) || status === 410) {
          remaining.push({ ...item, state: "failed" });
        } else {
          const attempts = item.attempts + 1;
          remaining.push({ ...item, attempts, nextAttemptAt: new Date(now.getTime() + retryDelay(item, cause)).toISOString() });
        }
      }
    }
    if (revoked) {
      for (let index = 0; index < remaining.length; index += 1) {
        if (remaining[index].state === "pending") remaining[index] = { ...remaining[index], state: "revoked" };
      }
    }
    await store.setItem(key, JSON.stringify({ ...document, items: remaining }));
    return { sent, remaining: remaining.length, revoked };
  });
}
