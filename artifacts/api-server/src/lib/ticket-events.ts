import { EventEmitter } from "events";
import pg from "pg";
import { logger } from "./logger";

// ── Ticket events pub/sub ───────────────────────────────────────────────────
//
// A narrow, ticket-scoped real-time channel modelled directly on
// `lib/location-events.ts` and `lib/visit-events.ts`. Today it carries a
// single event type — `ticket.unblocked` — emitted by the partner-side
// site-assignment routes when an unblock would re-open one of the
// affected workers' tickets. Mobile already gets the same signal via
// the `ticket_unblocked` Expo push (Task #592 / Task #613); this lets
// open ticket-detail tabs in the web app silently re-fetch and dismiss
// the assignment-removed banner the same instant the office restores
// the assignment, instead of waiting for the 7-second poll fallback
// added in Task #607.
//
// We deliberately *don't* fan a payload here through `notifyUsers` /
// the notifications inbox: this channel is purely a refresh hint for
// any open page on the affected ticket. The page already knows how to
// derive the right UI state from the ticket itself once it re-fetches.

export type TicketUnblockedEvent = {
  type: "ticket.unblocked";
  ticketId: number;
  // Both ids are included so the SSE handler can role-scope visibility
  // without having to hit the DB on every published event. partnerId
  // may be null for tickets whose site has been deleted out from under
  // the row (defensive — the unblock fan-out itself filters those out).
  vendorId: number | null;
  partnerId: number | null;
};

export type TicketEvent = TicketUnblockedEvent;

// Subscribers receive events with a monotonically increasing `seq` attached
// by the publisher (sourced from a Postgres sequence so it's globally
// ordered across API instances). Mirrors location-events.ts so the SSE
// handler can use a Last-Event-ID gap-detection pattern identical to the
// crew map's location stream.
export type PublishedTicketEvent = TicketEvent & { seq: number };

const CHANNEL = "ticket_events";
const SEQUENCE_NAME = "ticket_events_seq";
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
      "DATABASE_URL not set; ticket_events pub/sub will not be cross-instance",
    );
    return;
  }
  listenerStarting = true;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as PublishedTicketEvent;
      localBus.emit("ticket", ev);
    } catch (err) {
      logger.error({ err, payload: msg.payload }, "Bad ticket_events payload");
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "ticket_events listener client error");
    scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("ticket_events listener connection ended");
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    reconnectDelayMs = 1000;
    logger.info({ channel: CHANNEL }, "Ticket events listener connected");
  } catch (err) {
    logger.error({ err }, "Failed to start ticket_events listener");
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

export function startTicketEventBus(): void {
  stopping = false;
  void ensureSequence();
  void startListenerClient();
}

let sequenceReady: Promise<void> | null = null;

function ensureSequence(): Promise<void> {
  if (sequenceReady) return sequenceReady;
  sequenceReady = (async () => {
    const { pool } = await import("@workspace/db");
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${SEQUENCE_NAME}`);
  })().catch((err) => {
    logger.error({ err }, "Failed to ensure ticket_events_seq sequence");
    sequenceReady = null;
    throw err;
  });
  return sequenceReady;
}

// Returns the most recently issued ticket-event sequence id (or 0 if none
// has been issued yet). Used by the SSE handler on connect to tell clients
// whether they may have missed events while disconnected.
export async function getCurrentTicketEventSeq(): Promise<number> {
  try {
    const { pool } = await import("@workspace/db");
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

export async function stopTicketEventBus(): Promise<void> {
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

export function publishTicketUnblocked(input: {
  ticketId: number;
  vendorId: number | null;
  partnerId: number | null;
}): void {
  const ev: TicketUnblockedEvent = {
    type: "ticket.unblocked",
    ticketId: input.ticketId,
    vendorId: input.vendorId,
    partnerId: input.partnerId,
  };
  void publishViaPool(ev).catch((err) => {
    logger.error(
      { err, type: ev.type, ticketId: ev.ticketId },
      "Failed to publish ticket event",
    );
    // Best-effort local emit so single-instance dev environments still
    // see the event even when Postgres is unreachable.
    const seq = ++localSeqCounter;
    localBus.emit("ticket", { ...ev, seq } satisfies PublishedTicketEvent);
  });
}

async function publishViaPool(ev: TicketEvent): Promise<void> {
  await ensureSequence();
  const { pool } = await import("@workspace/db");
  const seqRes = await pool.query<{ seq: string }>(
    `SELECT nextval('${SEQUENCE_NAME}')::text AS seq`,
  );
  const seq = Number(seqRes.rows[0]?.seq ?? 0);
  if (seq > localSeqCounter) localSeqCounter = seq;
  const withSeq: PublishedTicketEvent = { ...ev, seq };
  const payload = JSON.stringify(withSeq);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `ticket_events payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${Buffer.byteLength(
        payload,
        "utf8",
      )} bytes)`,
    );
  }
  await pool.query(`NOTIFY ${CHANNEL}, ${quoteLiteral(payload)}`);
}

export function subscribeTicketEvents(
  fn: (ev: PublishedTicketEvent) => void,
): () => void {
  localBus.on("ticket", fn);
  return () => {
    localBus.off("ticket", fn);
  };
}

// Test-only: forcibly end the underlying LISTEN client to simulate the
// kind of mid-session disconnect we see in production when a managed
// Postgres failover or an idle-timeout proxy kills the connection. The
// 'end' event handler will fire scheduleReconnect, which transparently
// re-establishes the LISTEN client without restarting the server.
//
// Returns true when there was a live client to close, false otherwise.
// Callers must wait for the bus to come back online (e.g. by probing
// with publishTicketUnblocked + subscribeTicketEvents) before relying on
// new NOTIFY traffic to fan out — events published while the listener is
// offline are inherently dropped by Postgres LISTEN/NOTIFY semantics.
export function __forceCloseListenerForTests(): boolean {
  const client = listenerClient;
  if (!client) return false;
  void client.end().catch(() => undefined);
  return true;
}
