import { EventEmitter } from "events";
import pg from "pg";
import { logger } from "./logger";

export type VisitorEventPayload = {
  id: number;
  firstName: string;
  lastName: string;
  company: string | null;
  purpose: string | null;
  hostType: "partner" | "vendor";
  hostPartnerId: number | null;
  hostVendorId: number | null;
  hostPartnerName: string | null;
  hostVendorName: string | null;
  siteLocationId: number;
  sitePartnerId: number | null;
  siteName: string | null;
  checkInTime: string;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
};

export type VisitEvent =
  | {
      type: "visit.checked_in";
      visit: VisitorEventPayload;
    }
  | {
      type: "visit.checked_out";
      visitId: number;
      siteLocationId: number;
      sitePartnerId: number | null;
      hostVendorId: number | null;
      checkOutTime: string;
      autoCheckedOut: boolean;
    };

// Subscribers receive events with a monotonically increasing `seq` attached
// by the publisher (sourced from a Postgres sequence so it's globally
// ordered across API instances). Clients use this to detect dropped
// notifications across SSE reconnects — see the SSE handler in
// `routes/visits.ts` and the Crew Map gap warning in the web app.
export type PublishedVisitEvent = VisitEvent & { seq: number };

// ---------------------------------------------------------------------------
// Cross-instance pub/sub for live visit events.
//
// Visit events drive the live Crew Map updates. With more than one API
// instance (multiple processes, pods, or replicas behind a load balancer),
// an in-process EventEmitter would only deliver events to clients connected
// to the same instance that produced the event — clients on other instances
// would silently miss updates.
//
// To keep the channel correct as we scale out, we back the bus with Postgres
// LISTEN/NOTIFY on the existing primary database. Postgres is already a hard
// dependency, so this avoids adding Redis as another piece of infrastructure.
//
// How it works:
//   - publishVisitEvent() issues `NOTIFY visit_events, '<json>'` on a pooled
//     connection. Every API instance with a LISTEN open — including the one
//     that published — receives the notification.
//   - A single dedicated pg.Client per process keeps a long-lived LISTEN open
//     and re-emits every received notification through a local EventEmitter.
//   - subscribeVisitEvents() registers a listener on the local EventEmitter,
//     so SSE handlers inside the process get every event regardless of which
//     instance produced it.
//   - The dedicated client auto-reconnects on error/end so a transient DB
//     blip doesn't permanently silence the channel.
//
// To add another realtime channel later, follow the same pattern: pick a
// channel name, JSON-encode the payload, NOTIFY to publish, and pipe the
// LISTEN notifications into a local EventEmitter that handlers subscribe to.
// Keep payloads under ~7KB — Postgres caps NOTIFY payloads at 8000 bytes.
// ---------------------------------------------------------------------------

const CHANNEL = "visit_events";
const MAX_PAYLOAD_BYTES = 7500; // Postgres limit is 8000; leave headroom.

const localBus = new EventEmitter();
localBus.setMaxListeners(0);

let listenerClient: pg.Client | null = null;
let listenerStarting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1000;
let stopping = false;
const MAX_RECONNECT_DELAY_MS = 30_000;

function quoteLiteral(value: string): string {
  // Postgres single-quoted string literal escaping for NOTIFY payload.
  return `'${value.replace(/'/g, "''")}'`;
}

