import { describe, expect, it, vi } from "vitest";
import { MeetingStreamingClient, meetingStreamingAllowed, startMeetingStreamingCapture, type MeetingStreamingTurn } from "./meeting-streaming";
import type { MeetingSnapshot } from "./meeting-types";

const snapshot = { transcription: true, myConsent: "accepted", streamingCaptureAvailable: true, occurrence: { status: "live", askvInvitedAt: "now" }, participants: [{ userId: 4, present: true, removedAt: null }], userId: 4 } as MeetingSnapshot;
const response = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 503, json: async () => body } as Response);

describe("meeting streaming HTTP client", () => {
  it("rejects simultaneous fetch and JSON transports instead of choosing one", () => {
    const fetcher = vi.fn();
    const transport = vi.fn();

    expect(() => new MeetingStreamingClient("meeting", { fetcher, transport })).toThrow(/mutually exclusive/i);
  });

  it("removes the abort listener after the default retry delay settles", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }))
      .mockImplementationOnce(() => { throw new TypeError("network lost"); })
      .mockImplementationOnce(() => response({ turns: [] }));
    const client = new MeetingStreamingClient("meeting", { fetcher });
    try {
      await client.open(controller.signal);
      const sending = client.sendAndPersist(0, new Uint8Array(), async () => undefined, controller.signal);
      await vi.advanceTimersByTimeAsync(250);
      await sending;
      const abortListener = add.mock.calls.find(([type]) => type === "abort")?.[1];
      expect(abortListener).toBeDefined();
      expect(remove).toHaveBeenCalledWith("abort", abortListener);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a successful late-open handle when cancellation arrives with the start response", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((path: string) => {
      if (path.endsWith("/close")) return response({ closed: true });
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => {
          controller.abort();
          return { sessionId: "late-stream", sampleRate: 16000, frameDurationMs: 500 };
        },
      } as Response);
    });
    const client = new MeetingStreamingClient("meeting", { fetcher });
    await expect(client.open(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).endsWith("/late-stream/close"))).toBe(true));
  });

  it("aborting an active processor closes its worklet and context without stopping shared call tracks", async () => {
    const fetcher = vi.fn((path: string) => response(path.endsWith("/close") ? { closed: true } : { sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const track = { stop: vi.fn() };
    const input = { getTracks: () => [track] } as unknown as MediaStream;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const port = { onmessage: null, close: vi.fn() };
    const node = { port, disconnect: vi.fn() } as unknown as AudioWorkletNode;
    const context = { sampleRate: 48_000, audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }, createMediaStreamSource: vi.fn(() => source), resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as AudioContext;
    const controller = new AbortController();
    try {
      await startMeetingStreamingCapture({ occurrenceId: "meeting", input, startedAtMs: 0, signal: controller.signal, createAudioContext: () => context, createWorkletNode: () => node });
      controller.abort();
      await vi.waitFor(() => expect(context.close).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).endsWith("/close"))).toBe(true));
      expect(port.close).toHaveBeenCalledOnce(); expect(node.disconnect).toHaveBeenCalledOnce(); expect(source.disconnect).toHaveBeenCalledOnce();
      expect(track.stop).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("acknowledges consumed worklet audio and fails closed on worklet overflow", async () => {
    const fetcher = vi.fn((path: string) => response(path.endsWith("/close") ? { closed: true } : path.endsWith("/frame") ? { turns: [] } : { sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const input = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const port = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn(), close: vi.fn() };
    const node = { port, disconnect: vi.fn() } as unknown as AudioWorkletNode;
    const context = { sampleRate: 48_000, audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }, createMediaStreamSource: vi.fn(() => source), resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as AudioContext;
    const errors: unknown[] = [];
    try {
      await startMeetingStreamingCapture({ occurrenceId: "meeting", input, startedAtMs: 0, signal: new AbortController().signal, onError: (error) => errors.push(error), createAudioContext: () => context, createWorkletNode: () => node });
      port.onmessage?.({ data: { type: "audio", sequence: 7, samples: new Float32Array(24_000) } } as MessageEvent);
      await vi.waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).endsWith("/frame"))).toBe(true));
      expect(port.postMessage).toHaveBeenCalledWith({ type: "ack", sequence: 7 });
      port.onmessage?.({ data: { type: "overflow" } } as MessageEvent);
      await vi.waitFor(() => expect(context.close).toHaveBeenCalledOnce());
      expect(errors).toEqual([expect.objectContaining({ message: expect.stringMatching(/too slowly/i) })]);
      await vi.waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).endsWith("/close"))).toBe(true));
    } finally { vi.unstubAllGlobals(); }
  });
  it("bounds cleanup when the close request never settles", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((path: string) => path.endsWith("/close")
      ? new Promise<Response>(() => undefined)
      : response({ sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }));
    const client = new MeetingStreamingClient("meeting", { fetcher });
    try {
      await client.open(new AbortController().signal);
      let settled = false;
      const closing = client.close().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("does not start before the authenticated snapshot allows this attendee", () => {
    expect(meetingStreamingAllowed(snapshot, true, false)).toBe(true);
    for (const blocked of [{ joined: false }, { muted: true }, { streaming: false }, { consent: "declined" }, { present: false }]) {
      const data = structuredClone(snapshot); data.streamingCaptureAvailable = blocked.streaming ?? true; data.myConsent = blocked.consent ?? "accepted"; data.participants[0].present = blocked.present ?? true;
      expect(meetingStreamingAllowed(data, blocked.joined ?? true, blocked.muted ?? false)).toBe(false);
    }
  });

  it("uses only same-origin meeting routes and contains no provider key or URL", async () => {
    const fetcher = vi.fn(() => response({ sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }));
    const client = new MeetingStreamingClient("meeting", { fetcher }); await client.open(new AbortController().signal);
    const serialized = JSON.stringify(fetcher.mock.calls);
    expect(serialized).toContain("/api/work-hub/meetings/meeting/transcription-stream");
    expect(serialized).not.toMatch(/assemblyai|api[_-]?key|wss:\/\//i);
  });

  it("retries the exact frame after transport loss, saves a replayed turn once, then acknowledges only after persistence", async () => {
    const turn: MeetingStreamingTurn = { id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02", turnOrder: 3, text: "Crew arrived", startsAtMs: 1, endsAtMs: 2 };
    const events: string[] = [];
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }))
      .mockImplementationOnce(() => { events.push("lost"); throw new TypeError("network lost"); })
      .mockImplementationOnce(() => { events.push("retry"); return response({ turns: [turn] }); })
      .mockImplementationOnce(() => { events.push("ack"); return response({ turns: [turn] }); });
    const client = new MeetingStreamingClient("meeting", { fetcher, retryDelay: async () => undefined });
    const signal = new AbortController().signal; await client.open(signal);
    const persist = vi.fn(async () => { events.push("persist"); });
    await client.sendAndPersist(0, new Uint8Array(16_000), persist, signal);
    const frameCalls = fetcher.mock.calls.slice(1);
    expect(frameCalls[0][1]?.body).toBe(frameCalls[1][1]?.body);
    expect(JSON.parse(String(frameCalls[0][1]?.body))).not.toHaveProperty("ackTurnOrder");
    expect(JSON.parse(String(frameCalls[2][1]?.body))).toMatchObject({ sequence: 0, ackTurnOrder: 3 });
    expect(persist).toHaveBeenCalledOnce(); expect(events).toEqual(["lost", "retry", "persist", "ack"]);
  });

  it("retries the stable transcript operation after a lost persistence response before acknowledging", async () => {
    const turn: MeetingStreamingTurn = { id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02", turnOrder: 3, text: "Crew arrived", startsAtMs: 1, endsAtMs: 2 };
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }))
      .mockImplementationOnce(() => response({ turns: [turn] }))
      .mockImplementationOnce(() => { throw new TypeError("lost after save"); })
      .mockImplementationOnce(() => response({ saved: true }))
      .mockImplementationOnce(() => response({ turns: [] }));
    const client = new MeetingStreamingClient("meeting", { fetcher, retryDelay: async () => undefined });
    const signal = new AbortController().signal; await client.open(signal);
    await client.sendAndPersist(0, new Uint8Array(16_000), (item, currentSignal) => client.persistTurn(item, currentSignal), signal);
    const transcriptCalls = fetcher.mock.calls.filter(([path]) => String(path).endsWith("/transcript"));
    expect(transcriptCalls).toHaveLength(2); expect(transcriptCalls[0][1]?.body).toBe(transcriptCalls[1][1]?.body);
    expect(JSON.parse(String(transcriptCalls[0][1]?.body)).id).toBe(turn.id);
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).ackTurnOrder).toBe(3);
  });

  it.each(["open", "upload", "persistence"])("honors abort during %s", async (phase) => {
    const controller = new AbortController();
    const turn = { id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02", turnOrder: 1, text: "Words", startsAtMs: 0, endsAtMs: 1 };
    const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
      if (phase === "open") { controller.abort(); init?.signal?.throwIfAborted(); }
      if (fetcher.mock.calls.length === 1) return (await response({ sessionId: "stream", sampleRate: 16000, frameDurationMs: 500 }));
      if (phase === "upload") { controller.abort(); init?.signal?.throwIfAborted(); }
      return (await response({ turns: [turn] }));
    });
    const client = new MeetingStreamingClient("meeting", { fetcher, retryDelay: async () => undefined });
    if (phase === "open") await expect(client.open(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    else {
      await client.open(controller.signal);
      await expect(client.sendAndPersist(0, new Uint8Array(16_000), async () => { if (phase === "persistence") controller.abort(); }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    }
  });
});
