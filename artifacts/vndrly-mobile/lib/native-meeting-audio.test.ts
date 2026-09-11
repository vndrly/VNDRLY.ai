import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ native: null as any, platform: "ios" }));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => env.native,
}));
vi.mock("react-native", () => ({ Platform: { get OS() { return env.platform; } } }));

import { createNativeMeetingAudioSession } from "./native-meeting-audio";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function nativeModule() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  return {
    createSession: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    setTranscription: vi.fn(async () => undefined),
    acknowledgeFrame: vi.fn(async () => undefined),
    createOffer: vi.fn(async () => undefined),
    applySignal: vi.fn(async () => undefined),
    removePeer: vi.fn(async () => undefined),
    invalidateSession: vi.fn(),
    addListener: vi.fn((name: string, callback: (event: any) => void) => {
      const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set);
      return { remove: () => set.delete(callback) };
    }),
    emit(name: string, event: unknown) { listeners.get(name)?.forEach(listener => listener(event)); },
  };
}

function streamingClient() {
  return {
    open: vi.fn(async () => ({ sessionId: "stream-1", sampleRate: 16000, frameDurationMs: 500 })),
    sendBase64AndPersist: vi.fn(async () => undefined),
    persistTurn: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

beforeEach(() => { env.native = nativeModule(); env.platform = "ios"; });

describe("native meeting audio adapter", () => {
  it("fails visibly on iOS without the selected native module", () => {
    env.native = null;
    expect(() => createNativeMeetingAudioSession({ occurrenceId: "room", generation: 1 }))
      .toThrowError(expect.objectContaining({ code: "NATIVE_MEETING_AUDIO_UNAVAILABLE" }));
  });

  it("returns the legacy-selection signal only on Android", () => {
    env.platform = "android";
    env.native = null;
    expect(createNativeMeetingAudioSession({ occurrenceId: "room", generation: 1 })).toBeNull();
  });

  it("serializes provider uploads and returns native credits in strict sequence order", async () => {
    const stream = streamingClient();
    const first = deferred<undefined>();
    stream.sendBase64AndPersist.mockImplementationOnce(() => first.promise);
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 11, streamingClient: stream as any })!;
    await session.start({ sourceId: "track-11", iceServers: [] });
    await session.setTranscription(true, 4);
    const frame = (sequence: number) => ({ generation: 11, sourceId: "track-11", policyRevision: 4,
      sequence, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: sequence * 8000 });
    env.native.emit("onMeetingPCMFrame", frame(0));
    env.native.emit("onMeetingPCMFrame", frame(1));
    await vi.waitFor(() => expect(stream.sendBase64AndPersist).toHaveBeenCalledTimes(1));
    expect(stream.sendBase64AndPersist).toHaveBeenNthCalledWith(1, 0, "AA==", expect.any(Function), expect.any(AbortSignal));
    expect(env.native.acknowledgeFrame).not.toHaveBeenCalled();
    first.resolve(undefined);
    await vi.waitFor(() => expect(stream.sendBase64AndPersist).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(env.native.acknowledgeFrame).toHaveBeenCalledTimes(2));
    expect(stream.sendBase64AndPersist).toHaveBeenNthCalledWith(2, 1, "AA==", expect.any(Function), expect.any(AbortSignal));
    expect(env.native.acknowledgeFrame.mock.calls.map((call: any[]) => call[0].sequence)).toEqual([0, 1]);
  });

  it("creates exactly one inert native meeting session and does not enable capture or transcription", async () => {
    const stream = streamingClient();
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 7, streamingClient: stream as any })!;
    await session.start({ sourceId: "local-track", iceServers: [{ urls: "turn:vndrly.test" }] });
    expect(env.native.createSession).toHaveBeenCalledOnce();
    expect(env.native.createSession).toHaveBeenCalledWith({ occurrenceId: "room", generation: 7, sourceId: "local-track", iceServers: [{ urls: "turn:vndrly.test" }] });
    expect(env.native.setMuted).not.toHaveBeenCalled();
    expect(env.native.setTranscription).not.toHaveBeenCalled();
    expect(stream.open).not.toHaveBeenCalled();
  });

  it("opens the authenticated stream before allowing native PCM and persists each frame before returning its credit", async () => {
    const stream = streamingClient();
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 3, streamingClient: stream as any })!;
    await session.start({ sourceId: "track-3", iceServers: [] });
    await session.setTranscription(true, 12);
    expect(stream.open.mock.invocationCallOrder[0]).toBeLessThan(env.native.setTranscription.mock.invocationCallOrder[0]);
    expect(env.native.setTranscription).toHaveBeenCalledWith({ generation: 3, enabled: true, policyRevision: 12 });

    env.native.emit("onMeetingPCMFrame", { generation: 3, sourceId: "track-3", policyRevision: 12, sequence: 0, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 0 });
    await vi.waitFor(() => expect(stream.sendBase64AndPersist).toHaveBeenCalledOnce());
    expect(stream.sendBase64AndPersist).toHaveBeenCalledWith(0, "AA==", expect.any(Function), expect.any(AbortSignal));
    expect(env.native.acknowledgeFrame).toHaveBeenCalledWith({ generation: 3, sequence: 0 });
    expect(stream.sendBase64AndPersist.mock.invocationCallOrder[0]).toBeLessThan(env.native.acknowledgeFrame.mock.invocationCallOrder[0]);
  });

  it("rejects stale, reordered, malformed, or discontinuous frames and invalidates before closing", async () => {
    const stream = streamingClient();
    const errors: string[] = [];
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 9, streamingClient: stream as any, onError: code => errors.push(code) })!;
    await session.start({ sourceId: "track-9", iceServers: [] });
    await session.setTranscription(true, 2);
    env.native.emit("onMeetingPCMFrame", { generation: 8, sourceId: "track-9", policyRevision: 2, sequence: 0, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 0 });
    env.native.emit("onMeetingPCMFrame", { generation: 9, sourceId: "track-9", policyRevision: 2, sequence: 1, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 0 });
    await vi.waitFor(() => expect(errors).toContain("AUDIO_SEQUENCE_GAP"));
    expect(env.native.invalidateSession).toHaveBeenCalledWith({ generation: 9 });
    expect(stream.sendBase64AndPersist).not.toHaveBeenCalled();
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it("bounds outstanding native frames and fails closed instead of growing the React queue", async () => {
    const stream = streamingClient();
    const pending = deferred<undefined>();
    stream.sendBase64AndPersist.mockReturnValue(pending.promise);
    const errors: string[] = [];
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 4, streamingClient: stream as any, onError: code => errors.push(code) })!;
    await session.start({ sourceId: "track-4", iceServers: [] });
    await session.setTranscription(true, 1);
    for (let sequence = 0; sequence < 3; sequence += 1) {
      env.native.emit("onMeetingPCMFrame", { generation: 4, sourceId: "track-4", policyRevision: 1, sequence, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: sequence * 8000 });
    }
    await vi.waitFor(() => expect(errors).toContain("AUDIO_BACKPRESSURE"));
    expect(env.native.invalidateSession).toHaveBeenCalledWith({ generation: 4 });
    pending.resolve(undefined);
  });

  it("invalidates synchronously, aborts late uploads, closes the provider, and never acknowledges after stop", async () => {
    const stream = streamingClient();
    const pending = deferred<undefined>();
    stream.sendBase64AndPersist.mockReturnValue(pending.promise);
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 5, streamingClient: stream as any })!;
    await session.start({ sourceId: "track-5", iceServers: [] });
    await session.setTranscription(true, 1);
    env.native.emit("onMeetingPCMFrame", { generation: 5, sourceId: "track-5", policyRevision: 1, sequence: 0, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 0 });
    await vi.waitFor(() => expect(stream.sendBase64AndPersist).toHaveBeenCalledOnce());
    const stopping = session.stop();
    expect(env.native.invalidateSession).toHaveBeenCalledWith({ generation: 5 });
    expect(((stream.sendBase64AndPersist.mock.calls[0] as unknown[])?.[3] as AbortSignal).aborted).toBe(true);
    pending.resolve(undefined); await stopping;
    expect(stream.close).toHaveBeenCalledOnce();
    expect(env.native.acknowledgeFrame).not.toHaveBeenCalled();
    env.native.emit("onMeetingPCMFrame", { generation: 5, sourceId: "track-5", policyRevision: 1, sequence: 1, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 8000 });
    expect(stream.sendBase64AndPersist).toHaveBeenCalledOnce();
  });

  it("rejects a queued frame from an earlier transcription policy after restart", async () => {
    const stream = streamingClient();
    const errors: string[] = [];
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 6, streamingClient: stream as any, onError: code => errors.push(code) })!;
    await session.start({ sourceId: "track-6", iceServers: [] });
    await session.setTranscription(true, 10);
    await session.setTranscription(false, 11);
    await session.setTranscription(true, 12);
    env.native.emit("onMeetingPCMFrame", { generation: 6, sourceId: "track-6", policyRevision: 10, sequence: 0, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 0 });
    await vi.waitFor(() => expect(errors).toContain("AUDIO_POLICY_CHANGED"));
    expect(stream.sendBase64AndPersist).not.toHaveBeenCalled();
  });

  it("aborts an in-flight provider upload when transcription is explicitly disabled", async () => {
    const stream = streamingClient();
    const pending = deferred<undefined>();
    stream.sendBase64AndPersist.mockReturnValue(pending.promise);
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 8, streamingClient: stream as any })!;
    await session.start({ sourceId: "track-8", iceServers: [] });
    await session.setTranscription(true, 20);
    env.native.emit("onMeetingPCMFrame", { generation: 8, sourceId: "track-8", policyRevision: 20, sequence: 0, pcmBase64: "AA==", sampleRate: 16000, channels: 1, sampleCount: 8000, firstSample: 0 });
    await vi.waitFor(() => expect(stream.sendBase64AndPersist).toHaveBeenCalledOnce());
    const uploadSignal = (stream.sendBase64AndPersist.mock.calls[0] as unknown[])[3] as AbortSignal;
    await session.setTranscription(false, 21);
    expect(uploadSignal.aborted).toBe(true);
    pending.resolve(undefined);
    await Promise.resolve();
    expect(env.native.acknowledgeFrame).not.toHaveBeenCalled();
  });

  it("cancels a pending provider start when the user mutes without failing the audio room", async () => {
    const stream = streamingClient();
    (stream.open as any).mockImplementation((signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    const errors: string[] = [];
    const session = createNativeMeetingAudioSession({ occurrenceId: "room", generation: 10, streamingClient: stream as any, onError: code => errors.push(code) })!;
    await session.start({ sourceId: "track-10", iceServers: [] });

    const enabling = session.setTranscription(true, 30);
    await vi.waitFor(() => expect(stream.open).toHaveBeenCalledOnce());
    await session.setMuted(true);
    await enabling;

    expect(env.native.setTranscription).toHaveBeenCalledWith({ generation: 10, enabled: false, policyRevision: 0 });
    expect(stream.close).toHaveBeenCalledOnce();
    expect(env.native.invalidateSession).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});