async function startListenerClient(): Promise<void> {
  if (stopping) return;
  if (listenerClient || listenerStarting) return;
  if (!process.env.DATABASE_URL) {
    logger.warn(
      "DATABASE_URL not set; visit events pub/sub will not be cross-instance",
    );
    return;
  }
  listenerStarting = true;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as PublishedVisitEvent;
      localBus.emit("visit", ev);
    } catch (err) {
      logger.error({ err, payload: msg.payload }, "Bad visit_events payload");
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "visit_events listener client error");
    scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("visit_events listener connection ended");
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    reconnectDelayMs = 1000;
    logger.info({ channel: CHANNEL }, "Visit events listener connected");
  } catch (err) {
    logger.error({ err }, "Failed to start visit_events listener");
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

export function startVisitEventBus(): void {
  stopping = false;
  void ensureSequence();
  void startListenerClient();
}

let sequenceReady: Promise<void> | null = null;

// Lazily resolve the pg Pool from @workspace/db. Returns null when the db
// module is mocked without a `pool` export (common in route tests) so callers
// can quietly fall back to the process-local seq counter instead of spamming
// ERROR logs on every poll.
async function getPoolOrNull(): Promise<pg.Pool | null> {
  try {
    const mod = (await import("@workspace/db")) as { pool?: pg.Pool };
    return mod.pool ?? null;
  } catch {
    return null;
  }
}

// Idempotent: cached so concurrent publishes/reads share a single CREATE.
// Resets to null on failure so a transient DB error during boot doesn't
// permanently cache a rejected promise (subsequent calls retry).
function ensureSequence(): Promise<void> {
  if (sequenceReady) return sequenceReady;
  sequenceReady = (async () => {
    const pool = await getPoolOrNull();
    if (!pool) return;
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS visit_events_seq`);
  })().catch((err) => {
    logger.error({ err }, "Failed to ensure visit_events_seq sequence");
    sequenceReady = null;
    throw err;
  });
  return sequenceReady;
}

// Returns the most recently issued visit-event sequence id (or 0 if none has
// been issued yet). Used by the SSE handler on connect to tell clients
// whether they may have missed events while disconnected.
export async function getCurrentVisitEventSeq(): Promise<number> {
  try {
    const pool = await getPoolOrNull();
    if (!pool) return localSeqCounter;
    const { rows } = await pool.query<{ seq: string; called: boolean }>(
      `SELECT last_value::text AS seq, is_called AS called FROM visit_events_seq`,
    );
    if (!rows[0]) return localSeqCounter;
    const last = Number(rows[0].seq);
    return rows[0].called ? last : 0;
  } catch {
    return localSeqCounter;
  }
}

export async function stopVisitEventBus(): Promise<void> {
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
// Only this instance's clients will see it advance, but that's still useful
// for in-stream gap detection and is strictly better than no seq at all.
let localSeqCounter = 0;

export function publishVisitEvent(ev: VisitEvent): void {
  // Lazily import the shared pool to avoid a circular dependency at module
  // load time (the db package validates DATABASE_URL on import).
  void publishViaPool(ev).catch((err) => {
    // When the db module is mocked without a `pool` (route tests), fall back
    // to the local seq counter silently — there's nothing actionable to log.
    if (!(err instanceof PoolUnavailableError)) {
      logger.error({ err, type: ev.type }, "Failed to publish visit event");
    }
    // Fall back to local-only delivery so a degraded DB doesn't fully break
    // the in-process SSE clients on this instance.
    const seq = ++localSeqCounter;
    localBus.emit("visit", { ...ev, seq } satisfies PublishedVisitEvent);
  });
}

class PoolUnavailableError extends Error {
  constructor() {
    super("pg pool unavailable");
    this.name = "PoolUnavailableError";
  }
}

async function publishViaPool(ev: VisitEvent): Promise<void> {
  // Make sure the sequence exists before any publish attempts to avoid a
  // startup race with `ensureSequence()` queued from startVisitEventBus.
  await ensureSequence();
  const pool = await getPoolOrNull();
  if (!pool) throw new PoolUnavailableError();
  // Allocate a globally-monotonic sequence id from a Postgres sequence so it
  // is consistent across all API instances. This lets the SSE handler tell
  // reconnecting clients whether they may have missed any events.
  const seqRes = await pool.query<{ seq: string }>(
    `SELECT nextval('visit_events_seq')::text AS seq`,
  );
  const seq = Number(seqRes.rows[0]?.seq ?? 0);
  if (seq > localSeqCounter) localSeqCounter = seq;
  const withSeq: PublishedVisitEvent = { ...ev, seq };
  const payload = JSON.stringify(withSeq);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `visit_events payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${Buffer.byteLength(
        payload,
        "utf8",
      )} bytes)`,
    );
  }
  await pool.query(`NOTIFY ${CHANNEL}, ${quoteLiteral(payload)}`);
}

export function subscribeVisitEvents(
  fn: (ev: PublishedVisitEvent) => void,
): () => void {
  localBus.on("visit", fn);
  return () => {
    localBus.off("visit", fn);
  };
}
