import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

export const ASSEMBLYAI_STREAM_LIMITS = Object.freeze({
  maxSessions: 128,
  maxStartingSessions: 16,
  maxQueuedFrames: 4,
  maxQueuedTurns: 100,
  maxPendingWriteBytes: 64_000,
  maxFrameMs: 1_000,
  minFrameMs: 50,
  idleMs: 20_000,
  lifetimeMs: 4 * 60 * 60_000,
  beginTimeoutMs: 8_000,
  closeGraceMs: 1_000,
});

const SAMPLE_RATE = 16_000;
const FRAME_DURATION_MS = 500;
const PROVIDER_URL = "wss://streaming.assemblyai.com/v3/ws";
const MODELS = new Set(["universal-streaming-english", "universal-streaming-multilingual", "universal-3-5-pro"]);

type Environment = Record<string, string | undefined>;
type Timer = ReturnType<typeof setTimeout>;
type WebSocketLike = {
  readyState: number;
  bufferedAmount?: number;
  send(value: string | Buffer, callback?: (error?: Error) => void): void;
  close(): void;
  terminate(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
};
type Dependencies = {
  env?: Environment;
  webSocketFactory?: (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};
export type AssemblyAITurn = { id: string; turnOrder: number; text: string; startsAtMs: number; endsAtMs: number };
export type AssemblyAIStreamHandle = { sessionId: string; sampleRate: 16000; frameDurationMs: 500 };

export class AssemblyAIStreamError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function assemblyAITrainingAllowed(env: Environment = process.env) {
  return env.ASSEMBLYAI_MODEL_TRAINING_ALLOWED === "1";
}

function configuredModel(env: Environment) {
  const model = env.ASSEMBLYAI_SPEECH_MODEL?.trim() || "universal-streaming-multilingual";
  return MODELS.has(model) ? model : null;
}

function configuredConcurrentStreams(env: Environment) {
  const configured = Number.parseInt(env.ASSEMBLYAI_MAX_CONCURRENT_STREAMS?.trim() || "5", 10);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, ASSEMBLYAI_STREAM_LIMITS.maxSessions)
    : 5;
}

export function assemblyAIStreamingAvailable(env: Environment = process.env) {
  return env.VNDRLY_MEETING_STT_PROVIDER === "assemblyai"
    && Boolean(env.ASSEMBLYAI_API_KEY?.trim())
    && assemblyAITrainingAllowed(env)
    && configuredModel(env) !== null;
}

type Session = {
  id: string;
  occurrenceId: string;
  userId: number;
  startedAtMs: number;
  socket: WebSocketLike;
  state: "starting" | "ready" | "disposed";
  beginPromise: Promise<AssemblyAIStreamHandle>;
  resolveBegin: (handle: AssemblyAIStreamHandle) => void;
  rejectBegin: (error: Error) => void;
  beginTimer?: Timer;
  idleTimer?: Timer;
  lifetimeTimer?: Timer;
  closeTimer?: Timer;
  closePromise: Promise<void>;
  resolveClose: () => void;
  closeSettled: boolean;
  nextSendAt: number;
  lastSequence: number;
  lastPayloadHash?: string;
  pendingFrames: number;
  pendingWriteBytes: number;
  acknowledgedTurnOrder: number;
  seenTurnOrders: Set<number>;
  turns: Map<number, AssemblyAITurn>;
};

function ownerKey(occurrenceId: string, userId: number) { return `${occurrenceId}:${userId}`; }
function streamError(code: string, message: string) { return new AssemblyAIStreamError(code, message); }
function parseProviderMessage(value: unknown) {
  try {
    const text = typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    return JSON.parse(text) as Record<string, unknown>;
  } catch { return null; }
}

export function createAssemblyAIStreamingManager(dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  const webSocketFactory = dependencies.webSocketFactory ?? ((url, options) => new WebSocket(url, options));
  const sessions = new Map<string, Session>();
  // Disposal invalidates handles immediately, but shutdown must still await the socket.
  const pendingDisposals = new Set<Session>();
  const owners = new Map<string, string>();
  const maxConcurrentStreams = configuredConcurrentStreams(env);
  let starting = 0;

  const handle = (session: Session): AssemblyAIStreamHandle => ({ sessionId: session.id, sampleRate: SAMPLE_RATE, frameDurationMs: FRAME_DURATION_MS });
  const clearSessionTimers = (session: Session) => {
    for (const timer of [session.beginTimer, session.idleTimer, session.lifetimeTimer]) if (timer) clearTimer(timer);
    session.beginTimer = session.idleTimer = session.lifetimeTimer = undefined;
  };
  const settleClose = (session: Session) => {
    if (session.closeSettled) return;
    session.closeSettled = true;
    pendingDisposals.delete(session);
    if (session.closeTimer) clearTimer(session.closeTimer);
    session.closeTimer = undefined;
    session.resolveClose();
  };
  const dispose = (session: Session, notifyProvider: boolean, reason?: AssemblyAIStreamError) => {
    if (session.state === "disposed") return session.closePromise;
    const wasStarting = session.state === "starting";
    session.state = "disposed";
    if (!session.closeSettled) pendingDisposals.add(session);
    clearSessionTimers(session);
    sessions.delete(session.id);
    if (owners.get(ownerKey(session.occurrenceId, session.userId)) === session.id) owners.delete(ownerKey(session.occurrenceId, session.userId));
    if (wasStarting) {
      starting = Math.max(0, starting - 1);
      session.rejectBegin(reason ?? streamError("assemblyai_unavailable", "Meeting transcription is unavailable. Please try again shortly."));
    }
    try { if (notifyProvider && session.socket.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: "Terminate" })); } catch { /* sanitized disposal */ }
    try { session.socket.close(); } catch { /* fallback below */ }
    if (session.socket.readyState === WebSocket.CLOSED) settleClose(session);
    else {
      session.closeTimer = setTimer(() => {
        try { if (session.socket.readyState !== WebSocket.CLOSED) session.socket.terminate(); } catch { /* already closed */ }
        settleClose(session);
      }, ASSEMBLYAI_STREAM_LIMITS.closeGraceMs);
    }
    return session.closePromise;
  };
  const armIdle = (session: Session) => {
    if (session.idleTimer) clearTimer(session.idleTimer);
    session.idleTimer = setTimer(() => dispose(session, true), ASSEMBLYAI_STREAM_LIMITS.idleMs);
  };
  const requireOwned = (input: { sessionId: string; occurrenceId: string; userId: number }) => {
    const session = sessions.get(input.sessionId);
    if (!session) throw streamError("assemblyai_session_missing", "Meeting transcription session is no longer available.");
    if (session.occurrenceId !== input.occurrenceId || session.userId !== input.userId) throw streamError("assemblyai_session_owner", "Meeting transcription session does not belong to this attendee.");
    return session;
  };
  const visibleTurns = (session: Session) => [...session.turns.values()].sort((a, b) => a.turnOrder - b.turnOrder);
  const acceptTurn = (session: Session, message: Record<string, unknown>) => {
    if (session.state !== "ready" || message.type !== "Turn" || message.end_of_turn !== true) return;
    const turnOrder = message.turn_order;
    const text = typeof message.transcript === "string" ? message.transcript.trim() : "";
    const words = message.words;
    if (!Number.isInteger(turnOrder) || (turnOrder as number) < 0 || (turnOrder as number) <= session.acknowledgedTurnOrder || session.seenTurnOrders.has(turnOrder as number) || !text || text.length > 20_000 || !Array.isArray(words) || !words.length) return;
    const times = words.map((word) => {
      if (!word || typeof word !== "object") return null;
      const start = (word as Record<string, unknown>).start;
      const end = (word as Record<string, unknown>).end;
      return typeof start === "number" && Number.isFinite(start) && start >= 0 && typeof end === "number" && Number.isFinite(end) && end >= start ? { start, end } : null;
    });
    if (times.some((time) => time === null)) return;
    if (session.turns.size >= ASSEMBLYAI_STREAM_LIMITS.maxQueuedTurns) {
      dispose(session, true, streamError("assemblyai_output_overflow", "Meeting transcription paused because its output queue filled."));
      return;
    }
    const valid = times as Array<{ start: number; end: number }>;
    if (valid.some((time, index) => index > 0 && (time.start < valid[index - 1].start || time.end < valid[index - 1].end))) return;
    const startsAtMs = Math.round(session.startedAtMs + valid[0].start);
    const endsAtMs = Math.round(session.startedAtMs + valid.at(-1)!.end);
    if (!Number.isSafeInteger(startsAtMs) || !Number.isSafeInteger(endsAtMs) || startsAtMs < 0 || endsAtMs < startsAtMs || endsAtMs > 2_147_483_647) return;
    session.seenTurnOrders.add(turnOrder as number);
    session.turns.set(turnOrder as number, {
      id: randomUUID(), turnOrder: turnOrder as number, text,
      startsAtMs, endsAtMs,
    });
  };

  async function openAssemblyAIStream(input: { occurrenceId: string; userId: number; startedAtMs: number; signal?: AbortSignal }) {
    if (!assemblyAIStreamingAvailable(env)) throw streamError("assemblyai_unavailable", "Meeting transcription is not configured on this server.");
    if (!Number.isFinite(input.startedAtMs) || input.startedAtMs < 0 || input.startedAtMs > 2_147_483_647) throw streamError("assemblyai_invalid_start", "Meeting transcription start time is invalid.");
    input.signal?.throwIfAborted();
    const key = ownerKey(input.occurrenceId, input.userId);
    const existingId = owners.get(key);
    const existing = existingId ? sessions.get(existingId) : undefined;
    if (existing) return existing.state === "ready" ? handle(existing) : existing.beginPromise;
    if (sessions.size >= maxConcurrentStreams || starting >= Math.min(maxConcurrentStreams, ASSEMBLYAI_STREAM_LIMITS.maxStartingSessions)) throw streamError("assemblyai_busy", "Meeting transcription is busy. Please try again shortly.");
    const model = configuredModel(env)!;
    const query = new URLSearchParams({ sample_rate: String(SAMPLE_RATE), encoding: "pcm_s16le", speech_model: model, inactivity_timeout: "15" });
    let resolveBegin!: Session["resolveBegin"];
    let rejectBegin!: Session["rejectBegin"];
    let resolveClose!: Session["resolveClose"];
    const beginPromise = new Promise<AssemblyAIStreamHandle>((resolve, reject) => { resolveBegin = resolve; rejectBegin = reject; });
    const closePromise = new Promise<void>((resolve) => { resolveClose = resolve; });
    const sessionId = randomUUID();
    let socket: WebSocketLike;
    try { socket = webSocketFactory(`${PROVIDER_URL}?${query.toString()}`, { headers: { Authorization: env.ASSEMBLYAI_API_KEY!.trim() } }); }
    catch { throw streamError("assemblyai_unavailable", "Meeting transcription is unavailable. Please try again shortly."); }
    const session: Session = { id: sessionId, occurrenceId: input.occurrenceId, userId: input.userId, startedAtMs: Math.round(input.startedAtMs), socket, state: "starting", beginPromise, resolveBegin, rejectBegin, closePromise, resolveClose, closeSettled: false, nextSendAt: now(), lastSequence: -1, pendingFrames: 0, pendingWriteBytes: 0, acknowledgedTurnOrder: -1, seenTurnOrders: new Set(), turns: new Map() };
    sessions.set(sessionId, session); owners.set(key, sessionId); starting += 1;
    session.beginTimer = setTimer(() => dispose(session, true, streamError("assemblyai_unavailable", "Meeting transcription did not become ready in time.")), ASSEMBLYAI_STREAM_LIMITS.beginTimeoutMs);
    session.lifetimeTimer = setTimer(() => dispose(session, true), ASSEMBLYAI_STREAM_LIMITS.lifetimeMs);
    const cancel = () => dispose(session, true, streamError("assemblyai_cancelled", "Meeting transcription was cancelled."));
    input.signal?.addEventListener("abort", cancel, { once: true });
    socket.on("message", (value: unknown) => {
      if (session.state === "disposed") return;
      const message = parseProviderMessage(value); if (!message) return;
      if (message.type === "Begin" && session.state === "starting") {
        session.state = "ready"; starting = Math.max(0, starting - 1);
        if (session.beginTimer) clearTimer(session.beginTimer); session.beginTimer = undefined;
        armIdle(session); session.resolveBegin(handle(session));
      } else if (message.type === "Termination" || message.type === "Error") {
        dispose(session, true, streamError("assemblyai_unavailable", "Meeting transcription became unavailable. Please try again."));
      } else acceptTurn(session, message);
    });
    socket.on("error", () => dispose(session, true, streamError("assemblyai_unavailable", "Meeting transcription became unavailable. Please try again.")));
    socket.on("close", () => {
      settleClose(session);
      dispose(session, false, streamError("assemblyai_unavailable", "Meeting transcription became unavailable. Please try again."));
    });
    return beginPromise.finally(() => input.signal?.removeEventListener("abort", cancel));
  }

  async function sendAssemblyAIFrame(input: { sessionId: string; occurrenceId: string; userId: number; sequence: number; pcmBase64: string; ackTurnOrder?: number; authorizeAndSend?: (send: () => void) => Promise<void> }) {
    const session = requireOwned(input);
    if (session.state !== "ready") throw streamError("assemblyai_not_ready", "Meeting transcription is not ready.");
    if (input.ackTurnOrder !== undefined) {
      if (!Number.isInteger(input.ackTurnOrder) || input.ackTurnOrder < 0) throw streamError("assemblyai_invalid_ack", "Meeting transcription acknowledgement is invalid.");
      if (input.ackTurnOrder > session.acknowledgedTurnOrder && !session.seenTurnOrders.has(input.ackTurnOrder)) throw streamError("assemblyai_invalid_ack", "Meeting transcription acknowledgement was not issued by this session.");
      session.acknowledgedTurnOrder = Math.max(session.acknowledgedTurnOrder, input.ackTurnOrder);
      for (const order of session.turns.keys()) if (order <= session.acknowledgedTurnOrder) session.turns.delete(order);
      for (const order of session.seenTurnOrders) if (order <= session.acknowledgedTurnOrder) session.seenTurnOrders.delete(order);
    }
    if (!Number.isInteger(input.sequence) || input.sequence < 0) throw streamError("assemblyai_sequence_gap", "Meeting audio frames must be sequential.");
    let audio: Buffer;
    try { audio = Buffer.from(input.pcmBase64, "base64"); } catch { throw streamError("assemblyai_invalid_audio", "Meeting audio frame is invalid."); }
    if (!input.pcmBase64 || audio.toString("base64") !== input.pcmBase64 || audio.length % 2 !== 0 || audio.length < ASSEMBLYAI_STREAM_LIMITS.minFrameMs * 32 || audio.length > ASSEMBLYAI_STREAM_LIMITS.maxFrameMs * 32) throw streamError("assemblyai_invalid_audio", "Meeting audio frames must contain 50 to 1000ms of mono PCM16 audio.");
    const hash = createHash("sha256").update(audio).digest("base64url");
    if (input.sequence === session.lastSequence) {
      if (hash !== session.lastPayloadHash) throw streamError("assemblyai_sequence_conflict", "Meeting audio sequence was reused with different data.");
      armIdle(session); return { turns: visibleTurns(session) };
    }
    if (input.sequence !== session.lastSequence + 1) throw streamError("assemblyai_sequence_gap", "Meeting audio frames must be sequential.");
    if (session.pendingFrames >= ASSEMBLYAI_STREAM_LIMITS.maxQueuedFrames) throw streamError("assemblyai_queue_full", "Meeting transcription is receiving audio too quickly.");
    session.lastSequence = input.sequence; session.lastPayloadHash = hash; session.pendingFrames += 1;
    const durationMs = audio.length / 32;
    const sendAt = Math.max(now(), session.nextSendAt);
    session.nextSendAt = sendAt + durationMs;
    try {
      const delay = Math.max(0, sendAt - now());
      if (delay) await new Promise<void>((resolve) => setTimer(resolve, delay));
      if (session.state !== "ready" || session.socket.readyState !== WebSocket.OPEN) throw streamError("assemblyai_unavailable", "Meeting transcription became unavailable. Please try again.");
      const send = () => {
        if (session.state !== "ready" || sessions.get(session.id) !== session || session.socket.readyState !== WebSocket.OPEN) throw streamError("assemblyai_session_missing", "Meeting transcription session is no longer available.");
        const buffered = typeof session.socket.bufferedAmount === "number" ? session.socket.bufferedAmount : 0;
        if (session.pendingWriteBytes + audio.length > ASSEMBLYAI_STREAM_LIMITS.maxPendingWriteBytes || buffered + audio.length > ASSEMBLYAI_STREAM_LIMITS.maxPendingWriteBytes) {
          dispose(session, true); throw streamError("assemblyai_queue_full", "Meeting transcription paused because the provider audio queue filled.");
        }
        session.pendingWriteBytes += audio.length;
        try {
          session.socket.send(audio, (error) => {
            session.pendingWriteBytes = Math.max(0, session.pendingWriteBytes - audio.length);
            if (error) dispose(session, true, streamError("assemblyai_unavailable", "Meeting transcription became unavailable. Please try again."));
          });
        } catch (error) {
          session.pendingWriteBytes = Math.max(0, session.pendingWriteBytes - audio.length); throw error;
        }
        armIdle(session);
      };
      if (input.authorizeAndSend) await input.authorizeAndSend(send); else send();
      if (session.state !== "ready" || sessions.get(session.id) !== session) throw streamError("assemblyai_session_missing", "Meeting transcription session is no longer available.");
      return { turns: visibleTurns(session) };
    } finally { session.pendingFrames = Math.max(0, session.pendingFrames - 1); }
  }

  async function closeAssemblyAIStream(input: { sessionId: string; occurrenceId: string; userId: number }) {
    const session = requireOwned(input); await dispose(session, true); return { closed: true as const };
  }
  async function closeAllAssemblyAIStreams(occurrenceId?: string) {
    await Promise.all([...sessions.values(), ...pendingDisposals].filter((session) => !occurrenceId || session.occurrenceId === occurrenceId).map((session) => dispose(session, true)));
  }
  return { openAssemblyAIStream, sendAssemblyAIFrame, closeAssemblyAIStream, closeAllAssemblyAIStreams };
}

const defaultManager = createAssemblyAIStreamingManager();
export const openAssemblyAIStream = defaultManager.openAssemblyAIStream;
export const sendAssemblyAIFrame = defaultManager.sendAssemblyAIFrame;
export const closeAssemblyAIStream = defaultManager.closeAssemblyAIStream;
export const closeAllAssemblyAIStreams = defaultManager.closeAllAssemblyAIStreams;
