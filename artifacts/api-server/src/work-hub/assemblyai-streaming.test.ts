import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSEMBLYAI_STREAM_LIMITS,
  AssemblyAIStreamError,
  assemblyAIStreamingAvailable,
  assemblyAITrainingAllowed,
  createAssemblyAIStreamingManager,
} from "./assemblyai-streaming";

const env: Record<string, string> = {
  VNDRLY_MEETING_STT_PROVIDER: "assemblyai",
  ASSEMBLYAI_API_KEY: "fake-test-key",
  ASSEMBLYAI_MODEL_TRAINING_ALLOWED: "1",
};

class Socket extends EventEmitter {
  static readonly OPEN = 1;
  readyState = Socket.OPEN;
  bufferedAmount = 0;
  completeWrites = true;
  sent: Array<string | Buffer> = [];
  close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
  terminate = vi.fn(() => { this.readyState = 3; });
  send(value: string | Buffer, callback?: (error?: Error) => void) { this.sent.push(value); if (this.completeWrites) queueMicrotask(() => callback?.()); }
  message(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value))); }
}

function pcm(ms = 500, fill = 1) {
  return Buffer.alloc(ms * 32, fill).toString("base64");
}

function setup(runtimeEnv = env) {
  const sockets: Socket[] = [];
  const factory = vi.fn((_url: string, _options: { headers: Record<string, string> }) => {
    const socket = new Socket(); sockets.push(socket); queueMicrotask(() => socket.emit("open")); return socket;
  });
  const manager = createAssemblyAIStreamingManager({
    env: runtimeEnv,
    webSocketFactory: factory,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer),
  });
  return { manager, sockets, factory };
}

async function openReady(setupResult: ReturnType<typeof setup>, occurrenceId = "meeting-a", userId = 7) {
  const socketIndex = setupResult.sockets.length;
  const pending = setupResult.manager.openAssemblyAIStream({ occurrenceId, userId, startedAtMs: 12_000 });
  await vi.waitFor(() => expect(setupResult.sockets).toHaveLength(socketIndex + 1));
  setupResult.sockets[socketIndex].message({ type: "Begin", id: "provider-session" });
  return pending;
}

