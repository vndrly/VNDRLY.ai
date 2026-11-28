import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ sessions: [] as any[], agents: [] as any[], tracks: [] as any[], mic: vi.fn(), release: vi.fn(), intent: vi.fn(async (_intent?: any) => ({ ok: true })), handlers: {} as Record<string, Function>, connect: null as null | (() => Promise<void>) }));
vi.mock("@workspace/askv-realtime-sdk", () => ({
  RealtimeAgent: class { constructor(options: any) { Object.assign(this, options); env.agents.push(this); } },
  RealtimeSession: class {
    on = vi.fn((name, handler) => { env.handlers[name] = handler; });
    connect = vi.fn(async () => env.connect?.()); close = vi.fn(); interrupt = vi.fn(); sendMessage = vi.fn(); updateAgent = vi.fn(async () => undefined);
    constructor(public agent: any, public options: any) { env.sessions.push(this); }
  },
  OpenAIRealtimeWebRTC: class { on = vi.fn(); sent = vi.fn(); sendEvent = this.sent; updateSessionConfig = vi.fn(); status = "connected"; connectionState = { dataChannel: new EventTarget() }; constructor(public options: any) {} },
  tool: (definition: any) => definition,
}));
vi.mock("@workspace/askv-wake", () => ({ askVMicrophone: { acquire: vi.fn(async () => env.release) } }));
vi.mock("@/lib/askv-client-intents", () => ({
  parseAskVClientIntent: (output: any) => { try { const parsed = typeof output === "string" ? JSON.parse(output) : output; return parsed?.execution === "client" ? parsed.intent : null; } catch { return null; } },
  applyAskVClientIntentVerified: (...args: any[]) => env.intent(args[0]),
}));
vi.mock("@/lib/askv-tool-location", () => ({ addAskVToolLocation: async (_name: string, input: any) => input }));
import { useAskVRealtime } from "./use-askv-realtime";
import { selectAskVMicrophone, getAskVMicrophoneState } from "@/lib/askv-microphone";
import { observeAskVAudio } from "@/lib/askv-audio-waveform";
import { speakAskV } from "@/lib/askv-speech";
vi.mock("@/lib/askv-speech", () => ({ speakAskV: vi.fn(), stopAskVSpeech: vi.fn() }));
vi.mock("@/lib/askv-audio-waveform", () => ({ observeAskVAudio: vi.fn(() => vi.fn()) }));
import { registerGateVoiceForm, readGateVoiceDraft } from "@workspace/gate-booth";
const config = { clientSecret: "ek_test", model: "gpt-realtime-2.1", voice: "marin", instructions: "You are V", tools: [
  { name: "offer_gate_workflow", description: "Offer help", parameters: { type: "object", properties: {} } },
  { name: "select_tool_pack", description: "Select tools", parameters: { type: "object", properties: {} } },
] };
beforeEach(() => {
  vi.clearAllMocks(); env.sessions.length = 0; env.agents.length = 0; env.handlers = {}; env.connect = null;
  selectAskVMicrophone("");
  env.release.mockResolvedValue(undefined); env.tracks = [{ stop: vi.fn(), addEventListener: vi.fn() }]; env.mic.mockResolvedValue({ getTracks: () => env.tracks, getAudioTracks: () => env.tracks });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: env.mic } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(config))));
});
afterEach(() => vi.unstubAllGlobals());
it("mutes generated checkout narration and speaks only staged and saved receipts", async () => {
  const saved = vi.fn();
  const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9 }), saved });
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...config, tools: [{ name: "confirm_visitor_check_out", description: "Checkout", parameters: { type: "object", properties: {} } }] })));
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/gate"));
  act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "checkout", transcript: "Check out John Smith" }));
  const playback = env.sessions[0].options.transport.options.audioElement;
  expect(playback.muted).toBe(true);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, requiresConfirmation: true, idempotencyKey: "checkout" })));
  await act(async () => env.agents[0].tools[0].execute({ visitId: 123 }, undefined, { toolCall: { callId: "prepare" } }));
  expect(speakAskV).toHaveBeenLastCalledWith("Say yes to check out.");
  expect(saved).not.toHaveBeenCalled();
  act(() => result.current.updateContext({ path: "/gate" }));
  expect(playback.muted).toBe(true);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: JSON.stringify({ ok: true, action: "visitor_checked_out", verification: "canonical_readback", displayName: "John Smith" }) })));
  await act(async () => env.agents[0].tools[0].execute({ visitId: 123 }, undefined, { toolCall: { callId: "save" } }));
  expect(speakAskV).toHaveBeenLastCalledWith("John Smith is checked out.");
  expect(speakAskV).toHaveBeenCalledTimes(2);
  expect(saved).toHaveBeenCalledWith({ checkoutCompleted: true });
  unregister();
  expect(playback.muted).toBe(true);
});
it.each(["Yes.", "Affirmative.", "Go ahead and do that."])("routes the pending checkout reply to server interpretation: %s", async (reply) => {
  const saved = vi.fn();
  const unregister = registerGateVoiceForm({read:()=>({siteLocationId:9}),saved});
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({...config,tools:["prepare_visitor_check_out","confirm_visitor_check_out"].map(name=>({name,description:name,parameters:{type:"object",properties:{}}}))})));
  const {result,unmount}=renderHook(useAskVRealtime);
  try {
    await act(async()=>result.current.startConversation(undefined,"/gate"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,output:JSON.stringify({ok:true,matches:[{id:123}],needsChoice:false})})));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ok:false,requiresConfirmation:true,idempotencyKey:"checkout"})));
    await act(async()=>{env.handlers.transport_event({type:"conversation.item.input_audio_transcription.completed",item_id:"checkout-fast",transcript:"Check out Lisa Simpson."});});
    const prepareCall = vi.mocked(fetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body))).find(body=>body.name==="prepare_visitor_check_out");
    expect(prepareCall.arguments.query).toBe("Lisa Simpson");
    expect(speakAskV).toHaveBeenLastCalledWith("Say yes to check out.");
    expect(saved).not.toHaveBeenCalled();
    expect(env.sessions[0].sendMessage).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,output:JSON.stringify({ok:true,action:"visitor_checked_out",verification:"canonical_readback",displayName:"Chad White"})})));
    await act(async()=>{result.current.sendText(reply);});
    const body=JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body.idempotencyKey).toBe("checkout");
    expect(body.utterance.text).toBe(reply);
    expect(saved).toHaveBeenCalledWith({checkoutCompleted:true});
    expect(speakAskV).toHaveBeenLastCalledWith("Chad White is checked out.");
    expect(env.sessions[0].sendMessage).not.toHaveBeenCalled();
  } finally {unmount();unregister();}
});
it("keeps a pending checkout unsubmitted when the reply is a refusal", async () => {
  const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9 }), saved: vi.fn() });
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...config, tools: ["prepare_visitor_check_out", "confirm_visitor_check_out"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } })) })));
  const { result, unmount } = renderHook(useAskVRealtime);
  try {
    await act(async () => result.current.startConversation(undefined, "/gate"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: JSON.stringify({ ok: true, matches: [{ id: 123 }], needsChoice: false }) })));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, requiresConfirmation: true, idempotencyKey: "checkout" })));
    await act(async () => { env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "checkout-no", transcript: "Check out Lisa Simpson." }); });
    const calls = vi.mocked(fetch).mock.calls.length;
    await act(async () => { result.current.sendText("no"); });
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(speakAskV).toHaveBeenLastCalledWith("Not submitted.");
  } finally { unmount(); unregister(); }
});
it("stays connected when the voice service refuses one request while the link is up", async () => {
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/gate"));
  await act(async () => { env.handlers.error({ type: "error", error: { type: "error", error: { code: "response_cancel_not_active", message: "Cancellation failed: no active response found" } } }); });
  expect(env.sessions).toHaveLength(1);
  expect(env.sessions[0].close).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
  expect(result.current.state).toBe("listening");
});
it("reconnects by itself when the event channel closes on its own", async () => {
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/gate"));
  await act(async () => { env.sessions[0].options.transport.connectionState.dataChannel.dispatchEvent(new Event("close")); });
  expect(env.sessions).toHaveLength(2);
  expect(result.current.error).toBeNull();
  expect(result.current.state).toBe("listening");
});
const FAKED = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const };
const later = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const metricsSent = () => vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith("/voice/metrics")).map(call => JSON.parse(String(call[1]?.body)));
it("reconnects by itself after the session expires, waiting longer each time, and shows the actual nested error only when every reconnect has dropped", async () => {
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const failure = { type: "error", error: { type: "error", error: { code: "session_expired", message: "Exact server failure" } } };
    // The first drop reconnects at once, without bothering the operator.
    await act(async () => { env.handlers.error(failure); });
    expect(env.sessions).toHaveLength(2);
    expect(result.current.error).toBeNull();
    // Each drop after that waits longer before the next reconnect.
    for (const [index, wait] of [1_000, 2_000, 4_000, 8_000, 15_000, 30_000].entries()) {
      await act(async () => { env.handlers.error(failure); });
      expect(result.current.state).toBe("connecting");
      await later(wait - 1);
      expect(env.sessions).toHaveLength(index + 2);
      await later(1);
      expect(env.sessions).toHaveLength(index + 3);
      expect(result.current.state).toBe("listening");
      expect(result.current.error).toBeNull();
    }
    // Every reconnect has dropped: the failure is shown as the server worded it.
    act(() => env.handlers.error(failure));
    expect(result.current.error).toBe("Exact server failure");
    expect(result.current.state).toBe("error");
    expect(env.sessions).toHaveLength(8);
  } finally { vi.useRealTimers(); }
});
it("starts the waits over after a link that held for 30 seconds", async () => {
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/dashboard"));
    const drop = () => act(async () => { env.sessions.at(-1).options.transport.connectionState.dataChannel.dispatchEvent(new Event("close")); });
    await drop();
    expect(env.sessions).toHaveLength(2);
    await later(30_000);
    // This link held, so its drop is treated as the first: she is back at once.
    await drop();
    expect(env.sessions).toHaveLength(3);
    expect(result.current.state).toBe("listening");
  } finally { vi.useRealTimers(); }
});
it("keeps trying when a reconnect cannot reach the server, and comes back with the half-entered visitor", async () => {
  let draft: Record<string, unknown> = { siteLocationId: 9, gateStationId: "gate", entryRevision: 0 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: vi.fn(), open: () => { draft = { ...draft, silentCheckIn: true }; }, fillCheckIn: (values: Record<string, unknown>) => { draft = { ...draft, ...values }; } });
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "start", transcript: "Check in Bob Vila." }));
    // The link drops, and the first reconnect cannot reach the server at all.
    vi.mocked(fetch).mockImplementation(async url => { if (String(url).endsWith("/voice/session")) throw new TypeError("Failed to fetch"); return new Response("{}"); });
    await act(async () => { env.sessions[0].options.transport.connectionState.dataChannel.dispatchEvent(new Event("close")); });
    expect(env.sessions).toHaveLength(1);
    expect(result.current.state).toBe("connecting");
    expect(result.current.error).toBeNull();
    // A second later the server answers: V is back and says where the entry stands.
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(config)));
    await later(1_000);
    expect(env.sessions).toHaveLength(2);
    expect(result.current.state).toBe("listening");
    expect(speakAskV).toHaveBeenLastCalledWith("Bob Vila. Company?");
    expect(draft).toMatchObject({ firstName: "Bob", lastName: "Vila" });
  } finally { vi.useRealTimers(); unregister(); }
});
it("stops reconnecting at once when the server refuses, or when the operator stops V while she waits", async () => {
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/dashboard"));
    vi.mocked(fetch).mockImplementation(async url => String(url).endsWith("/voice/session") ? new Response(JSON.stringify({ message: "Please sign in to continue." }), { status: 401 }) : new Response("{}"));
    await act(async () => { env.sessions[0].options.transport.connectionState.dataChannel.dispatchEvent(new Event("close")); });
    expect(result.current.state).toBe("error");
    await later(60_000);
    expect(env.sessions).toHaveLength(1);
    // Started again by the operator, dropped twice, then stopped during the wait: nothing reconnects afterwards.
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(config)));
    await act(async () => result.current.startConversation(undefined, "/dashboard"));
    for (let drops = 0; drops < 2; drops++) await act(async () => { env.sessions.at(-1).options.transport.connectionState.dataChannel.dispatchEvent(new Event("close")); });
    expect(result.current.state).toBe("connecting");
    act(() => result.current.stop());
    expect(result.current.state).toBe("stopped");
    await later(60_000);
    expect(env.sessions).toHaveLength(3);
    expect(result.current.state).toBe("stopped");
  } finally { vi.useRealTimers(); }
});
it("reconnects when the link stops receiving without ever reporting that it closed, and leaves a receiving link alone", async () => {
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/dashboard"));
    let received = 0, sending = true;
    const stats = () => ({ getStats: vi.fn(async () => new Map([["in", { type: "inbound-rtp", packetsReceived: sending ? (received += 50) : received }]])) });
    env.sessions[0].options.transport.connectionState.peerConnection = stats();
    await later(60_000);
    expect(env.sessions).toHaveLength(1);
    expect(metricsSent()).toEqual([]);
    // The far end goes silent; the link still says it is connected.
    sending = false;
    await later(6_000);
    expect(env.sessions).toHaveLength(1);
    await later(3_000);
    expect(env.sessions).toHaveLength(2);
    expect(result.current.state).toBe("listening");
    expect(result.current.error).toBeNull();
    expect(metricsSent()).toEqual([expect.objectContaining({ event: "session_end", reason: "network" })]);
  } finally { vi.useRealTimers(); }
});
it("moves to a fresh session before the 60-minute limit at a quiet moment, and logs it as a refresh, not a drop", async () => {
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/dashboard"));
    await later(50 * 60_000 - 3_000);
    expect(env.sessions).toHaveLength(1);
    await later(3_000);
    expect(env.sessions).toHaveLength(2);
    expect(result.current.state).toBe("listening");
    expect(result.current.error).toBeNull();
    expect(metricsSent()).toEqual([expect.objectContaining({ event: "session_end", reason: "refresh" })]);
  } finally { vi.useRealTimers(); }
});
it("waits for V to finish answering before the fresh session, but not past 57 minutes", async () => {
  vi.useFakeTimers({ toFake: [...FAKED.toFake] });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/dashboard"));
    await later(49 * 60_000);
    act(() => env.handlers.transport_event({ type: "response.created" }));
    expect(result.current.state).toBe("thinking");
    await later(2 * 60_000);
    expect(env.sessions).toHaveLength(1);
    // She finishes: the move happens at the next check.
    act(() => env.handlers.transport_event({ type: "output_audio_buffer.stopped" }));
    await later(3_000);
    expect(env.sessions).toHaveLength(2);
    // The next session is still answering when its time is up: it moves anyway.
    await later(49 * 60_000);
    act(() => env.handlers.transport_event({ type: "response.created" }));
    await later(8 * 60_000 - 3_000);
    expect(env.sessions).toHaveLength(2);
    await later(3_000);
    expect(env.sessions).toHaveLength(3);
  } finally { vi.useRealTimers(); }
});
it("uses the selected microphone and meters the same stream sent to Realtime, cleaning up on stop", async () => {
  selectAskVMicrophone("windows-tested-headset");
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation());
  expect(env.mic).toHaveBeenCalledExactlyOnceWith({ audio: expect.objectContaining({ deviceId: { exact: "windows-tested-headset" } }), video: false });
  const stream = env.sessions[0].options.transport.options.mediaStream;
  expect(observeAskVAudio).toHaveBeenCalledExactlyOnceWith(stream);
  expect(getAskVMicrophoneState().active).toBe(true);
  const cleanup = vi.mocked(observeAskVAudio).mock.results[0].value;
  act(() => result.current.stop());
  expect(cleanup).toHaveBeenCalledOnce();
  expect(getAskVMicrophoneState().active).toBe(false);
});
it("fills only five check-in fields and rejects submission of an incomplete registered draft", async () => {
  const open = vi.fn(), fill = vi.fn();
  const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9 }), saved: vi.fn(), open, fill });
  const { result } = renderHook(useAskVRealtime);
  try {
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const { config: sessionConfig, transport } = env.sessions[0].options;
    expect(sessionConfig.audio.input.turnDetection.createResponse).toBe(false);
    expect(sessionConfig.audio.input.turnDetection.interruptResponse).toBe(false);
    const hear = (item_id: string, transcript: string) => act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
    hear("start", "Check in");
    hear("details", "Bob Vila from NewCo, tag alpha bravo charlie one two three, state Oklahoma, purpose delivery");
    hear("submit", "Submit");
    expect(open).toHaveBeenCalledOnce();
    expect(fill).toHaveBeenCalledExactlyOnceWith({ firstName: "Bob", lastName: "Vila", company: "NewCo", vehiclePlate: "ABC123", plateState: "OK" });
    expect(transport.sent).not.toHaveBeenCalledWith(expect.objectContaining({type: "response.create"}));
    expect(transport.options.audioElement.muted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  } finally { unregister(); }
});
it("submits a complete current Gate draft exactly once on spoken confirmation", async () => {
  const confirmCheckIn = vi.fn(async () => undefined);
  const unregister = registerGateVoiceForm({
    read: () => ({ siteLocationId: 9, gateStationId: "test", entryRevision: 0, silentCheckIn: true, firstName: "John", lastName: "Smith", company: "John's Trucking", plateState: "OK", vehiclePlate: "BC7O79" }),
    saved: vi.fn(), open: vi.fn(), confirmCheckIn,
  });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    await act(async () => {
      const event = { type: "conversation.item.input_audio_transcription.completed", item_id: "confirm", transcript: "Confirm" };
      env.handlers.transport_event(event);
      env.handlers.transport_event(event);
    });
    expect(confirmCheckIn).toHaveBeenCalledExactlyOnceWith(expect.any(String));
    expect(result.current.error).toBeNull();
  } finally { unregister(); }
});
it("pauses on “hold on”, ignores the room while paused, and comes back on “Hey V” or the Resume toggle with the entry kept", async () => {
  let draft: Record<string, unknown> = { siteLocationId: 9, gateStationId: "gate", entryRevision: 0 };
  const fill = vi.fn((values: Record<string, unknown>) => { draft = { ...draft, ...values }; });
  const unregister = registerGateVoiceForm({ read: () => draft, saved: vi.fn(), open: () => { draft = { ...draft, silentCheckIn: true }; }, fillCheckIn: fill });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const hear = (item_id: string, transcript: string) => act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
    hear("start", "Check in Bob Vila.");
    expect(draft).toMatchObject({ firstName: "Bob", lastName: "Vila" });
    hear("hold", "Hold on.");
    expect(result.current.paused).toBe(true);
    expect(speakAskV).toHaveBeenLastCalledWith("Paused.");
    // The room talking while she is paused fills nothing.
    hear("room", "NewCo");
    expect(draft.company ?? "").toBe("");
    // Called by name: she says where the entry stands and asks for the next thing.
    hear("wake", "Hey V.");
    expect(result.current.paused).toBe(false);
    expect(speakAskV).toHaveBeenLastCalledWith("Bob Vila. Company?");
    hear("company", "NewCo");
    expect(draft).toMatchObject({ firstName: "Bob", lastName: "Vila", company: "NewCo" });
    // The toggle in her pane does the same as the words.
    act(() => result.current.setPaused(true));
    expect(result.current.paused).toBe(true);
    act(() => result.current.setPaused(false));
    expect(result.current.paused).toBe(false);
    expect(env.sessions).toHaveLength(1);
  } finally { unregister(); }
});
it("saves an incomplete check-in on a spoken yes, names what the server flagged, then sleeps until called", async () => {
  const confirmCheckIn = vi.fn(async () => ["Missing company, tag, state"]);
  const unregister = registerGateVoiceForm({
    read: () => ({ siteLocationId: 9, gateStationId: "test", entryRevision: 0, silentCheckIn: true, firstName: "John", lastName: "Smith", company: "", plateState: null, vehiclePlate: "" }),
    saved: vi.fn(), open: vi.fn(), confirmCheckIn,
  });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const hear = (item_id: string, transcript: string) => act(async () => { env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }); });
    // A looser word may be an answer, so she asks again instead of saving.
    await hear("loose", "Right.");
    expect(confirmCheckIn).not.toHaveBeenCalled();
    expect(speakAskV).toHaveBeenLastCalledWith("Company?");
    await hear("yes", "Yes.");
    expect(confirmCheckIn).toHaveBeenCalledExactlyOnceWith(expect.any(String));
    expect(speakAskV).toHaveBeenLastCalledWith("John Smith is checked in. Flagged: Missing company, tag, state.");
    expect(result.current.asleep).toBe(true);
    expect(result.current.paused).toBe(true);
    await hear("wake", "Hey V.");
    expect(result.current.asleep).toBe(false);
    expect(result.current.paused).toBe(false);
  } finally { unregister(); }
});
it("asks which gate when none is chosen, takes the answer by voice, and saves only after the yes", async () => {
  let draft: Record<string, unknown> = { entryRevision: 0, silentCheckIn: true, gateChoices: [{ id: "east", name: "East Gate" }, { id: "west", name: "West Gate" }], firstName: "John", lastName: "Smith", company: "John's Trucking", plateState: "OK", vehiclePlate: "BC7O79" };
  const chooseGate = vi.fn((id: string) => { draft = { ...draft, gateChoices: undefined, siteLocationId: 9, gateStationId: id }; });
  const confirmCheckIn = vi.fn(async () => [] as string[]);
  const unregister = registerGateVoiceForm({ read: () => draft, saved: vi.fn(), open: vi.fn(), confirmCheckIn, chooseGate });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const hear = (item_id: string, transcript: string) => act(async () => { env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }); });
    await hear("yes", "Yes.");
    expect(confirmCheckIn).not.toHaveBeenCalled();
    expect(speakAskV).toHaveBeenLastCalledWith("Which gate? East Gate, West Gate.");
    // What she asks is also shown in her pane.
    expect(result.current.error).toBe("Which gate? East Gate, West Gate.");
    // Her own question coming back through the microphone picks nothing.
    await hear("echo", "Which gate? East Gate, West Gate.");
    expect(chooseGate).not.toHaveBeenCalled();
    await hear("gate", "West gate.");
    expect(chooseGate).toHaveBeenCalledExactlyOnceWith("west");
    expect(speakAskV).toHaveBeenLastCalledWith("West Gate. Say yes to check in.");
    expect(result.current.error).toBeNull();
    expect(confirmCheckIn).not.toHaveBeenCalled();
    await hear("again", "Yes.");
    expect(confirmCheckIn).toHaveBeenCalledOnce();
    expect(speakAskV).toHaveBeenLastCalledWith("John Smith is checked in.");
    expect(result.current.error).toBeNull();
  } finally { unregister(); }
});
it("fills the screenshot's visitor details immediately after Gate voice starts, without a check-in command", async () => {
  const fill = vi.fn();
  const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9, gateStationId: "gate", entryRevision: 0 }), saved: vi.fn(), open: vi.fn(), fillCheckIn: fill });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "visitor", transcript: "First name Bob, last name Smith, Oklahoma tag ABC497." }));
    expect(fill).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", lastName: "Smith", plateState: "OK", vehiclePlate: "ABC497" }));
    expect(env.sessions[0].options.transport.sent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "response.create" }));
  } finally { unregister(); }
});
it("replies to normal voice once after a completed transcript", async () => {
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/work-hub"));
  const event = { type: "conversation.item.input_audio_transcription.completed", item_id: "normal", transcript: "What is on my calendar?" };
  act(() => { env.handlers.transport_event(event); env.handlers.transport_event(event); });
  expect(env.sessions[0].options.transport.sent).toHaveBeenCalledExactlyOnceWith({ type: "response.create" });
});
it("checks a visitor in and out from another page for whoever holds the watch, and shows why a save was refused", async () => {
  let refuse = true;
  const posts: [string, unknown][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).slice(String(url).indexOf("/api/"));
    if (path === "/api/gate-change-over/operating-context") return new Response(JSON.stringify({ operatingGate: { stationId: "outer", siteId: 414, gateName: "Outer Circle", siteName: "Longhorn" }, reason: null }));
    if (path.startsWith("/api/visits?")) return new Response(JSON.stringify([{ id: 90, firstName: "Alan", lastName: "Webb", company: "Webb's Towing", vehiclePlate: "ABC123", plateState: "OK" }]));
    if (!path.startsWith("/api/visits/")) return new Response(JSON.stringify(config));
    posts.push([path, JSON.parse(String(init!.body))]);
    if (path.endsWith("/check-out")) return new Response(JSON.stringify({ id: 90, checkOutTime: "2026-11-27T23:00:00.000Z" }));
    return refuse ? new Response(JSON.stringify({ message: "Your company is not assigned to this site." }), { status: 403 })
      : new Response(JSON.stringify({ id: 90, conflictReason: "Tag already on site with an open visit for Pat First" }));
  }));
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/work-hub"));
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const hear = async (item_id: string, transcript: string) => { act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript })); await settle(); };
  await hear("all", "Check in Alan Webb, Webb's Towing, Oklahoma tag ABC 123.");
  expect(readGateVoiceDraft()).toMatchObject({ watchForm: true, gateStationName: "Outer Circle", firstName: "Alan", lastName: "Webb", company: "Webb's Towing", vehiclePlate: "ABC123", plateState: "OK" });
  await hear("yes", "Yes.");
  expect(result.current.error).toBe("Not saved: Your company is not assigned to this site.");
  // Not saved: the entry is kept and she stays open to say why.
  expect(readGateVoiceDraft()).toMatchObject({ firstName: "Alan", silentCheckIn: true });
  expect(result.current.asleep).toBe(false);
  refuse = false;
  act(() => { result.current.sendText("confirm"); }); await settle();
  expect(posts.at(-1)).toEqual(["/api/visits/gate/check-in", expect.objectContaining({ firstName: "Alan", lastName: "Webb", vehiclePlate: "ABC123", plateState: "OK", siteLocationId: 414, gateStationId: "outer" })]);
  expect(result.current.error).toBeNull();
  expect(readGateVoiceDraft()).toMatchObject({ watchForm: true, firstName: "", silentCheckIn: false });
  // A tag that is already on site is saved and flagged; V says so, then sleeps with her panel closed.
  expect(speakAskV).toHaveBeenLastCalledWith("Alan Webb is checked in. Flagged: Tag already on site with an open visit for Pat First.");
  expect(result.current.asleep).toBe(true);
  // "Check out ..." is a Gate command: it wakes her in the same breath.
  await hear("out", "Check out Alan Webb.");
  expect(result.current.asleep).toBe(false);
  expect(speakAskV).toHaveBeenLastCalledWith("Alan Webb. Say yes to check out.");
  expect(readGateVoiceDraft()?.checkoutReview).toMatchObject({ id: 90 });
  expect(posts).toHaveLength(2);
  await hear("approve", "Yes.");
  expect(posts.at(-1)).toEqual(["/api/visits/gate/90/check-out", { gateStationId: "outer" }]);
  expect(speakAskV).toHaveBeenLastCalledWith("Alan Webb is checked out.");
  expect(env.sessions[0].sendMessage).not.toHaveBeenCalled();
  expect(env.sessions[0].options.transport.sent).not.toHaveBeenCalledWith({ type: "response.create" });
  act(() => result.current.stop());
  expect(readGateVoiceDraft()).toBeUndefined();
});
it("shows a refused check-out as not saved, says the plain reason, and stays open", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = String(url).slice(String(url).indexOf("/api/"));
    if (path === "/api/gate-change-over/operating-context") return new Response(JSON.stringify({ operatingGate: { stationId: "outer", siteId: 414, gateName: "Outer Circle", siteName: "Longhorn" }, reason: null }));
    if (path.startsWith("/api/visits?")) return new Response(JSON.stringify([{ id: 90, firstName: "Alan", lastName: "Webb", company: "Webb's Towing", vehiclePlate: "ABC123", plateState: "OK" }]));
    if (path.endsWith("/check-out")) return new Response(JSON.stringify({ message: "Your company is not assigned to this site." }), { status: 403 });
    return new Response(JSON.stringify(config));
  }));
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/work-hub"));
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const hear = async (item_id: string, transcript: string) => { act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript })); await settle(); };
  await hear("out", "Check out Alan Webb.");
  expect(speakAskV).toHaveBeenLastCalledWith("Alan Webb. Say yes to check out.");
  await hear("approve", "Yes.");
  expect(result.current.error).toBe("Not saved: Your company is not assigned to this site.");
  expect(speakAskV).toHaveBeenLastCalledWith("Your company is not assigned to this site.");
  expect(result.current.asleep).toBe(false);
  // A lookup that finds nobody is not a failed save.
  await hear("nobody", "Check out Zed Nobody.");
  expect(result.current.error).toBe("No matching visitor found.");
  act(() => result.current.stop());
});
it("hands a check-in request to the assistant when the speaker holds no watch", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/operating-context") ? { operatingGate: null, reason: "no_watch" } : config))));
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation(undefined, "/work-hub"));
  act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "ask", transcript: "Check in Bob Smith." }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(readGateVoiceDraft()).toBeUndefined();
  expect(env.sessions[0].sendMessage).toHaveBeenCalledExactlyOnceWith("Check in Bob Smith.");
  act(() => result.current.stop());
});
it("answers a question on the Gate page aloud while the form keeps listening for the visitor", async () => {
  const fill = vi.fn();
  const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9, gateStationId: "gate", entryRevision: 0 }), saved: vi.fn(), open: vi.fn(), fillCheckIn: fill });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const { transport } = env.sessions[0].options;
    const hear = (item_id: string, transcript: string) => act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
    expect(transport.options.audioElement.muted).toBe(true);
    hear("question", "What gate am I on?");
    expect(transport.sent).toHaveBeenCalledExactlyOnceWith({ type: "response.create" });
    expect(transport.options.audioElement.muted).toBe(false);
    hear("visitor", "First name Bob, last name Smith, Oklahoma tag ABC497.");
    expect(fill).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", lastName: "Smith", plateState: "OK", vehiclePlate: "ABC497" }));
    expect(transport.sent).toHaveBeenCalledExactlyOnceWith({ type: "response.create" });
    expect(transport.options.audioElement.muted).toBe(true);
  } finally { unregister(); }
});
it("answers a question asked in the middle of a check-in and keeps the half-entered visitor", async () => {
  let draft: Record<string, unknown> = { siteLocationId: 9, gateStationId: "gate", entryRevision: 0 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: vi.fn(), open: () => { draft = { ...draft, silentCheckIn: true }; }, fillCheckIn: values => { draft = { ...draft, ...values }; } });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    const { transport } = env.sessions[0].options;
    const hear = (item_id: string, transcript: string) => act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
    hear("start", "Check in John Smith.");
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith" });
    expect(transport.sent).not.toHaveBeenCalledWith({ type: "response.create" });
    hear("question", "What gate am I on?");
    expect(transport.sent).toHaveBeenCalledExactlyOnceWith({ type: "response.create" });
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith" });
    expect(draft.company).toBeUndefined();
    hear("company", "Halliburton.");
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith", company: "Halliburton" });
    expect(transport.sent).toHaveBeenCalledExactlyOnceWith({ type: "response.create" });
  } finally { unregister(); }
});
it("resumes Gate capture after visiting Dashboard and returning with voice still active", async () => {
  const fill = vi.fn();
  const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9, gateStationId: "gate", entryRevision: 0 }), saved: vi.fn(), open: vi.fn(), fillCheckIn: fill });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    act(() => result.current.updateContext({ path: "/gate/change-over" }));
    act(() => result.current.updateContext({ path: "/gate" }));
    act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "return", transcript: "First name Bob, second name Smith" }));
    expect(fill).toHaveBeenCalledWith({ firstName: "Bob", lastName: "Smith" });
  } finally { unregister(); }
});
it("keeps collecting when the selected gate finishes loading after voice starts", async () => {
  let draft: Record<string, unknown> = { entryRevision: 0 };
  const fill = vi.fn();
  const unregister = registerGateVoiceForm({ read: () => draft, saved: vi.fn(), open: vi.fn(), fillCheckIn: fill });
  try {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => result.current.startConversation(undefined, "/gate"));
    draft = { ...draft, siteLocationId: 9, gateStationId: "gate" };
    act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "loaded", transcript: "First name Bob, second name Smith" }));
    expect(fill).toHaveBeenCalledWith({ firstName: "Bob", lastName: "Smith" });
  } finally { unregister(); }
});
it("opens the microphone while the token is pending, with no history, capability or greeting prerequisite", async () => {
  let resolve!: Function;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(useAskVRealtime);
  let start!: Promise<void>;
  act(() => { start = result.current.startConversation("open AskV", "/gate"); });
  await vi.waitFor(() => expect(env.mic).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledOnce(); expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/voice/session");
  await act(async () => { resolve(new Response(JSON.stringify(config))); await start; });
  expect(env.sessions[0].connect).toHaveBeenCalledWith({ apiKey: "ek_test" });
  expect(env.sessions[0].options.model).toBe("gpt-realtime-2.1");
  expect(env.sessions[0].sendMessage).not.toHaveBeenCalled(); expect(result.current.state).toBe("listening");
});
it("keeps a multi-turn session alive and stops capture immediately on stop", async () => {
  const { result } = renderHook(useAskVRealtime);
  await act(async () => result.current.startConversation());
  act(() => env.handlers.audio_stopped());
  expect(result.current.state).toBe("listening"); expect(env.sessions[0].close).not.toHaveBeenCalled();
  act(() => result.current.stop());
  expect(env.tracks[0].stop).toHaveBeenCalledOnce(); expect(env.sessions[0].close).toHaveBeenCalledOnce();
});
it("delivers screen help requests into an already connected conversation", async () => {
  const { result } = renderHook(useAskVRealtime); await act(async () => result.current.startConversation());
  await act(async () => result.current.startConversation("Explain this Gate map", "/gate/map"));
  expect(env.sessions).toHaveLength(1); expect(env.sessions[0].sendMessage).toHaveBeenCalledWith("Explain this Gate map");
  expect(env.agents.at(-1).instructions).toContain("/gate/map");
});
it("closes late microphone capture after stop without reviving the connection", async () => {
  let resolve!: Function; env.mic.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(useAskVRealtime); let start!: Promise<void>;
  act(() => { start = result.current.startConversation(); });
  await vi.waitFor(() => expect(resolve).toBeDefined()); act(() => result.current.stop());
  await act(async () => { resolve({ getTracks: () => env.tracks, getAudioTracks: () => env.tracks }); await start; });
  expect(env.tracks[0].stop).toHaveBeenCalledOnce(); expect(env.sessions).toHaveLength(0); expect(result.current.state).toBe("stopped");
});
it("updates current Next Steps and guided-control context without reconnecting or fetching", async () => {
  const { result } = renderHook(useAskVRealtime);
  act(() => result.current.updateContext({ path: "/gate", gateGuidance: { companyId: 22, state: "ready", active: { key: "gate-vehicle-check-in", title: "Check in" }, available: [], control: { prompt: "Enter the plate", targetId: "plate" } } }));
  await act(async () => result.current.startConversation());
  expect(env.agents.at(-1).instructions).toContain("Enter the plate");
  act(() => result.current.updateContext({ path: "/gate/history", gateGuidance: null }));
  expect(env.sessions[0].updateAgent).toHaveBeenCalled(); expect(env.agents.at(-1).instructions).toContain("/gate/history");
  expect(env.agents.at(-1).instructions).not.toContain("Enter the plate"); expect(fetch).toHaveBeenCalledOnce();
});
it("holds a page update that arrives while V is still connecting, and applies it once she is connected", async () => {
  let connected!: () => void;
  env.connect = () => new Promise<void>(resolve => { connected = resolve; });
  const { result } = renderHook(useAskVRealtime); let start!: Promise<void>;
  act(() => { start = result.current.startConversation(); });
  await vi.waitFor(() => expect(env.sessions[0]?.connect).toHaveBeenCalled());
  // The voice session refuses an update before its link is up.
  env.sessions[0].updateAgent.mockRejectedValue(new Error("WebRTC data channel is not connected."));
  await act(async () => { result.current.updateContext({ path: "/gate/history" }); });
  expect(result.current.state).toBe("connecting"); expect(result.current.error).toBeNull();
  env.sessions[0].updateAgent.mockResolvedValue(undefined);
  await act(async () => { connected(); await start; });
  expect(result.current.state).toBe("listening");
  expect(env.sessions[0].updateAgent).toHaveBeenCalledOnce(); expect(env.agents.at(-1).instructions).toContain("/gate/history");
});
it("returns workflow offers to the helper UI and uses the actual user utterance for tools", async () => {
  const offer = { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: { siteId: 9 } };
  const onGateWorkflowOffer = vi.fn(), onToolResult = vi.fn();
  const { result } = renderHook(() => useAskVRealtime({ onGateWorkflowOffer, onToolResult, readApplicationContext: () => ({ taskId: "saved-task", selectedConnection: { connectionId: "calendar", scope: "company", personalPermission: false, savePersonalContentToCompany: false } }) }));
  await act(async () => result.current.startConversation());
  act(() => env.handlers.history_updated([{ type: "message", itemId: "u1", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Guide this check-in" }] }]));
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: JSON.stringify(offer) })));
  await act(async () => env.agents[0].tools[0].execute({ workflowKey: "gate-vehicle-check-in", context: { path: "/gate", gateGuidance: {}, gateDraft: {} } }, undefined, { toolCall: { callId: "offer1" } }));
  expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)).toMatchObject({ clientSurface: "web", taskId: "saved-task", selectedConnection: { connectionId: "calendar" }, utterance: { eventId: "u1", text: "Guide this check-in" } });
  expect(onGateWorkflowOffer).toHaveBeenCalledWith(offer); expect(onToolResult).toHaveBeenCalled();
  expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).arguments).toEqual({ workflowKey: "gate-vehicle-check-in", context: {} });
});
it("executes the existing browser navigation and reports its actual result", async () => {
  const { result } = renderHook(useAskVRealtime); await act(async () => result.current.startConversation());
  const intent = { name: "open_screen", arguments: { path: "/gate/history" } };
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: JSON.stringify({ execution: "client", intent }) })));
  const output = await env.agents[0].tools[0].execute({}, undefined, { toolCall: { callId: "nav" } });
  expect(env.intent).toHaveBeenCalledWith(intent); expect(JSON.parse(output).clientResult.ok).toBe(true);
});
it("adds newly selected workflow tools without reconnecting", async () => {
  const { result } = renderHook(useAskVRealtime); await act(async () => result.current.startConversation());
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: "{}", tools: [{ name: "query_tickets", description: "Tickets", parameters: { type: "object", properties: {} } }] })));
  await act(async () => env.agents[0].tools[1].execute({ workflow: "tickets" }, undefined, { toolCall: { callId: "pack" } }));
  expect(env.agents.at(-1).tools[0].name).toBe("query_tickets"); expect(env.sessions).toHaveLength(1);
});
it("keeps partial and completed SDK transcripts in the assistant display", async () => {
  const onTranscript = vi.fn(); const { result } = renderHook(() => useAskVRealtime({ onTranscript }));
  await act(async () => result.current.startConversation());
  act(() => env.handlers.history_updated([{ type: "message", itemId: "a1", role: "assistant", status: "in_progress", content: [{ type: "output_audio", transcript: "Ready" }] }]));
  expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: "a1", content: "Ready", pending: true }), expect.any(String));
});

