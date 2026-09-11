import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("./api", () => ({
  apiFetch: (...args: unknown[]) => env.apiFetch(...args),
}));

import { createMobileMeetingStreamingClient } from "./meeting-streaming";

const HANDLE = { sessionId: "stream-1", sampleRate: 16000 as const, frameDurationMs: 500 as const };
const TURN = {
  id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02",
  turnOrder: 3,
  text: "Crew arrived",
  startsAtMs: 1,
  endsAtMs: 2,
};

function taggedError(properties: { status?: number; code?: string }) {
  return Object.assign(new Error(properties.code ?? `HTTP ${properties.status}`), properties);
}

function createNativeAbortController() {
  const localRequire = createRequire(import.meta.url);
  const requireFromReactNative = createRequire(localRequire.resolve("react-native/package.json"));
  const { AbortController: NativeAbortController } = requireFromReactNative("abort-controller/dist/abort-controller") as {
    AbortController: new () => { signal: AbortSignal; abort(): void };
  };
  return new NativeAbortController();
}

beforeEach(() => {
  env.apiFetch.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mobile meeting streaming transport", () => {
  it("is inert until open and sends the start request only through apiFetch", async () => {
    const rawFetch = vi.fn(() => { throw new Error("raw fetch must not be used"); });
    vi.stubGlobal("fetch", rawFetch);
    env.apiFetch.mockResolvedValue(HANDLE);
    const client = createMobileMeetingStreamingClient("meeting / one");

    expect(env.apiFetch).not.toHaveBeenCalled();
    expect(rawFetch).not.toHaveBeenCalled();

    const signal = new AbortController().signal;
    await expect(client.open(signal)).resolves.toEqual(HANDLE);
    expect(env.apiFetch).toHaveBeenCalledOnce();
    expect(env.apiFetch).toHaveBeenCalledWith(
      "/api/work-hub/meetings/meeting%20%2F%20one/transcription-stream",
      { method: "POST", body: "{}", signal },
    );
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("encodes empty, edge-length, and every byte value without browser or Node globals", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("btoa", undefined);
    vi.stubGlobal("Buffer", undefined);
    env.apiFetch.mockImplementation(async (path: string) => path.endsWith("/frame") ? { turns: [] } : HANDLE);
    const client = createMobileMeetingStreamingClient("meeting");
    const signal = new AbortController().signal;
    await client.open(signal);

    const cases: Array<[Uint8Array, string]> = [
      [new Uint8Array(), ""],
      [new Uint8Array([0]), "AA=="],
      [new Uint8Array([0, 1]), "AAE="],
      [new Uint8Array([0, 1, 2]), "AAEC"],
      [new Uint8Array(Array.from({ length: 256 }, (_, index) => index)), "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w=="],
    ];
    for (const [sequence, [pcm, expected]] of cases.entries()) {
      await client.sendAndPersist(sequence, pcm, async () => undefined, signal);
      const frameCall = env.apiFetch.mock.calls.filter(([path]) => String(path).endsWith("/frame")).at(-1);
      expect(JSON.parse(String(frameCall?.[1]?.body))).toEqual({ sequence, pcmBase64: expected });
    }
  });

  it("forwards a native PCM16 frame without decoding and re-encoding it", async () => {
    env.apiFetch.mockImplementation(async (path: string) => path.endsWith("/frame") ? { turns: [] } : HANDLE);
    const client = createMobileMeetingStreamingClient("meeting");
    const signal = new AbortController().signal;
    await client.open(signal);

    await client.sendBase64AndPersist(4, "AP8BAg==", async () => undefined, signal);

    expect(JSON.parse(String(env.apiFetch.mock.calls.at(-1)?.[1]?.body))).toEqual({
      sequence: 4,
      pcmBase64: "AP8BAg==",
    });
  });

  it("supports React Native's installed abort-controller signal without DOMException", async () => {
    vi.stubGlobal("DOMException", undefined);
    env.apiFetch.mockResolvedValue(HANDLE);
    const client = createMobileMeetingStreamingClient("meeting");
    const controller = createNativeAbortController();
    await client.open(controller.signal);
    controller.abort();

    await expect(client.sendAndPersist(0, new Uint8Array(), async () => undefined, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(env.apiFetch).toHaveBeenCalledOnce();
  });

  it("detects active cancellation from React Native's installed abort-controller signal", async () => {
    vi.stubGlobal("DOMException", undefined);
    const controller = createNativeAbortController();
    env.apiFetch
      .mockResolvedValueOnce(HANDLE)
      .mockImplementationOnce(async () => {
        controller.abort();
        return { turns: [] };
      });
    const client = createMobileMeetingStreamingClient("meeting");
    await client.open(controller.signal);

    await expect(client.sendAndPersist(0, new Uint8Array(), async () => undefined, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(env.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("persists sorted turns once before sending their acknowledgement", async () => {
    const earlier = { ...TURN, id: "837e79c8-b33b-4077-8d4c-6b1fa877b72c", turnOrder: 1, text: "Earlier" };
    const events: string[] = [];
    let frames = 0;
    env.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (!path.endsWith("/frame")) return HANDLE;
      const body = JSON.parse(String(init?.body));
      events.push(body.ackTurnOrder === undefined ? "frame" : `ack:${body.ackTurnOrder}`);
      frames += 1;
      return { turns: frames === 1 ? [TURN, earlier] : [TURN, earlier] };
    });
    const client = createMobileMeetingStreamingClient("meeting");
    const signal = new AbortController().signal;
    await client.open(signal);

    const persist = vi.fn(async (turn: typeof TURN) => { events.push(`persist:${turn.turnOrder}`); });
    await client.sendAndPersist(7, new Uint8Array([1, 2, 3]), persist, signal);

    expect(persist.mock.calls.map(([turn]) => turn.turnOrder)).toEqual([1, 3]);
    expect(events).toEqual(["frame", "persist:1", "persist:3", "ack:3"]);
    expect(JSON.parse(String(env.apiFetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ sequence: 7, pcmBase64: "AQID", ackTurnOrder: 3 });
  });

  it("starts a reopened provider session with fresh acknowledgement and persistence state", async () => {
    const secondTurn = { ...TURN, id: "3b056aba-ef08-48ba-8dde-f28f48bf5d4f", text: "After restart" };
    let starts = 0;
    let frames = 0;
    env.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/close")) return { closed: true };
      if (!path.endsWith("/frame")) {
        starts += 1;
        return { ...HANDLE, sessionId: `stream-${starts}` };
      }
      frames += 1;
      return { turns: frames === 1 ? [TURN] : frames === 3 ? [secondTurn] : [] };
    });
    const client = createMobileMeetingStreamingClient("meeting");
    const persist = vi.fn(async (_turn: typeof TURN) => undefined);

    await client.open(new AbortController().signal);
    await client.sendBase64AndPersist(0, "AA==", persist, new AbortController().signal);
    await client.close();
    await client.open(new AbortController().signal);
    await client.sendBase64AndPersist(0, "AA==", persist, new AbortController().signal);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls.map(([turn]) => turn.id)).toEqual([TURN.id, secondTurn.id]);
    const frameBodies = env.apiFetch.mock.calls
      .filter(([path]) => String(path).endsWith("/frame"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(frameBodies[2]).toEqual({ sequence: 0, pcmBase64: "AA==" });
  });

  it("retries one unreachable frame with the exact same identity", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("DOMException", undefined);
    const unreachable = taggedError({ code: "network.unreachable" });
    env.apiFetch
      .mockResolvedValueOnce(HANDLE)
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce({ turns: [] });
    const client = createMobileMeetingStreamingClient("meeting");
    const controller = createNativeAbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await client.open(controller.signal);

    const sending = client.sendAndPersist(9, new Uint8Array([255, 0]), async () => undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(250);
    await sending;

    const frameCalls = env.apiFetch.mock.calls.slice(1);
    expect(frameCalls).toHaveLength(2);
    expect(frameCalls[0][0]).toBe(frameCalls[1][0]);
    expect(frameCalls[0][1]?.body).toBe(frameCalls[1][1]?.body);
    expect(JSON.parse(String(frameCalls[0][1]?.body))).toEqual({ sequence: 9, pcmBase64: "/wA=" });
    const abortListener = add.mock.calls.find(([type]) => type === "abort")?.[1];
    expect(abortListener).toBeDefined();
    expect(remove).toHaveBeenCalledWith("abort", abortListener);
  });

  it("cancels React Native's retry delay without a later request or retained timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("DOMException", undefined);
    const unreachable = taggedError({ code: "network.unreachable" });
    env.apiFetch.mockResolvedValueOnce(HANDLE).mockRejectedValueOnce(unreachable);
    const client = createMobileMeetingStreamingClient("meeting");
    const controller = createNativeAbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await client.open(controller.signal);

    const sending = client.sendAndPersist(0, new Uint8Array(), async () => undefined, controller.signal);
    for (let tick = 0; tick < 5 && !add.mock.calls.some(([type]) => type === "abort"); tick += 1) {
      await Promise.resolve();
    }
    expect(add.mock.calls.some(([type]) => type === "abort")).toBe(true);
    controller.abort();
    await expect(sending).rejects.toMatchObject({ name: "AbortError" });
    expect(remove.mock.calls.some(([type]) => type === "abort")).toBe(true);
    expect(env.apiFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(env.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("retries one unreachable transcript save with the same turn id before acknowledgement", async () => {
    vi.useFakeTimers();
    const unreachable = taggedError({ code: "network.unreachable" });
    env.apiFetch
      .mockResolvedValueOnce(HANDLE)
      .mockResolvedValueOnce({ turns: [TURN] })
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce({ saved: true })
      .mockResolvedValueOnce({ turns: [] });
    const client = createMobileMeetingStreamingClient("meeting");
    const signal = new AbortController().signal;
    await client.open(signal);

    const sending = client.sendAndPersist(0, new Uint8Array(), (turn, currentSignal) => client.persistTurn(turn, currentSignal), signal);
    await vi.advanceTimersByTimeAsync(250);
    await sending;

    const transcriptCalls = env.apiFetch.mock.calls.filter(([path]) => String(path).endsWith("/transcript"));
    expect(transcriptCalls).toHaveLength(2);
    expect(transcriptCalls[0][1]?.body).toBe(transcriptCalls[1][1]?.body);
    expect(JSON.parse(String(transcriptCalls[0][1]?.body))).toEqual({ id: TURN.id, text: TURN.text, startsAtMs: 1, endsAtMs: 2 });
    expect(JSON.parse(String(env.apiFetch.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ ackTurnOrder: 3 });
  });

  it.each([
    taggedError({ status: 401, code: "auth.unauthenticated" }),
    taggedError({ status: 403, code: "auth.forbidden" }),
    taggedError({ status: 404, code: "meeting.not_found" }),
    taggedError({ status: 410, code: "stream.closed" }),
    taggedError({ status: 409, code: "stream.conflict" }),
    taggedError({ status: 429, code: "rate_limited" }),
    taggedError({ status: 503, code: "service_unavailable" }),
    taggedError({ code: "network.parse_error" }),
    new DOMException("Aborted", "AbortError"),
  ])("does not retry or replace a non-retriable frame error ($code$status)", async (error) => {
    env.apiFetch.mockResolvedValueOnce(HANDLE).mockRejectedValueOnce(error);
    const client = createMobileMeetingStreamingClient("meeting");
    const signal = new AbortController().signal;
    await client.open(signal);

    await expect(client.sendAndPersist(0, new Uint8Array(), async () => undefined, signal)).rejects.toBe(error);
    expect(env.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry start failures, including an unreachable network", async () => {
    const error = taggedError({ code: "network.unreachable" });
    env.apiFetch.mockRejectedValue(error);
    const client = createMobileMeetingStreamingClient("meeting");

    await expect(client.open(new AbortController().signal)).rejects.toBe(error);
    expect(env.apiFetch).toHaveBeenCalledOnce();
  });

  it("closes a late successful start through apiFetch with an independent signal", async () => {
    vi.stubGlobal("DOMException", undefined);
    const controller = createNativeAbortController();
    env.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/close")) return { closed: true };
      controller.abort();
      return HANDLE;
    });
    const client = createMobileMeetingStreamingClient("meeting");

    await expect(client.open(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(env.apiFetch).toHaveBeenCalledTimes(2);
    const [closePath, closeInit] = env.apiFetch.mock.calls[1] as [string, RequestInit];
    expect(closePath).toBe("/api/work-hub/meetings/meeting/transcription-stream/stream-1/close");
    expect(closeInit).toMatchObject({ method: "POST", body: "{}" });
    expect(closeInit.signal).not.toBe(controller.signal);
    expect(closeInit.signal?.aborted).toBe(false);
  });

  it("bounds and de-duplicates close even when its transport ignores abort", async () => {
    vi.useFakeTimers();
    env.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/close")) return new Promise(() => undefined);
      return HANDLE;
    });
    const client = createMobileMeetingStreamingClient("meeting");
    const active = new AbortController();
    await client.open(active.signal);
    active.abort();

    let settled = false;
    const closing = client.close().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(settled).toBe(true);

    const closeCalls = env.apiFetch.mock.calls.filter(([path]) => String(path).endsWith("/close"));
    expect(closeCalls).toHaveLength(1);
    expect(closeCalls[0][1]?.signal).not.toBe(active.signal);
    expect(closeCalls[0][1]?.signal?.aborted).toBe(true);
    await client.close();
    expect(env.apiFetch.mock.calls.filter(([path]) => String(path).endsWith("/close"))).toHaveLength(1);
  });
});