describe("AssemblyAI streaming boundary", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("is disabled unless provider, key, and explicit trial training approval are all configured", () => {
    expect(assemblyAIStreamingAvailable(env)).toBe(true);
    expect(assemblyAITrainingAllowed(env)).toBe(true);
    expect(assemblyAIStreamingAvailable({ ...env, VNDRLY_MEETING_STT_PROVIDER: "native" })).toBe(false);
    expect(assemblyAIStreamingAvailable({ ...env, ASSEMBLYAI_API_KEY: "" })).toBe(false);
    expect(assemblyAIStreamingAvailable({ ...env, ASSEMBLYAI_MODEL_TRAINING_ALLOWED: "0" })).toBe(false);
  });

  it("uses the fixed authenticated provider URL and waits for Begin", async () => {
    const state = setup();
    let resolved = false;
    const pending = state.manager.openAssemblyAIStream({ occurrenceId: "meeting-a", userId: 7, startedAtMs: 0 }).then((value) => { resolved = true; return value; });
    await vi.waitFor(() => expect(state.factory).toHaveBeenCalledOnce());
    expect(resolved).toBe(false);
    expect(state.factory.mock.calls[0]).toEqual([
      "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&speech_model=universal-streaming-multilingual&inactivity_timeout=15",
      { headers: { Authorization: "fake-test-key" } },
    ]);
    state.sockets[0].message({ type: "Begin", id: "provider-session" });
    await expect(pending).resolves.toMatchObject({ sampleRate: 16000, frameDurationMs: 500 });
  });

  it("keeps one paid stream per attendee and sends two frames in order with real-time pacing", async () => {
    const state = setup();
    const opened = await openReady(state);
    const duplicate = await state.manager.openAssemblyAIStream({ occurrenceId: "meeting-a", userId: 7, startedAtMs: 99_000 });
    expect(duplicate.sessionId).toBe(opened.sessionId);
    expect(state.sockets).toHaveLength(1);
    const first = state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() });
    await expect(first).resolves.toEqual({ turns: [] });
    const second = state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 1, pcmBase64: pcm(500, 2) });
    await vi.advanceTimersByTimeAsync(424);
    expect(state.sockets[0].sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(76);
    await expect(second).resolves.toEqual({ turns: [] });
    expect(state.sockets[0].sent).toEqual([Buffer.from(pcm(), "base64"), Buffer.from(pcm(500, 2), "base64")]);
  });

  it("defaults to the verified trial concurrency and permits an explicit bounded override", async () => {
    const trial = setup();
    for (let userId = 1; userId <= 5; userId += 1) await openReady(trial, `meeting-${userId}`, userId);
    await expect(trial.manager.openAssemblyAIStream({ occurrenceId: "meeting-6", userId: 6, startedAtMs: 0 }))
      .rejects.toMatchObject({ code: "assemblyai_busy" });
    expect(trial.sockets).toHaveLength(5);

    const raised = setup({ ...env, ASSEMBLYAI_MAX_CONCURRENT_STREAMS: "6" });
    for (let userId = 1; userId <= 6; userId += 1) await openReady(raised, `meeting-${userId}`, userId);
    expect(raised.sockets).toHaveLength(6);
  });

  it("makes an exact retry idempotent but rejects an altered replay or sequence gap", async () => {
    const state = setup(); const opened = await openReady(state);
    const frame = { ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() };
    await state.manager.sendAssemblyAIFrame(frame);
    await expect(state.manager.sendAssemblyAIFrame(frame)).resolves.toEqual({ turns: [] });
    expect(state.sockets[0].sent).toHaveLength(1);
    await expect(state.manager.sendAssemblyAIFrame({ ...frame, pcmBase64: pcm(500, 8) })).rejects.toMatchObject({ code: "assemblyai_sequence_conflict" });
    await expect(state.manager.sendAssemblyAIFrame({ ...frame, sequence: 2 })).rejects.toMatchObject({ code: "assemblyai_sequence_gap" });
  });

  it("checks owner boundaries before disclosing queued turns", async () => {
    const state = setup(); const opened = await openReady(state);
    await expect(state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "other", userId: 7, sequence: 0, pcmBase64: pcm() })).rejects.toMatchObject({ code: "assemblyai_session_owner" });
    await expect(state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "meeting-a", userId: 8, sequence: 0, pcmBase64: pcm() })).rejects.toMatchObject({ code: "assemblyai_session_owner" });
  });

  it("validates, deduplicates, and retains final turns until acknowledged", async () => {
    const state = setup(); const opened = await openReady(state); const socket = state.sockets[0];
    socket.message({ type: "Turn", turn_order: 3, end_of_turn: false, transcript: "partial", words: [{ start: 1, end: 2 }] });
    socket.message({ type: "Turn", turn_order: 4, end_of_turn: true, transcript: "", words: [] });
    socket.message({ type: "Turn", turn_order: 5, end_of_turn: true, transcript: "Crew arrived.", words: [{ start: 250, end: 900 }] });
    socket.message({ type: "Turn", turn_order: 5, end_of_turn: true, transcript: "Crew arrived.", words: [{ start: 250, end: 900 }], turn_is_formatted: true });
    const frame = { ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() };
    const first = await state.manager.sendAssemblyAIFrame(frame);
    expect(first.turns).toEqual([{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), turnOrder: 5, text: "Crew arrived.", startsAtMs: 12_250, endsAtMs: 12_900 }]);
    expect((await state.manager.sendAssemblyAIFrame(frame)).turns).toEqual(first.turns);
    expect((await state.manager.sendAssemblyAIFrame({ ...frame, ackTurnOrder: 5 })).turns).toEqual([]);
    socket.message({ type: "Turn", turn_order: 5, end_of_turn: true, transcript: "Crew arrived.", words: [{ start: 250, end: 900 }], turn_is_formatted: true });
    expect((await state.manager.sendAssemblyAIFrame({ ...frame, ackTurnOrder: 5 })).turns).toEqual([]);
  });

  it("bounds provider-buffered and callback-pending audio instead of retaining a meeting", async () => {
    const state = setup(); const opened = await openReady(state); const socket = state.sockets[0];
    socket.bufferedAmount = ASSEMBLYAI_STREAM_LIMITS.maxPendingWriteBytes;
    await expect(state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm(1_000) })).rejects.toMatchObject({ code: "assemblyai_queue_full" });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));

    const stalled = setup(); const second = await openReady(stalled); stalled.sockets[0].completeWrites = false;
    await stalled.manager.sendAssemblyAIFrame({ ...second, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm(1_000) });
    const next = stalled.manager.sendAssemblyAIFrame({ ...second, occurrenceId: "meeting-a", userId: 7, sequence: 1, pcmBase64: pcm(1_000, 2) });
    await vi.advanceTimersByTimeAsync(1_000); await next;
    const overflow = stalled.manager.sendAssemblyAIFrame({ ...second, occurrenceId: "meeting-a", userId: 7, sequence: 2, pcmBase64: pcm(1_000, 3) });
    const rejected = expect(overflow).rejects.toMatchObject({ code: "assemblyai_queue_full" });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it("rejects reversed or persistence-overflowing provider word times", async () => {
    const state = setup(); const opened = await openReady(state); const socket = state.sockets[0];
    socket.message({ type: "Turn", turn_order: 1, end_of_turn: true, transcript: "reversed", words: [{ start: 100, end: 200 }, { start: 50, end: 60 }] });
    socket.message({ type: "Turn", turn_order: 2, end_of_turn: true, transcript: "huge", words: [{ start: 2_147_483_640, end: 2_147_483_647 }] });
    const result = await state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() });
    expect(result.turns).toEqual([]);
  });

  it("does not write or return turns if the session is disposed while final authorization is pending", async () => {
    const state = setup(); const opened = await openReady(state); const socket = state.sockets[0];
    let authorize!: () => void; let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { authorize = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const sending = state.manager.sendAssemblyAIFrame({
      ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm(),
      authorizeAndSend: async (send) => { entered(); await waiting; send(); },
    });
    await started; await state.manager.closeAssemblyAIStream({ ...opened, occurrenceId: "meeting-a", userId: 7 }); authorize();
    await expect(sending).rejects.toMatchObject({ code: "assemblyai_session_missing" });
    expect(socket.sent.filter(Buffer.isBuffer)).toEqual([]);
  });

  it("ignores late messages and explicitly terminates on close and shutdown", async () => {
    const state = setup(); const first = await openReady(state); const socket = state.sockets[0];
    await state.manager.closeAssemblyAIStream({ ...first, occurrenceId: "meeting-a", userId: 7 });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
    socket.message({ type: "Turn", turn_order: 1, end_of_turn: true, transcript: "late", words: [{ start: 0, end: 1 }] });
    await expect(state.manager.sendAssemblyAIFrame({ ...first, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() })).rejects.toMatchObject({ code: "assemblyai_session_missing" });
    const second = await openReady(state, "meeting-b", 8);
    await state.manager.closeAllAssemblyAIStreams();
    expect(state.sockets[1].sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
    await expect(state.manager.closeAssemblyAIStream({ ...second, occurrenceId: "meeting-b", userId: 8 })).rejects.toMatchObject({ code: "assemblyai_session_missing" });
  });

  it("keeps shutdown pending until provider sockets close or the terminate fallback completes", async () => {
    const state = setup(); await openReady(state); const socket = state.sockets[0];
    socket.close.mockImplementation(() => undefined);
    let settled = false;
    const closing = state.manager.closeAllAssemblyAIStreams().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
    await vi.advanceTimersByTimeAsync(ASSEMBLYAI_STREAM_LIMITS.closeGraceMs);
    await closing;
    expect(socket.terminate).toHaveBeenCalledOnce();
  });

  it.each(["close", "fallback"] as const)("drains already-disposing and active sockets for concurrent shutdown callers via %s", async (completion) => {
    vi.useFakeTimers();
    const state = setup(); const first = await openReady(state);
    await openReady(state, "meeting-b", 8);
    for (const socket of state.sockets) socket.close.mockImplementation(() => undefined);
    const completed: string[] = [];
    const explicitClose = state.manager.closeAssemblyAIStream({ ...first, occurrenceId: "meeting-a", userId: 7 }).then(() => { completed.push("explicit"); });
    const shutdown = state.manager.closeAllAssemblyAIStreams().then(() => { completed.push("shutdown"); });
    const otherShutdown = state.manager.closeAllAssemblyAIStreams().then(() => { completed.push("other shutdown"); });
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toEqual([]);
    await expect(state.manager.sendAssemblyAIFrame({ ...first, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() })).rejects.toMatchObject({ code: "assemblyai_session_missing" });

    if (completion === "close") {
      state.sockets[1].readyState = 3; state.sockets[1].emit("close");
      await vi.advanceTimersByTimeAsync(0);
      expect(completed).toEqual([]);
      state.sockets[0].readyState = 3; state.sockets[0].emit("close");
    } else {
      await vi.advanceTimersByTimeAsync(999);
      expect(completed).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
    }
    await Promise.all([explicitClose, shutdown, otherShutdown]);
    expect(completed.sort()).toEqual(["explicit", "other shutdown", "shutdown"]);
    for (const socket of state.sockets) {
      expect(socket.sent).toEqual([JSON.stringify({ type: "Terminate" })]);
      expect(socket.close).toHaveBeenCalledOnce();
      expect(socket.terminate).toHaveBeenCalledTimes(completion === "fallback" ? 1 : 0);
    }
    await state.manager.closeAllAssemblyAIStreams();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drains already-disposing sockets only for the requested occurrence", async () => {
    vi.useFakeTimers();
    const state = setup(); await openReady(state);
    await openReady(state, "meeting-b", 8);
    const unrelated = await openReady(state, "meeting-c", 9);
    state.sockets[0].close.mockImplementation(() => undefined);
    state.sockets[1].close.mockImplementation(() => undefined);
    const firstMute = state.manager.closeAllAssemblyAIStreams("meeting-a");
    const otherMute = state.manager.closeAllAssemblyAIStreams("meeting-b");
    let scopedDone = false;
    let otherDone = false;
    const repeatedMute = state.manager.closeAllAssemblyAIStreams("meeting-a").then(() => { scopedDone = true; });
    const repeatedOther = state.manager.closeAllAssemblyAIStreams("meeting-b").then(() => { otherDone = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(scopedDone).toBe(false);
    expect(otherDone).toBe(false);
    state.sockets[0].readyState = 3; state.sockets[0].emit("close");
    await Promise.all([firstMute, repeatedMute]);
    expect(scopedDone).toBe(true);
    expect(otherDone).toBe(false);
    await expect(state.manager.sendAssemblyAIFrame({ ...unrelated, occurrenceId: "meeting-c", userId: 9, sequence: 0, pcmBase64: pcm() })).resolves.toEqual({ turns: [] });
    expect(state.sockets[2].sent).toEqual([Buffer.from(pcm(), "base64")]);
    const shutdown = state.manager.closeAllAssemblyAIStreams();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([otherMute, repeatedOther, shutdown]);
    expect(otherDone).toBe(true);
    expect(state.sockets[0].terminate).not.toHaveBeenCalled();
    expect(state.sockets[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds queues and closes idle, failed, and over-lifetime sessions without leaking provider diagnostics", async () => {
    expect(ASSEMBLYAI_STREAM_LIMITS.maxQueuedFrames).toBe(4);
    expect(ASSEMBLYAI_STREAM_LIMITS.maxQueuedTurns).toBe(100);
    const state = setup(); const opened = await openReady(state); const socket = state.sockets[0];
    socket.emit("error", new Error("fake-test-key private upstream detail"));
    await expect(state.manager.sendAssemblyAIFrame({ ...opened, occurrenceId: "meeting-a", userId: 7, sequence: 0, pcmBase64: pcm() })).rejects.toSatisfy((error: AssemblyAIStreamError) => error.code === "assemblyai_session_missing" && !error.message.includes("fake-test-key"));
    const idle = await openReady(state, "meeting-idle", 9);
    await vi.advanceTimersByTimeAsync(ASSEMBLYAI_STREAM_LIMITS.idleMs + 1);
    expect(state.sockets[1].sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
    await expect(state.manager.closeAssemblyAIStream({ ...idle, occurrenceId: "meeting-idle", userId: 9 })).rejects.toMatchObject({ code: "assemblyai_session_missing" });
  });
});
