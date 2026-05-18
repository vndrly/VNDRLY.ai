import { EventEmitter } from "events";
import pg from "pg";
import { logger } from "./logger";

export type LiveLocationPayload = {
  employeeId: number;
  employeeName: string;
  ticketId: number;
  vendorId: number | null;
  lifecycleState: string | null;
  siteLocationId: number | null;
  sitePartnerId: number | null;
  siteName: string | null;
  siteCode: string | null;
  // Site center coordinates (joined from siteLocationsTable). Used by the
  // crew map to draw the destination route line and compute distance/ETA.
  // null when the ticket has no associated site or the site lacks coords.
  siteLatitude: number | null;
  siteLongitude: number | null;
  latitude: number;
  longitude: number;
  batteryLevel: number | null;
  // Direction of travel in degrees (0 = north, 90 = east). null when unknown
  // — either the device did not supply a heading and the device hasn't moved
  // far enough since the last ping for the server to compute a reliable bearing.
  heading: number | null;
  // Ground speed in meters per second from the device GPS. null when the
  // device did not supply a speed (or it was negative / non-finite). The
  // crew map converts this to mph/km/h based on locale.
  speedMps: number | null;
  recordedAt: string;
};

export type LocationEvent = {
  type: "location.ping";
  location: LiveLocationPayload;
};

// Subscribers receive events with a monotonically increasing `seq` attached
// by the publisher (sourced from a Postgres sequence so it's globally
// ordered across API instances). Clients use this to detect dropped
// notifications across SSE reconnects — see the SSE handler in
// `routes/locations.ts` and the Crew Map gap warning in the web app.
export type PublishedLocationEvent = LocationEvent & { seq: number };

// ---------------------------------------------------------------------------
// Cross-instance pub/sub for live crew location pings.
//
// Mirrors the design of visit-events.ts: a single dedicated pg.Client per
// process holds a long-lived LISTEN open on `live_location_events` and
// re-emits notifications through a local EventEmitter. publishLocationEvent
// allocates a `seq` from a Postgres sequence and NOTIFYs the JSON payload.
//
// This makes the gap detection used by the Crew Map meaningful even with
// multiple API instances: a client reconnecting to a different instance can
// still tell whether it missed any pings while disconnected.
// ---------------------------------------------------------------------------

const CHANNEL = "live_location_events";
const SEQUENCE_NAME = "live_location_events_seq";
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
  return `'${value.replace(/'/g, "''")}'`;
}

async function startListenerClient(): Promise<void> {
  if (stopping) return;
  if (listenerClient || listenerStarting) return;
  if (!process.env.DATABASE_URL) {
    logger.warn(
      "DATABASE_URL not set; live_location_events pub/sub will not be cross-instance",
    );
    return;
  }
  listenerStarting = true;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as PublishedLocationEvent;
      localBus.emit("location", ev);
    } catch (err) {
      logger.error({ err, payload: msg.payload }, "Bad live_location_events payload");
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "live_location_events listener client error");
    scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("live_location_events listener connection ended");
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    reconnectDelayMs = 1000;
    logger.info({ channel: CHANNEL }, "Live location events listener connected");
  } catch (err) {
    logger.error({ err }, "Failed to start live_location_events listener");
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

export function startLocationEventBus(): void {
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

function ensureSequence(): Promise<void> {
  if (sequenceReady) return sequenceReady;
  sequenceReady = (async () => {
    const pool = await getPoolOrNull();
    if (!pool) return;
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${SEQUENCE_NAME}`);
  })().catch((err) => {
    logger.error({ err }, "Failed to ensure live_location_events_seq sequence");
    sequenceReady = null;
    throw err;
  });
  return sequenceReady;
}

// Returns the most recently issued location-event sequence id (or 0 if none
// has been issued yet). Used by the SSE handler on connect to tell clients
// whether they may have missed events while disconnected.
export async function getCurrentLocationEventSeq(): Promise<number> {
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

export async function stopLocationEventBus(): Promise<void> {
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

export function publishLocationEvent(ev: LocationEvent): void {
  void publishViaPool(ev).catch((err) => {
    // When the db module is mocked without a `pool` (route tests), fall back
    // to the local seq counter silently — there's nothing actionable to log.
    if (!(err instanceof PoolUnavailableError)) {
      logger.error({ err, type: ev.type }, "Failed to publish location event");
    }
    const seq = ++localSeqCounter;
    localBus.emit("location", { ...ev, seq } satisfies PublishedLocationEvent);
  });
}

class PoolUnavailableError extends Error {
  constructor() {
    super("pg pool unavailable");
    this.name = "PoolUnavailableError";
  }
}

async function publishViaPool(ev: LocationEvent): Promise<void> {
  await ensureSequence();
  const pool = await getPoolOrNull();
  if (!pool) throw new PoolUnavailableError();
  const seqRes = await pool.query<{ seq: string }>(
    `SELECT nextval('${SEQUENCE_NAME}')::text AS seq`,
  );
  const seq = Number(seqRes.rows[0]?.seq ?? 0);
  if (seq > localSeqCounter) localSeqCounter = seq;
  const withSeq: PublishedLocationEvent = { ...ev, seq };
  const payload = JSON.stringify(withSeq);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `live_location_events payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${Buffer.byteLength(
        payload,
        "utf8",
      )} bytes)`,
    );
  }
  await pool.query(`NOTIFY ${CHANNEL}, ${quoteLiteral(payload)}`);
}

export function subscribeLocationEvents(
  fn: (ev: PublishedLocationEvent) => void,
): () => void {
  localBus.on("location", fn);
  return () => {
    localBus.off("location", fn);
  };
}
