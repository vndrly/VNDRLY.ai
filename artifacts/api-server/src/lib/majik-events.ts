import { EventEmitter } from "events";
import pg from "pg";
import type { MajikPresenceEvent } from "@workspace/majik";
import { logger } from "./logger";

export type PublishedMajikEvent = Extract<
  MajikPresenceEvent,
  { type: "majik.presence_updated" }
> & { seq: number };

const CHANNEL = "majik_events";
const MAX_PAYLOAD_BYTES = 7500;

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
      "DATABASE_URL not set; majik events pub/sub will not be cross-instance",
    );
    return;
  }
  listenerStarting = true;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as PublishedMajikEvent;
      localBus.emit("majik", ev);
    } catch (err) {
      logger.error({ err, payload: msg.payload }, "Bad majik_events payload");
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "majik_events listener client error");
    scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("majik_events listener connection ended");
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    reconnectDelayMs = 1000;
    logger.info({ channel: CHANNEL }, "Majik events listener connected");
  } catch (err) {
    logger.error({ err }, "Failed to start majik_events listener");
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

export function startMajikEventBus(): void {
  stopping = false;
  void ensureSequence();
  void startListenerClient();
}

let sequenceReady: Promise<void> | null = null;

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
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS majik_events_seq`);
  })().catch((err) => {
    logger.error({ err }, "Failed to ensure majik_events_seq sequence");
    sequenceReady = null;
    throw err;
  });
  return sequenceReady;
}

export async function getCurrentMajikEventSeq(): Promise<number> {
  try {
    const pool = await getPoolOrNull();
    if (!pool) return localSeqCounter;
    const { rows } = await pool.query<{ seq: string; called: boolean }>(
      `SELECT last_value::text AS seq, is_called AS called FROM majik_events_seq`,
    );
    if (!rows[0]) return localSeqCounter;
    const last = Number(rows[0].seq);
    return rows[0].called ? last : 0;
  } catch {
    return localSeqCounter;
  }
}

export async function stopMajikEventBus(): Promise<void> {
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

let localSeqCounter = 0;

class PoolUnavailableError extends Error {
  constructor() {
    super("pg pool unavailable");
    this.name = "PoolUnavailableError";
  }
}

export function publishMajikEvent(
  ev: Extract<MajikPresenceEvent, { type: "majik.presence_updated" }>,
): void {
  void publishViaPool(ev).catch((err) => {
    if (!(err instanceof PoolUnavailableError)) {
      logger.error({ err, type: ev.type }, "Failed to publish majik event");
    }
    const seq = ++localSeqCounter;
    localBus.emit("majik", { ...ev, seq } satisfies PublishedMajikEvent);
  });
}

async function publishViaPool(
  ev: Extract<MajikPresenceEvent, { type: "majik.presence_updated" }>,
): Promise<void> {
  await ensureSequence();
  const pool = await getPoolOrNull();
  if (!pool) throw new PoolUnavailableError();
  const seqRes = await pool.query<{ seq: string }>(
    `SELECT nextval('majik_events_seq')::text AS seq`,
  );
  const seq = Number(seqRes.rows[0]?.seq ?? 0);
  if (seq > localSeqCounter) localSeqCounter = seq;
  const withSeq: PublishedMajikEvent = { ...ev, seq };
  const payload = JSON.stringify(withSeq);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `majik_events payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${Buffer.byteLength(payload, "utf8")} bytes)`,
    );
  }
  await pool.query(`NOTIFY ${CHANNEL}, ${quoteLiteral(payload)}`);
}

export function subscribeMajikEvents(
  fn: (ev: PublishedMajikEvent) => void,
): () => void {
  localBus.on("majik", fn);
  return () => {
    localBus.off("majik", fn);
  };
}