it("fills a Focus check-in before staging and keeps the selected gate and OCR plate", async () => {
  let draft: Record<string, unknown> = { voiceMode: "check-in", siteLocationId: 9, gateStationId: "selected-gate", vehiclePlate: "ABCD14", plateState: "OK" };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, fill: (values: Record<string, unknown>) => { draft = { ...draft, ...values }; } } as any);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...config, tools: [{ name: "confirm_visitor_check_in", description: "Stage or submit check-in", parameters: { type: "object", properties: {} } }] })));
    const { result } = renderHook(useAskVRealtime);
    act(() => result.current.updateContext({ path: "/gate" }));
    await act(async () => result.current.startConversation());
    act(() => env.handlers.transport_event({ type: "conversation.item.input_audio_transcription.completed", item_id: "help", transcript: "Show me the current gate" }));
    const definition = env.agents[0].tools[0];
    act(() => env.handlers.history_updated([{ type: "message", itemId: "u-focus", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Check in Bob Smith from Bob's Trucking" }] }]));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, requiresConfirmation: true, idempotencyKey: "focus-stage" })));
    await act(async () => definition.execute({ firstName: "Bob", lastName: "Smith", company: "Bob's Trucking" }, undefined, { toolCall: { callId: "focus-stage" } }));
    expect(readGateVoiceDraft()).toMatchObject({ firstName: "Bob", lastName: "Smith", company: "Bob's Trucking", vehiclePlate: "ABCD14", plateState: "OK", siteLocationId: 9, gateStationId: "selected-gate" });
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).gateDraft).toMatchObject({ firstName: "Bob", lastName: "Smith", vehiclePlate: "ABCD14" });
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).arguments).toMatchObject({ vehiclePlate: "ABCD14", plateState: "OK", siteLocationId: 9, gateStationId: "selected-gate" });
  } finally { unregister(); }
});

