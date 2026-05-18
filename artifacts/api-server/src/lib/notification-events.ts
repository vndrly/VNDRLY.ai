import { EventEmitter } from "events";
import pg from "pg";
import { logger } from "./logger";

// ── Notification events pub/sub — Task #48 ──────────────────────────────────
//
// Real-time fan-out for newly-inserted notification rows so the web bell
// (and any future surface) can update the unread count + show a browser
// pop-up the same instant the rules engine inserts a row, instead of
// waiting for the bell's 30-second poll window. Modeled directly on
// `lib/ticket-events.ts`: a single per-process pg.Client holds a long
// LISTEN open on `notification_events` and re-emits payloads through a
// local EventEmitter; `publishNotificationCreated()` allocates a global
// `seq` from a Postgres sequence and `NOTIFY`s the JSON payload.
//
// The payload carries the recipient `userId` so the SSE handler can
// scope events to the connected session without an extra DB hop, plus
// the minimum metadata the web bell needs to render a browser
// notification (title/body/link/category/type/notificationId).

export type NotificationCreatedEvent = {
  type: "notification.created";
  // Recipient. The SSE handler filters on this so a connected user only
  // receives events targeted at them.
  userId: number;
  // Mirror of the `notifications.id` column for the inserted row, so the
  // client can de-dup if it also has the same row from a refetch.
  notificationId: number;
  notifType: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
};

export type NotificationEvent = NotificationCreatedEvent;

// Subscribers receive events with a monotonically increasing `seq` attached
// by the publisher (sourced from a Postgres sequence so it's globally
// ordered across API instances). Mirrors location-events.ts so the SSE
// handler can use a Last-Event-ID gap-detection pattern identical to the
// crew map / ticket detail streams.
export type PublishedNotificationEvent = NotificationEvent & { seq: number };

const CHANNEL = "notification_events";
const SEQUENCE_NAME = "notification_events_seq";
const MAX_PAYLOAD_BYTES = 7500; // Postgres NOTIFY limit is 8000; leave headroom.

const localBus = new EventEmitter();
localBus.setMaxListeners(0);

let listenerClient: pg.Client | null = null;
let listenerStarting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1000;
let stopping = false;
const MAX_RECONNECT_DELAY_MS = 30_000;

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function startListenerClient(): Promise<void> {
  if (stopping) return;
  if (listenerClient || listenerStarting) return;
  if (!process.env.DATABASE_URL) {
    logger.warn(
      "DATABASE_URL not set; notification_events pub/sub will not be cross-instance",
    );
    return;
  }
  listenerStarting = true;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as PublishedNotificationEvent;
      localBus.emit("notification", ev);
    } catch (err) {
      logger.error(
        { err, payload: msg.payload },
        "Bad notification_events payload",
      );
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "notification_events listener client error");
    scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("notification_events listener connection ended");
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    reconnectDelayMs = 1000;
    logger.info({ channel: CHANNEL }, "Notification events listener connected");
  } catch (err) {
    logger.error({ err }, "Failed to start notification_events listener");
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    scheduleReconnect();
  } finally {
    listenerStarting = false;
  }
}

function scheduleReconnect(): void {
  if (stopping) return;
  if (listenerClient) {
    try {
      void listenerClient.end().catch(() => undefined);
    } catch {
      /* ignore */
    }
    listenerClient = null;
  }
  if (reconnectTimer) return;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startListenerClient();
  }, delay);
}

export function startNotificationEventBus(): void {
  stopping = false;
  void ensureSequence();
  void startListenerClient();
}

let sequenceReady: Promise<void> | null = null;

// Lazily resolve the pg Pool from @workspace/db. Returns null when the db
// module is mocked without a `pool` export (common in route tests) so callers
// can quietly fall back to the process-local seq counter instead of spamming
// ERROR logs on every poll. Mirrors `location-events.ts`.
async function getPoolOrNull(): Promise<pg.Pool | null> {
  try {
    const mod = (await import("@workspace/db")) as { pool?: pg.Pool };
    return mod.pool ?? null;
  } catch {
    return null;
  }
}

function ensureSequence(): Promise<void> {
  if (sequenceReady) return sequenceReady;
  sequenceReady = (async () => {
    const pool = await getPoolOrNull();
    if (!pool) return;
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${SEQUENCE_NAME}`);
  })().catch((err) => {
    logger.error({ err }, "Failed to ensure notification_events_seq sequence");
    sequenceReady = null;
    throw err;
  });
  return sequenceReady;
}

// Returns the most recently issued notification-event sequence id (or 0 if
// none has been issued yet). Used by the SSE handler on connect to tell
// clients whether they may have missed events while disconnected.
export async function getCurrentNotificationEventSeq(): Promise<number> {
  try {
    const pool = await getPoolOrNull();
    if (!pool) return localSeqCounter;
    const { rows } = await pool.query<{ seq: string; called: boolean }>(
      `SELECT last_value::text AS seq, is_called AS called FROM ${SEQUENCE_NAME}`,
    );
    if (!rows[0]) return localSeqCounter;
    const last = Number(rows[0].seq);
    return rows[0].called ? last : 0;
  } catch {
    return localSeqCounter;
  }
}

export async function stopNotificationEventBus(): Promise<void> {
  stopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const client = listenerClient;
  listenerClient = null;
  if (client) {
    try {
      await client.query(`UNLISTEN ${CHANNEL}`);
    } catch {
      /* ignore */
    }
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

// Process-local fallback counter used when the database is unreachable so
// every published event still gets *some* monotonically increasing seq.
let localSeqCounter = 0;

export function publishNotificationCreated(input: {
  userId: number;
  notificationId: number;
  notifType: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
}): void {
  const ev: NotificationCreatedEvent = {
    type: "notification.created",
    userId: input.userId,
    notificationId: input.notificationId,
    notifType: input.notifType,
    category: input.category,
    title: input.title,
    body: input.body,
    link: input.link,
    createdAt: input.createdAt,
  };
  void publishViaPool(ev).catch((err) => {
    if (!(err instanceof PoolUnavailableError)) {
      logger.error(
        { err, type: ev.type, userId: ev.userId, notificationId: ev.notificationId },
        "Failed to publish notification event",
      );
    }
    // Best-effort local emit so single-instance dev environments still see
    // the event even when Postgres is unreachable.
    const seq = ++localSeqCounter;
    localBus.emit("notification", { ...ev, seq } satisfies PublishedNotificationEvent);
  });
}

class PoolUnavailableError extends Error {
  constructor() {
    super("pg pool unavailable");
    this.name = "PoolUnavailableError";
  }
}

async function publishViaPool(ev: NotificationEvent): Promise<void> {
  await ensureSequence();
  const pool = await getPoolOrNull();
  if (!pool) throw new PoolUnavailableError();
  const seqRes = await pool.query<{ seq: string }>(
    `SELECT nextval('${SEQUENCE_NAME}')::text AS seq`,
  );
  const seq = Number(seqRes.rows[0]?.seq ?? 0);
  if (seq > localSeqCounter) localSeqCounter = seq;
  const withSeq: PublishedNotificationEvent = { ...ev, seq };
  const payload = JSON.stringify(withSeq);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `notification_events payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${Buffer.byteLength(
        payload,
        "utf8",
      )} bytes)`,
    );
  }
  await pool.query(`NOTIFY ${CHANNEL}, ${quoteLiteral(payload)}`);
}

export function subscribeNotificationEvents(
  fn: (ev: PublishedNotificationEvent) => void,
): () => void {
  localBus.on("notification", fn);
  return () => {
    localBus.off("notification", fn);
  };
}
