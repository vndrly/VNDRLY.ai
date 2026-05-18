import { EventEmitter } from "events";
import pg from "pg";
import { logger } from "./logger";

// ── Hotlist comment events pub/sub ──────────────────────────────────────────
//
// Task #676 — push channel for hotlist-job comment changes so the
// dispatcher's CommentsPanel can stop showing the deliberate "Not live" pill
// + manual Refresh button (Task #672) and instead match the live ticket
// comments experience: created / edited / deleted notes appear without a
// page interaction.
//
// Modeled directly on `lib/ticket-events.ts` (Task #622): one per-process
// LISTEN client behind Postgres LISTEN/NOTIFY so events still fan out when
// multiple API instances are running, plus a global pg sequence that gives
// every published event a monotonically increasing `seq`. The SSE handler
// uses that seq with EventSource's Last-Event-ID header to flag a `gap`
// on reconnect, exactly the way ticket-events / location-events / visit-
// events already do.
//
// We deliberately DON'T fan out a notification through `notifyUsers` here:
// the inbox + push notifications for hotlist comments are still handled by
// the existing `notifyUsers(...)` calls in `routes/comments.ts`. This bus
// is purely the live-refresh hint for any open CommentsPanel viewing the
// affected job — the panel re-fetches on receipt so it always renders the
// canonical server state (deleted-by, edit history, read receipts).

export type HotlistCommentEventType =
  | "hotlist.comment.created"
  | "hotlist.comment.updated"
  | "hotlist.comment.deleted";

export type HotlistCommentEvent = {
  type: HotlistCommentEventType;
  jobId: number;
  commentId: number;
  // Visibility scoping mirrors `canParticipateHotlist` in routes/comments.ts:
  //   - admin sees every event,
  //   - the job's partner sees their own job,
  //   - any vendor that has bid on the job sees it.
  // We snapshot these IDs at publish time so the SSE handler can filter
  // without a follow-up DB read on every event.
  partnerId: number | null;
  bidderVendorIds: number[];
};

// Subscribers receive events with a monotonically increasing `seq` attached
// by the publisher (sourced from a Postgres sequence so it's globally
// ordered across API instances). The SSE handler uses this for Last-Event-ID
// gap detection on reconnect.
export type PublishedHotlistCommentEvent = HotlistCommentEvent & {
  seq: number;
};

const CHANNEL = "hotlist_comment_events";
const SEQUENCE_NAME = "hotlist_comment_events_seq";
const MAX_PAYLOAD_BYTES = 7500; // Postgres NOTIFY caps at 8000; leave headroom.

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
      "DATABASE_URL not set; hotlist_comment_events pub/sub will not be cross-instance",
    );
    return;
  }
  listenerStarting = true;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as PublishedHotlistCommentEvent;
      localBus.emit("hotlist-comment", ev);
    } catch (err) {
      logger.error(
        { err, payload: msg.payload },
        "Bad hotlist_comment_events payload",
      );
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "hotlist_comment_events listener client error");
    scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("hotlist_comment_events listener connection ended");
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    reconnectDelayMs = 1000;
    logger.info(
      { channel: CHANNEL },
      "Hotlist comment events listener connected",
    );
  } catch (err) {
    logger.error({ err }, "Failed to start hotlist_comment_events listener");
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

export function startHotlistCommentEventBus(): void {
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
    logger.error(
      { err },
      "Failed to ensure hotlist_comment_events_seq sequence",
    );
    sequenceReady = null;
    throw err;
  });
  return sequenceReady;
}

// Returns the most recently issued hotlist-comment-event sequence id (or 0 if
// none has been issued yet). Used by the SSE handler on connect to tell
// clients whether they may have missed events while disconnected.
export async function getCurrentHotlistCommentEventSeq(): Promise<number> {
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

export async function stopHotlistCommentEventBus(): Promise<void> {
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

export function publishHotlistCommentEvent(input: HotlistCommentEvent): void {
  void publishViaPool(input).catch((err) => {
    logger.error(
      { err, type: input.type, jobId: input.jobId, commentId: input.commentId },
      "Failed to publish hotlist comment event",
    );
    // Best-effort local emit so single-instance dev environments still see
    // the event even when Postgres is unreachable.
    const seq = ++localSeqCounter;
    localBus.emit("hotlist-comment", {
      ...input,
      seq,
    } satisfies PublishedHotlistCommentEvent);
  });
}

async function publishViaPool(ev: HotlistCommentEvent): Promise<void> {
  await ensureSequence();
  const { pool } = await import("@workspace/db");
  const seqRes = await pool.query<{ seq: string }>(
    `SELECT nextval('${SEQUENCE_NAME}')::text AS seq`,
  );
  const seq = Number(seqRes.rows[0]?.seq ?? 0);
  if (seq > localSeqCounter) localSeqCounter = seq;
  const withSeq: PublishedHotlistCommentEvent = { ...ev, seq };
  const payload = JSON.stringify(withSeq);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `hotlist_comment_events payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${Buffer.byteLength(
        payload,
        "utf8",
      )} bytes)`,
    );
  }
  await pool.query(`NOTIFY ${CHANNEL}, ${quoteLiteral(payload)}`);
}

export function subscribeHotlistCommentEvents(
  fn: (ev: PublishedHotlistCommentEvent) => void,
): () => void {
  localBus.on("hotlist-comment", fn);
  return () => {
    localBus.off("hotlist-comment", fn);
  };
}