it("cancels the current Focus draft without looking up an existing visitor", async () => {
  let draft: Record<string, unknown> = { voiceMode: "check-in", siteLocationId: 9, firstName: "Bob", lastName: "Smith" };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, cancel: () => { draft = { voiceMode: "check-in", siteLocationId: 9 }; } } as any);
  try {
    const { result } = renderHook(useAskVRealtime);
    act(() => result.current.updateContext({ path: "/gate" }));
    await act(async () => result.current.startConversation());
    act(() => env.handlers.history_updated([{ type: "message", itemId: "cancel-focus", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Cancel that check-in" }] }]));
    expect(readGateVoiceDraft()).not.toHaveProperty("firstName");
    expect(fetch).toHaveBeenCalledOnce();
  } finally { unregister(); }
});
it("can cancel a quick shift note while preserving an unfinished check-in", async () => {
  let draft: Record<string, unknown> = { voiceMode: "check-in", siteLocationId: 9, firstName: "Bob", vehiclePlate: "ABCD14" };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, cancel: () => { draft = {}; } });
  try {
    const { result } = renderHook(useAskVRealtime);
    act(() => result.current.updateContext({ path: "/gate" }));
    await act(async () => result.current.startConversation());
    act(() => env.handlers.history_updated([{ type: "message", itemId: "note-1", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Add shift note: truck delayed at 8:15" }] }]));
    act(() => env.handlers.history_updated([{ type: "message", itemId: "note-2", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Cancel that note" }] }]));
    expect(readGateVoiceDraft()).toMatchObject({ firstName: "Bob", vehiclePlate: "ABCD14" });
  } finally { unregister(); }
});
it("keeps one note operation identity through its readback and final confirmation", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...config, tools: [{ name: "manage_gate_shift", description: "Add note", parameters: { type: "object", properties: {} } }] })));
  const { result } = renderHook(useAskVRealtime);
  act(() => result.current.updateContext({ path: "/work-hub" }));
  await act(async () => result.current.startConversation());
  act(() => env.handlers.history_updated([{ type: "message", itemId: "note-first", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Add shift note: truck delayed at 8:15" }] }]));
  const args = { action: "add_shift_note", stationId: "station", expectedWatchId: "watch", text: "Truck delayed at 8:15" };
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, requiresConfirmation: true, idempotencyKey: "note-stage" })));
  await act(async () => env.agents[0].tools[0].execute({ ...args, operationId: "model-first" }, undefined, { toolCall: { callId: "note-first" } }));
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).arguments.operationId;
  act(() => env.handlers.history_updated([{ type: "message", itemId: "note-yes", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Yes" }] }]));
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: JSON.stringify({ ok: true, noteId: "saved-note" }) })));
  await act(async () => env.agents[0].tools[0].execute({ ...args, operationId: "model-second" }, undefined, { toolCall: { callId: "note-submit" } }));
  const last = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).arguments.operationId;
  expect(first).toMatch(/^[a-f0-9-]{36}$/i); expect(last).toBe(first);
});
