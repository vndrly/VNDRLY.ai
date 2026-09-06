import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const rtc = vi.hoisted(() => ({ channels: [] as any[], peers: [] as any[], tracks: [] as any[], getMedia: vi.fn() }));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://example.test" }));
vi.mock("react-native-webrtc", () => ({
  mediaDevices: { getUserMedia: rtc.getMedia },
  RTCPeerConnection: class {
    ontrack: any; onconnectionstatechange: any; connectionState = "new";
    addTrack = vi.fn(); addTransceiver = vi.fn(); close = vi.fn();
    createOffer = vi.fn().mockResolvedValue({ sdp: "offer" });
    setLocalDescription = vi.fn().mockResolvedValue(undefined);
    setRemoteDescription = vi.fn().mockImplementation(async () => { const ch = rtc.channels.at(-1); ch.readyState = "open"; ch.onopen?.(); });
    constructor() { rtc.peers.push(this); }
    createDataChannel() {
      const ch = { readyState: "connecting", onmessage: null, onopen: null, onclose: null,
        sent: [] as any[], send(data: string) { this.sent.push(JSON.parse(data)); }, close: vi.fn() };
      rtc.channels.push(ch); return ch;
    }
  },
}));
import { createAskVRealtimeClient } from "../askv-realtime-client";
const options = () => ({ token: "token", sessionId: "session-1", conversationId: 11, onToolCall: async () => "done" });
const emit = async (payload: unknown) => {
  rtc.channels[0].onmessage?.({ data: JSON.stringify(payload) });
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
beforeEach(() => {
  rtc.channels = []; rtc.peers = []; rtc.tracks = [];
  rtc.getMedia.mockReset().mockImplementation(async () => {
    const track = { enabled: true, stop: vi.fn() }; rtc.tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("answer", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("mobile Realtime transport", () => {
  it("stops permission-delayed microphone tracks after close and never posts an SDP", async () => {
    let resolve!: (value: any) => void;
    rtc.getMedia.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = createAskVRealtimeClient(options());
    // Client construction must be side-effect free; close is available before permission resolves.
    const client = await pending;
    const connect = client.connect();
    await Promise.resolve();
    client.close();
    const track = { enabled: true, stop: vi.fn() };
    resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
    await expect(connect).rejects.toMatchObject({ name: "AbortError" });
    expect(track.stop).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits for actual playback completion, not response generation completion", async () => {
    const onDone = vi.fn();
    const client = await createAskVRealtimeClient({ ...options(), onDone });
    await client.connect();
    await emit({ type: "output_audio_buffer.started" });
    await emit({ type: "response.done", response: { status: "completed", output: [{ type: "message", content: [{ type: "audio" }] }] } });
    expect(onDone).not.toHaveBeenCalled();
    await emit({ type: "output_audio_buffer.stopped" });
    expect(onDone).toHaveBeenCalledOnce();
    client.close();
  });

  it("hydrates typed history and requests the fetched greeting as speech after channel open", async () => {
    const client = await createAskVRealtimeClient({ ...options(), greeting: "Good morning, Brian.",
      history: [{ role: "user", content: "Use site Alpha" }, { role: "assistant", content: "Site Alpha selected." }] });
    await client.connect();
    const sent = rtc.channels[0].sent;
    expect(sent[0].item.content[0].text).toBe("Use site Alpha");
    expect(sent[1].item.role).toBe("assistant");
    expect(sent.find((item: any) => item.type === "response.create").response.instructions).toContain("Good morning, Brian.");
    client.close();
  });

  it("clears audible buffered output on interruption and deduplicates tool events", async () => {
    const onToolCall = vi.fn().mockResolvedValue("done");
    const client = await createAskVRealtimeClient({ ...options(), onToolCall });
    await client.connect();
    client.interrupt();
    expect(rtc.channels[0].sent).toEqual(expect.arrayContaining([{ type: "output_audio_buffer.clear" }]));
    const call = { type: "response.function_call_arguments.done", call_id: "call-1", name: "read_ticket", arguments: "{}" };
    await emit(call); await emit(call);
    expect(onToolCall).toHaveBeenCalledOnce();
    client.close();
  });

  it("uses the existing native PCM source without acquiring a second microphone", async () => {
    const listeners = new Set<(samples: Float32Array) => void>();
    const audioSource = { subscribe: (fn: (samples: Float32Array) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, stop: vi.fn() };
    const client = await createAskVRealtimeClient({ ...options(), audioSource });
    await client.connect();
    expect(rtc.getMedia).not.toHaveBeenCalled();
    expect(rtc.peers[0].addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
    listeners.forEach((listener) => listener(new Float32Array(160).fill(0.2)));
    expect(rtc.channels[0].sent.some((event: any) => event.type === "input_audio_buffer.append" && event.audio.length > 0)).toBe(true);
    client.close();
    expect(listeners.size).toBe(0);
  });
  it("chunks a buffered wake turn below data-channel message limits", async () => {
    const audioSource = { subscribe: (fn: (frame: Float32Array) => void) => { fn(new Float32Array(80_000).fill(0.25)); return () => {}; }, stop: vi.fn() };
    const client = await createAskVRealtimeClient({ ...options(), audioSource });
    await client.connect();
    const packets = rtc.channels[0].sent.filter((event: any) => event.type === "input_audio_buffer.append");
    expect(packets.length).toBeGreaterThan(1);
    expect(packets.every((event: any) => event.audio.length <= 6400)).toBe(true);
    client.close();
  });
  it("rejects a stopped audio source during channel opening and closes the peer", async () => {
    const audioSource = { subscribe: () => { throw new Error("source stopped"); }, stop: vi.fn() };
    const client = await createAskVRealtimeClient({ ...options(), audioSource });
    await expect(client.connect()).rejects.toThrow("source stopped");
    expect(rtc.peers[0].close).toHaveBeenCalled();
  });
});
