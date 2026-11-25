import React from "react";
import { AppState } from "react-native";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  user: { id: 7, activeMembershipId: 1, role: "vendor" },
  path: "/askv", preference: vi.fn(), mic: vi.fn(), sessions: [] as any[],
  track: { stop: vi.fn() }, fetch: vi.fn(), typedSend: vi.fn(), speak: vi.fn(), stopSpeech: vi.fn(),
  onReply: null as null | ((text: string) => void),
  onConfirmation: null as null | ((reference: string, toolName?: string, arguments_?: Record<string, unknown>) => void),
  onMutation: null as null | (() => void),
  invalidate: vi.fn(),
  onClientIntent: null as null | ((intent: { name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; opened?: boolean }>),
  typedStreaming: false,
  typedError: null as string | null,
  authListeners: [] as (() => void)[], intents: vi.fn(), changed: vi.fn(),
  context: {} as any,
  acrossPreference: vi.fn(),
}));
vi.mock("expo-router", () => ({ usePathname: () => fake.path }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: fake.invalidate }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: fake.user }) }));
vi.mock("@/lib/auth", () => ({
  getToken: async () => "token", getCachedToken: () => "token",
  subscribeToken: (listener: () => void) => { fake.authListeners.push(listener); return () => {}; },
  subscribeUser: () => () => {},
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://example.test" }));
vi.mock("@/lib/askvVoicePreferences", () => ({
  readAskVMuted: fake.preference, readAskVAcrossVndrly: fake.acrossPreference,
  writeAskVMuted: async () => {}, writeAskVAcrossVndrly: async () => {},
}));
vi.mock("@/lib/askv-sdk/transport", () => ({
  openAskVMicrophone: fake.mic,
  sdkTransport: () => { const sent = vi.fn(); return { on: vi.fn(), sendEvent: sent, sent, setPlaybackMuted: vi.fn(), updateSessionConfig: vi.fn() }; },
}));
vi.mock("@/lib/askv-speech", () => ({ speakAskV: fake.speak, stopAskVSpeech: fake.stopSpeech }));
vi.mock("@/lib/askv-client-tools", () => ({
  executeAskVClientIntent: fake.intents, emitAskVDataChanged: fake.changed,
  subscribeAskVGatePrefill: () => () => {}, subscribeAskVDataChanged: () => () => {},
}));
vi.mock("@/lib/askv-tool-location", () => ({ withAskVToolLocation: async (_: string, args: unknown) => args }));
vi.mock("@workspace/gate-booth", async () => ({ ...await vi.importActual("@workspace/gate-booth"), notifyGateVoiceSaved: vi.fn() }));
vi.mock("@workspace/askv-realtime-sdk", () => ({
  tool: (definition: unknown) => definition,
  RealtimeAgent: class { constructor(public options: any) {} },
  RealtimeSession: class {
    handlers = new Map<string, (...args: any[]) => void>();
    close = vi.fn(); interrupt = vi.fn(); sendMessage = vi.fn(); updateAgent = vi.fn(async () => {});
    connect = vi.fn(async () => {});
    on = (name: string, callback: (...args: any[]) => void) => this.handlers.set(name, callback);
    emit = (name: string, ...args: any[]) => this.handlers.get(name)?.(...args);
    transport = { on: vi.fn(), sendEvent: vi.fn(), updateSessionConfig: vi.fn() };
    constructor(public agent: any, public options: any) { fake.sessions.push(this); }
  },
}));
vi.mock("@/hooks/use-assistant", () => ({
  useAssistant: (options: { onAssistantReply?: (text: string) => void; onConfirmation?: (reference: string, toolName?: string, arguments_?: Record<string, unknown>) => void; onMutation?: () => void; onClientIntent?: (intent: { name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; opened?: boolean }> }) => {
    fake.onReply = options.onAssistantReply ?? null;
    fake.onConfirmation = options.onConfirmation ?? null;
    fake.onMutation = options.onMutation ?? null;
    fake.onClientIntent = options.onClientIntent ?? null;
    return ({
    messages: [], conversationId: null, streaming: fake.typedStreaming, activeTool: null, error: fake.typedError,
    getConversationId: () => null, getConversationVersion: () => 1,
    getApplicationContext: () => fake.context,
    restoreConversation: vi.fn(), upsertMessage: vi.fn(), send: fake.typedSend,
    startNew: vi.fn(), clear: vi.fn(), stopGeneration: vi.fn(), loadLatest: vi.fn(),
    });
  },
}));
import { AskVVoiceProvider, useAskVVoiceSession } from "./use-askv-voice-session";
import { createGateAskVBridge } from "@/lib/gate-askv-bridge";
import { registerGateVoiceGuidance, notifyGateVoiceGuidanceChanged, subscribeGateVoiceWorkflowResult, registerGateVoiceForm, readGateVoiceDraft } from "@workspace/gate-booth";
const wrapper = ({ children }: { children: React.ReactNode }) => <AskVVoiceProvider>{children}</AskVVoiceProvider>;
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
const config = { clientSecret: "ek_sdk", model: "gpt-realtime-2.1", voice: "marin", instructions: "You are V", tools: [], toolMetadata: [] };
beforeEach(() => {
  fake.sessions = []; fake.authListeners = []; fake.path = "/askv";
  fake.context = {};
  fake.acrossPreference.mockReset().mockResolvedValue(false);
  fake.preference.mockReset().mockResolvedValue(false);
  fake.track.stop.mockReset(); fake.mic.mockReset().mockResolvedValue({ getTracks: () => [fake.track] });
  fake.fetch.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/session") ? config : url.endsWith("/conversation") ? { conversationId: 11, messages: [] } : { ok: true, messageId: 22 },
  )));
  fake.typedSend.mockReset();
  fake.typedSend.mockResolvedValue(undefined);
  fake.speak.mockReset(); fake.stopSpeech.mockReset(); fake.changed.mockReset(); fake.onReply = null; fake.onConfirmation = null; fake.onMutation = null; fake.onClientIntent = null; fake.invalidate.mockReset().mockResolvedValue(undefined); fake.typedStreaming = false; fake.typedError = null;
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("SDK-backed AskV", () => {
  it.each([{ swipe: false, late: false }, { swipe: true, late: false }, { swipe: false, late: true }, { swipe: true, late: true }])("sends Bob Smith through the iOS bridge ($swipe, late gate=$late)", async ({ swipe, late }) => {
    fake.path = "/gate";
    const send = vi.fn(), bridge = createGateAskVBridge(7, send);
    bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "iphone-gate", draft: { voiceMode: "check-in", ...(late ? {} : { siteLocationId: 9, gateStationId: "gate" }), entryRevision: 0 } });
    try {
      const { result } = renderHook(useAskVVoiceSession, { wrapper });
      await act(async () => result.current.startConversation(undefined, undefined, swipe ? { gateFocus: true } : undefined));
      if (late) act(() => bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "iphone-gate", draft: { voiceMode: "check-in", siteLocationId: 9, gateStationId: "gate", entryRevision: 0 } }));
      act(() => fake.sessions[0].emit("transport_event", { type: "conversation.item.input_audio_transcription.completed", item_id: "bob", transcript: "First name Bob, second name Smith, Oklahoma tag ABC497." }));
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "fill-check-in", pageId: "iphone-gate", binding: JSON.stringify([9,"gate",0]), values: expect.objectContaining({ firstName: "Bob", lastName: "Smith", vehiclePlate: "ABC497", plateState: "OK" }) }));
      act(() => fake.sessions[0].emit("transport_event", { type: "conversation.item.input_audio_transcription.completed", item_id: "unlabeled-plate", transcript: "At C11259, Oklahoma." }));
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "fill-check-in", pageId: "iphone-gate", values: expect.objectContaining({ vehiclePlate: "C11259", plateState: "OK" }) }));
      expect(fake.typedSend).not.toHaveBeenCalled();
    } finally { bridge.dispose(); }
  });
  it("starts Gate collection from a swipe without a spoken check-in command", async () => {
    fake.path = "/gate";
    const open = vi.fn(), fill = vi.fn();
    const unregister = registerGateVoiceForm({read:()=>({voiceMode:"check-in",siteLocationId:9,gateStationId:"gate"}),saved:vi.fn(),open,fill});
    try {
      const {result}=renderHook(useAskVVoiceSession,{wrapper});
      await act(async()=>result.current.startConversation(undefined,undefined,{gateFocus:true}));
      expect(open).not.toHaveBeenCalled();
      act(()=>fake.sessions[0].emit("transport_event",{type:"conversation.item.input_audio_transcription.completed",item_id:"visitor",transcript:"First name Jo, last name Perez, company Red Rock, tag WPA321, state Texas"}));
      expect(fill).toHaveBeenCalledWith(expect.objectContaining({firstName:"Jo",lastName:"Perez",vehiclePlate:"WPA321"}));
      expect(fake.typedSend).not.toHaveBeenCalled();
      await act(async()=>result.current.startConversation(undefined,undefined,{gateFocus:true}));
      expect(open).not.toHaveBeenCalled();
    } finally {unregister();}
  });
  it("collects typed Gate corrections and successive visitors, then routes check-out to reasoning", async () => {
    fake.path = "/gate";
    let revision=0;
    const fill=vi.fn(), open=vi.fn();
    const unregister=registerGateVoiceForm({read:()=>({voiceMode:"check-in",siteLocationId:9,gateStationId:"gate",entryRevision:revision}),saved:vi.fn(),open,fill});
    try {
      const {result}=renderHook(useAskVVoiceSession,{wrapper});
      await act(async()=>result.current.startConversation(undefined,undefined,{gateFocus:true}));
      await act(async()=>result.current.assistant.send("First name Jo, last name Perez", "ios_text", undefined, true));
      expect(fill).toHaveBeenLastCalledWith(expect.objectContaining({firstName:"Jo",lastName:"Perez"}));
      revision++;
      await act(async()=>result.current.assistant.send("First name Al, last name Stone", "ios_text", undefined, true));
      expect(fill).toHaveBeenLastCalledWith(expect.objectContaining({firstName:"Al",lastName:"Stone"}));
      await act(async()=>result.current.assistant.send("Check out tag ABC123", "ios_text", undefined, true));
      expect(fake.typedSend).toHaveBeenLastCalledWith("Check out tag ABC123", "ios_text", undefined, true);
    } finally {unregister();}
  });
  it("keeps submission explicit, rejects incomplete confirmation, and cancels the focused draft", async () => {
    fake.path="/gate";
    const confirm=vi.fn(), cancel=vi.fn();
    let draft:Record<string,unknown>={voiceMode:"check-in",silentCheckIn:true,siteLocationId:9,gateStationId:"gate"};
    const unregister=registerGateVoiceForm({read:()=>draft,saved:vi.fn(),open:vi.fn(),confirmCheckIn:confirm,cancel});
    try {
      const {result}=renderHook(useAskVVoiceSession,{wrapper});
      await act(async()=>result.current.startConversation(undefined,undefined,{gateFocus:true}));
      await act(async()=>result.current.assistant.send("submit","ios_text",undefined,true));
      expect(confirm).not.toHaveBeenCalled();
      expect(result.current.checkInError).toContain("Complete the name");
      draft={...draft,firstName:"Jo",lastName:"Perez",company:"Example",vehiclePlate:"ABC123",plateState:"OK"};
      await act(async()=>result.current.assistant.send("submit","ios_text",undefined,true));
      expect(confirm).toHaveBeenCalledOnce();
      await act(async()=>result.current.assistant.send("cancel check in","ios_text",undefined,true));
      expect(cancel).toHaveBeenCalledOnce();
      expect(result.current.checkInReview).toBeNull();
    } finally {unregister();}
  });
  it("refreshes Gate state and note subscribers after a saved AskV mutation", async () => {
    renderHook(useAskVVoiceSession, { wrapper });
    act(() => fake.onMutation?.());
    expect(fake.changed).toHaveBeenCalledOnce();
    expect(fake.invalidate).toHaveBeenCalledWith({ queryKey: ["change-over-state"] });
  });
  it("reads back one prepared shift note, reparses a correction, and submits only after voice approval", async () => {
    fake.path = "/gate";
    const first = pending<void>(), second = pending<void>();
    fake.typedSend.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    const session = fake.sessions[0];
    const hear = async (item_id: string, transcript: string) => {
      act(() => session.emit("transport_event", { type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
      await flush();
    };
    await hear("note", "Add shift note: Barrier damaged at 5:15");
    expect(fake.typedSend).toHaveBeenCalledWith(expect.stringContaining("Add shift note: Barrier damaged at 5:15"), "ios_voice", undefined, true);
    expect(result.current.shiftNoteDraft).toEqual({ text: "Barrier damaged at 5:15", status: "preparing" });
    act(() => fake.onConfirmation?.("first", "manage_gate_shift", { action: "add_shift_note", text: "Barrier damaged at 5:15" }));
    expect(fake.speak).toHaveBeenCalledOnce();
    expect(fake.speak.mock.calls[0][0]).toBe("Shift note: Barrier damaged at 5:15. Confirm?");
    act(() => fake.onReply?.("Barrier damaged at 5:15. Confirm?"));
    expect(fake.speak).toHaveBeenCalledOnce();
    first.resolve(); await flush();
    await hear("correction", "Change 5:15 to 5:50");
    expect(result.current.shiftNoteDraft?.text).toBe("Barrier damaged at 5:50");
    expect(fake.typedSend).toHaveBeenCalledWith(expect.stringContaining("Add shift note: Barrier damaged at 5:50"), "ios_voice", undefined, true);
    act(() => fake.onConfirmation?.("second", "manage_gate_shift", { action: "add_shift_note", text: "Barrier damaged at 5:50" }));
    expect(fake.speak).toHaveBeenCalledTimes(2);
    act(() => fake.onReply?.("Barrier damaged at 5:50. Confirm?"));
    second.resolve(); await flush();
    await hear("approve", "Yes");
    expect(fake.typedSend).toHaveBeenLastCalledWith("Confirm", "ios_voice", "second", true);
    expect(result.current.shiftNoteDraft?.status).toBe("submitting");
  });
  it("lets the reasoning engine revise a conversational correction before approval", async () => {
    fake.path = "/gate";
    const first = pending<void>(), revision = pending<void>();
    fake.typedSend.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => revision.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    const session = fake.sessions[0];
    const hear = async (item_id: string, transcript: string) => {
      act(() => session.emit("transport_event", { type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
      await flush();
    };
    await hear("draft", "Add shift note: Barrier damaged at 5:15");
    act(() => fake.onConfirmation?.("first", "manage_gate_shift", { action: "add_shift_note", text: "Barrier damaged at 5:15" }));
    first.resolve(); await flush();
    await hear("natural", "No, it happened closer to 5:50");
    expect(fake.typedSend).toHaveBeenLastCalledWith(expect.stringContaining("Operator correction: No, it happened closer to 5:50"), "ios_voice", undefined, true);
    act(() => fake.onConfirmation?.("revised", "manage_gate_shift", { action: "add_shift_note", text: "Barrier damaged around 5:50" }));
    expect(result.current.shiftNoteDraft).toEqual({ text: "Barrier damaged around 5:50", status: "ready" });
    expect(fake.speak.mock.calls.at(-1)?.[0]).toBe("Shift note: Barrier damaged around 5:50. Confirm?");
    expect(fake.typedSend).not.toHaveBeenCalledWith("Confirm", "ios_voice", expect.anything(), true);
    revision.resolve(); await flush();
  });
  it("surfaces a reasoning failure in the compact voice panel", async () => {
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    fake.typedError = "AskV could not finish the request.";
    rerender();
    expect(result.current.error).toBe("AskV could not finish the request.");
  });
  it.each(["Check in", "Check out"])("cuts off Gate playback on the recognized trigger %s", async transcript => {
    fake.path = "/gate";
    const open = vi.fn(), fill = vi.fn();
    const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9 }), saved: vi.fn(), open, fill });
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    try {
      await act(async () => result.current.startConversation(undefined, undefined, { gateFocus: false }));
      const session = fake.sessions[0];
      const { transport, config: audio } = session.options;
      expect(audio.audio.input.turnDetection.interruptResponse).toBe(false);
      const emit = (event: Record<string, unknown>) => act(() => session.emit("transport_event", event));
      emit({ type: "output_audio_buffer.started" });
      expect(result.current.state).toBe("speaking");
      emit({ type: "input_audio_buffer.speech_started", item_id: "trigger" });
      expect(session.interrupt).not.toHaveBeenCalled();
      emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "trigger", delta: transcript });
      expect(session.interrupt).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
      expect(fill).not.toHaveBeenCalled();
      emit({ type: "input_audio_buffer.speech_stopped", item_id: "trigger" });
      emit({ type: "output_audio_buffer.cleared" });
      emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "trigger", transcript });
      expect(transport.setPlaybackMuted).toHaveBeenLastCalledWith(transcript === "Check in");
      expect(session.interrupt).toHaveBeenCalledOnce();
    } finally { unregister(); }
  });
  it("previews conversational details and accepts a single confirmation from voice or tap", async () => {
    fake.path = "/gate";
    let draft: Record<string, unknown> = { siteLocationId: 9, gateStationId: "selected-gate", entryRevision: 0 };
    const saving = pending<void>();
    const confirm = vi.fn(async () => {
      await saving.promise;
      draft = { siteLocationId: 9, gateStationId: "selected-gate", entryRevision: 1 };
    });
    const unregister = registerGateVoiceForm({
      read: () => draft,
      saved: vi.fn(),
      open: () => { draft.silentCheckIn = true; },
      fillCheckIn: values => { draft = { ...draft, ...values }; },
      confirmCheckIn: confirm,
    });
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    try {
      await act(async () => result.current.startConversation());
      const session = fake.sessions[0];
      const hear = (item_id: string, transcript: string) => act(() => session.emit("transport_event", {
        type: "conversation.item.input_audio_transcription.completed", item_id, transcript,
      }));
      hear("start", "Check in.");
      hear("name", "John Elleryk.");
      expect(result.current.checkInReview).toMatchObject({ firstName: "John", lastName: "Elleryk", ready: false });
      hear("details", "V, uh, check in John Elleryk, John's Trucking, um, Oklahoma tag ABC 123.");
      expect(result.current.checkInReview).toMatchObject({
        firstName: "John", lastName: "Elleryk", company: "John's Trucking", vehiclePlate: "ABC123", plateState: "OK", ready: true,
      });
      expect(confirm).not.toHaveBeenCalled();
      const key = result.current.checkInReview!.key;
      hear("approval", "Confirm.");
      await act(async () => result.current.confirmCheckIn(key));
      hear("duplicate", "Confirm.");
      expect(confirm).toHaveBeenCalledExactlyOnceWith(key);
      await act(async () => saving.resolve());
      expect(result.current.checkInReview).toBeNull();
      expect(session.options.transport.sent).not.toHaveBeenCalledWith({ type: "response.create" });
    } finally { unregister(); }
  });
  it("keeps check-in transcripts out of AskV and fills a second visitor independently", async () => {
    fake.path = "/gate";
    let entryRevision = 0;
    const open = vi.fn(), fill = vi.fn();
    const unregister = registerGateVoiceForm({ read: () => ({ siteLocationId: 9, gateStationId: "selected-gate", entryRevision }), saved: vi.fn(), open, fill });
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    try {
      await act(async () => result.current.startConversation());
      const session = fake.sessions[0];
      const { config: sessionConfig, transport } = session.options;
      expect(sessionConfig.audio.input.turnDetection.createResponse).toBe(false);
      const hear = (item_id: string, transcript: string) => act(() => session.emit("transport_event", { type: "conversation.item.input_audio_transcription.completed", item_id, transcript }));
      hear("first", "Check in. First name Jo, last name Perez, company Red Rock, tag WPA321, state Texas");
      hear("ignore", "Submit and tell me who is on site");
      entryRevision++;
      hear("second", "Check in Al Stone from MidCon, Oklahoma plate S T X four six seven");
      expect(open).toHaveBeenCalledTimes(2);
      expect(fill.mock.calls).toEqual([
        [{ firstName: "Jo", lastName: "Perez", company: "Red Rock", vehiclePlate: "WPA321", plateState: "TX" }],
        [{ firstName: "Al", lastName: "Stone", company: "MidCon", vehiclePlate: "STX467", plateState: "OK" }],
      ]);
      expect(transport.sent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "response.create" }));
      expect(transport.setPlaybackMuted).toHaveBeenLastCalledWith(true);
      expect(fake.fetch).toHaveBeenCalledOnce();
    } finally { unregister(); }
  });
  it("keeps the same note identity from staging through confirmation on native", async () => {
    const definition = { name: "manage_gate_shift", description: "Add note", parameters: { type: "object", properties: {} } };
    fake.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith("/session") ? { ...config, tools: [definition] } : url.endsWith("/actions") ? { ok: false, requiresConfirmation: true, idempotencyKey: "note-stage" } : { conversationId: 11, messageId: 22 })));
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await act(async () => result.current.startConversation());
    const args = { action: "add_shift_note", stationId: "11111111-1111-4111-8111-111111111111", expectedWatchId: "22222222-2222-4222-8222-222222222222", text: "East gate arm is sticking." };
    await act(async () => fake.sessions[0].agent.options.tools[0].execute({ ...args, operationId: "model-first" }, undefined, { toolCall: { callId: "note1" } }));
    await act(async () => fake.sessions[0].agent.options.tools[0].execute({ ...args, operationId: "model-second" }, undefined, { toolCall: { callId: "note2" } }));
    const requests = fake.fetch.mock.calls.filter(([url]) => url.endsWith("/actions")).map(([, init]) => JSON.parse(init.body));
    expect(requests[0].arguments.operationId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(requests[1].arguments.operationId).toBe(requests[0].arguments.operationId);
    expect(requests[1].idempotencyKey).toBe("note-stage");
  });
  it("fills the native check-in with the current OCR plate and selected gate before staging", async () => {
    fake.path = "/gate";
    let draft: Record<string, unknown> = { voiceMode: "check-in", siteLocationId: 9, gateStationId: "selected-gate", vehiclePlate: "ABCD14", plateState: "OK" };
    const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, fill: values => { draft = { ...draft, ...values }; } });
    try {
      fake.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...config, tools: [{ name: "confirm_visitor_check_in", description: "Stage check-in", parameters: { type: "object", properties: {} } }] })));
      const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
      await act(async () => result.current.startConversation(undefined, undefined, { gateFocus: false }));
      fake.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, requiresConfirmation: true, idempotencyKey: "focus-stage" })));
      await act(async () => fake.sessions[0].agent.options.tools[0].execute({ firstName: "Bob", lastName: "Smith", company: "Bob's Trucking" }, undefined, { toolCall: { callId: "focus-stage" } }));
      expect(readGateVoiceDraft()).toMatchObject({ firstName: "Bob", lastName: "Smith", vehiclePlate: "ABCD14", plateState: "OK", siteLocationId: 9, gateStationId: "selected-gate" });
      const call = fake.fetch.mock.calls.find(([url]: any[]) => url.endsWith("/voice/actions"));
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body).arguments).toMatchObject({ vehiclePlate: "ABCD14", plateState: "OK", siteLocationId: 9 });
    } finally { unregister(); }
  });
  it("cancels a native Focus draft instead of finding an active visitor", async () => {
    fake.path = "/gate";
    let draft: Record<string, unknown> = { voiceMode: "check-in", siteLocationId: 9, firstName: "Bob" };
    const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, cancel: () => { draft = { voiceMode: "check-in", siteLocationId: 9 }; } });
    try {
      const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
      await act(async () => result.current.startConversation());
      act(() => fake.sessions[0].emit("history_updated", [{ type: "message", itemId: "cancel-focus", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Cancel that check-in" }] }]));
      expect(readGateVoiceDraft()).not.toHaveProperty("firstName");
      expect(fake.fetch.mock.calls.filter(([url]: any[]) => url.endsWith("/voice/actions"))).toHaveLength(0);
    } finally { unregister(); }
  });
  it("loads and navigates with the microphone off even when Across VNDRLY was saved on", async () => {
    fake.acrossPreference.mockResolvedValue(true);
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    expect(result.current.acrossVndrly).toBe(true); expect(fake.mic).not.toHaveBeenCalled(); expect(fake.fetch).not.toHaveBeenCalled();
    fake.path = "/gate"; rerender(); await flush();
    expect(fake.mic).not.toHaveBeenCalled(); expect(result.current.state).toBe("stopped");
  });
  it("treats Across VNDRLY as a continuation preference rather than a Start V command", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    act(() => result.current.setAcrossVndrly(true)); await flush();
    expect(fake.mic).not.toHaveBeenCalled(); expect(fake.fetch).not.toHaveBeenCalled();
    await act(async () => result.current.startConversation()); expect(fake.mic).toHaveBeenCalledOnce();
  });
  it("does not turn the microphone back on when the app returns to the foreground", async () => {
    const changes = vi.spyOn(AppState, "addEventListener");
    try {
      const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
      act(() => result.current.setAcrossVndrly(true)); await act(async () => result.current.startConversation());
      const listener = changes.mock.calls.find(call => call[0] === "change")![1];
      act(() => listener("background")); await flush(); act(() => listener("active")); await flush();
      expect(fake.mic).toHaveBeenCalledOnce(); expect(result.current.state).toBe("stopped");
    } finally { changes.mockRestore(); }
  });
  it("delivers another screen's help request into the existing conversation", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await act(async () => result.current.startConversation());
    await act(async () => result.current.startConversation("Explain this Gate map"));
    expect(fake.sessions).toHaveLength(1); expect(fake.typedSend).toHaveBeenCalledWith("Explain this Gate map", "ios_voice", undefined, true);
  });
  it("shares current Next Steps and focused control with the same live SDK session", async () => {
    let guidance: any = { companyId: 22, state: "ready", active: { key: "gate-vehicle-check-in", title: "Check in" }, available: [], control: { prompt: "Enter the plate", targetId: "plate" } };
    const unregister = registerGateVoiceGuidance(() => guidance);
    try {
      const { result } = renderHook(useAskVVoiceSession, { wrapper }); await act(async () => result.current.startConversation());
      expect(fake.sessions[0].agent.options.instructions).toContain("Enter the plate");
      guidance = { ...guidance, control: { prompt: "Enter the first name", targetId: "firstName" } };
      act(() => notifyGateVoiceGuidanceChanged());
      expect(fake.sessions[0].updateAgent.mock.calls.at(-1)[0].options.instructions).toContain("Enter the first name");
      expect(fake.fetch).toHaveBeenCalledOnce();
    } finally { unregister(); }
  });
  it("carries selected integrations and returns workflow offers to the actual Gate guide", async () => {
    fake.context = { taskId: "task", selectedConnection: { connectionId: "calendar", scope: "company" } };
    const offer = { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: {} };
    const receive = vi.fn(), unsubscribe = subscribeGateVoiceWorkflowResult(receive);
    fake.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith("/session") ? { ...config, tools: [{ name: "offer_gate_workflow", description: "Help", parameters: { type: "object", properties: {} } }] } : url.endsWith("/actions") ? { ok: true, output: JSON.stringify(offer) } : { conversationId: 11 })));
    try {
      const { result } = renderHook(useAskVVoiceSession, { wrapper }); await act(async () => result.current.startConversation());
      await act(async () => fake.sessions[0].agent.options.tools[0].execute({}, undefined, { toolCall: { callId: "guide" } }));
      const action = fake.fetch.mock.calls.find((call: any[]) => call[0].endsWith("/actions"));
      expect(action).toBeDefined(); expect(JSON.parse(action![1].body)).toMatchObject(fake.context);
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({ gateWorkflowOffer: offer }));
    } finally { unsubscribe(); }
  });
  it("keeps personal calendar speech out of company transcript storage", async () => {
    fake.context = { selectedConnection: { connectionId: "private", scope: "personal", personalPermission: true, savePersonalContentToCompany: false } };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await act(async () => result.current.startConversation());
    act(() => fake.sessions[0].emit("history_updated", [{ type: "message", itemId: "private-result", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Private appointment" }] }]));
    await flush(); expect(result.current.assistant.messages.at(-1)?.content).toBe("Private appointment");
    expect(fake.fetch).toHaveBeenCalledOnce();
  });
  it("opens the mic while both preferences and the token exchange are still pending", async () => {
    fake.path = "/gate";
    const preferences = pending<boolean>(), token = pending<Response>();
    fake.preference.mockReturnValue(preferences.promise); fake.fetch.mockReturnValue(token.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    let starting!: Promise<void>;
    act(() => { starting = result.current.startConversation(); }); await flush();
    expect(fake.mic).toHaveBeenCalledTimes(1);
    expect(fake.fetch).toHaveBeenCalledWith("https://example.test/api/assistant/voice/session", expect.anything());
    token.resolve(new Response(JSON.stringify(config))); await act(async () => starting);
    expect(result.current.state).toBe("listening");
    preferences.resolve(true); await flush();
    expect(result.current.muted).toBe(false);
    expect(result.current.state).toBe("listening");
  });
  it("connects one SDK session for overlapping taps, without a greeting or history prerequisite", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => Promise.all([result.current.startConversation(), result.current.startConversation()]));
    expect(fake.mic).toHaveBeenCalledTimes(1); expect(fake.sessions).toHaveLength(1);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(fake.sessions[0].connect).toHaveBeenCalledWith({ apiKey: "ek_sdk" });
    expect(fake.sessions[0].sendMessage).not.toHaveBeenCalled();
  });
  it("stops capture immediately even if the token request has not returned", async () => {
    const token = pending<Response>(); fake.fetch.mockReturnValue(token.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    let starting!: Promise<void>; act(() => { starting = result.current.startConversation(); }); await flush();
    await act(async () => result.current.stop());
    expect(fake.track.stop).toHaveBeenCalled();
    token.resolve(new Response(JSON.stringify(config))); await act(async () => starting);
    expect(fake.sessions).toHaveLength(0);
  });
  it("stops a microphone that resolves after Stop", async () => {
    const mic = pending<any>(); fake.mic.mockReturnValue(mic.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    let starting!: Promise<void>; act(() => { starting = result.current.startConversation(); }); await flush();
    await act(async () => result.current.stop());
    mic.resolve({ getTracks: () => [fake.track] }); await act(async () => starting);
    expect(fake.track.stop).toHaveBeenCalled(); expect(fake.sessions).toHaveLength(0);
  });
  it("routes connected typed turns through the same reasoning path as offline typing", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    await act(async () => result.current.assistant.send("hello"));
    expect(fake.sessions[0].sendMessage).not.toHaveBeenCalled();
    expect(fake.typedSend).toHaveBeenCalledWith("hello", "ios_text", undefined, false);
  });
  it("delegates spoken work to the text reasoning route and reads its short result", async () => {
    fake.path = "/gate";
    const response = pending<void>();
    fake.typedSend.mockReturnValue(response.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    const session = fake.sessions[0];
    act(() => session.emit("transport_event", {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "shift-question", transcript: "Who's on shift at Outer Circle?",
    }));
    await flush();
    expect(fake.typedSend).toHaveBeenCalledWith("Who's on shift at Outer Circle?", "ios_voice", undefined, true);
    expect(session.options.transport.sent).not.toHaveBeenCalledWith({ type: "conversation.item.delete", item_id: "shift-question" });
    act(() => session.emit("transport_event", { type: "conversation.item.retrieved", item: { id: "shift-question" } }));
    expect(session.options.transport.sent).toHaveBeenCalledWith({ type: "conversation.item.delete", item_id: "shift-question" });
    expect(session.options.transport.sent).not.toHaveBeenCalledWith({ type: "response.create" });
    expect(result.current.state).toBe("thinking");
    act(() => fake.onReply?.("John is on shift at Outer Circle."));
    expect(fake.speak).toHaveBeenCalledWith("John is on shift at Outer Circle.", "en-US", true, expect.any(Function));
    expect(result.current.state).toBe("speaking");
    act(() => fake.speak.mock.calls.at(-1)?.[3]());
    expect(result.current.state).toBe("listening");
    await act(async () => response.resolve());
  });
  it("blocks a second Realtime answer path while leaving transcription events available", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    const transport = fake.sessions[0].options.transport;
    act(() => {
      transport.sendEvent({ type: "response.create" });
      transport.sendEvent({ type: "conversation.item.delete", item_id: "completed-transcript" });
    });
    expect(transport.sent).not.toHaveBeenCalledWith({ type: "response.create" });
    expect(transport.sent).toHaveBeenCalledWith({ type: "conversation.item.delete", item_id: "completed-transcript" });
    expect(fake.typedSend).not.toHaveBeenCalled();
  });
  it("waits for a typed answer before sending a spoken request", async () => {
    fake.path = "/gate";
    fake.typedStreaming = true;
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    act(() => fake.sessions[0].emit("transport_event", {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "queued-question", transcript: "Who is on shift?",
    }));
    await flush();
    expect(fake.typedSend).not.toHaveBeenCalled();
    fake.typedStreaming = false;
    rerender();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    expect(fake.typedSend).toHaveBeenCalledWith("Who is on shift?", "ios_voice", undefined, true);
  });
  it("keeps consecutive spoken requests in order through the reasoning engine", async () => {
    const first = pending<void>();
    fake.typedSend.mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    const hear = (item_id: string, transcript: string) => act(() => fake.sessions[0].emit("transport_event", {
      type: "conversation.item.input_audio_transcription.completed", item_id, transcript,
    }));
    hear("first", "Who is on shift?");
    hear("second", "Which gate is open?");
    await flush();
    expect(fake.typedSend).toHaveBeenCalledTimes(1);
    expect(fake.typedSend).toHaveBeenNthCalledWith(1, "Who is on shift?", "ios_voice", undefined, true);
    await act(async () => first.resolve());
    await flush();
    expect(fake.typedSend).toHaveBeenNthCalledWith(2, "Which gate is open?", "ios_voice", undefined, true);
  });
  it("ignores a stale speech completion after a newer spoken request starts", async () => {
    const first = pending<void>();
    const second = pending<void>();
    fake.typedSend.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    const hear = (item_id: string, transcript: string) => act(() => fake.sessions[0].emit("transport_event", {
      type: "conversation.item.input_audio_transcription.completed", item_id, transcript,
    }));
    hear("first", "Who is on shift?"); await flush();
    act(() => fake.onReply?.("John is on shift."));
    const oldDone = fake.speak.mock.calls.at(-1)?.[3];
    await act(async () => first.resolve());
    hear("second", "Which gate is open?"); await flush();
    expect(result.current.state).toBe("thinking");
    expect(fake.stopSpeech).toHaveBeenCalled();
    act(() => oldDone?.());
    expect(result.current.state).toBe("thinking");
    await act(async () => second.resolve());
  });
  it("keeps replying while transcript persistence is stalled", async () => {
    const history = pending<Response>();
    fake.fetch.mockImplementation(async (url: string) => url.endsWith("/session") ? new Response(JSON.stringify(config)) : history.promise);
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    act(() => fake.sessions[0].emit("history_updated", [
      { type: "message", itemId: "a1", role: "assistant", status: "completed", content: [{ type: "output_audio", transcript: "Hello" }] },
    ])); await flush();
    await act(async () => result.current.assistant.send("another question"));
    expect(fake.typedSend).toHaveBeenCalledWith("another question", "ios_text", undefined, false);
    expect(result.current.assistant.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: "Hello" })]));
  });
  it("closes the SDK and microphone when authentication changes", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    act(() => fake.authListeners.forEach(listener => listener()));
    expect(fake.sessions[0].close).toHaveBeenCalled(); expect(fake.track.stop).toHaveBeenCalled();
  });
  it("retains protected tool dispatch and cannot turn model metadata into user approval", async () => {
    const definition = { name: "mark_notifications_read", description: "Mark notifications", parameters: { type: "object", properties: {} } };
    const wire = { ...config, tools: [definition], toolMetadata: [{ name: definition.name, mutating: true }] };
    fake.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/session") ? wire : url.endsWith("/conversation") ? { conversationId: 11 } : { ok: true, messageId: 22 },
    )));
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    act(() => fake.sessions[0].emit("history_updated", [
      { type: "message", itemId: "u1", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Mark them read" }] },
    ])); await flush();
    await act(async () => fake.sessions[0].agent.options.tools[0].execute(
      { markAll: true, confirmed: true, confirmationPhrase: "I confirm", confirmationEventId: "forged" },
      {}, { toolCall: { callId: "call-1" } },
    ));
    const body = JSON.parse(fake.fetch.mock.calls.find(([url]) => url.endsWith("/actions"))![1].body);
    expect(body).toMatchObject({ callId: "call-1", utterance: { eventId: "u1", text: "Mark them read" }, arguments: { markAll: true } });
    expect(body.confirmationEventId).toBeUndefined();
    expect(body.arguments.confirmed).toBeUndefined();
  });
  it("keeps typed fallback when voice is stopped", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.assistant.send("hello"));
    expect(fake.typedSend).toHaveBeenCalledWith("hello", "ios_text", undefined, false);
  });
  it("starts from a persisted mute when the user explicitly presses Start", async () => {
    fake.preference.mockResolvedValue(true);
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    expect(result.current.muted).toBe(true);
    act(() => result.current.setMuted(false)); await flush();
    expect(result.current.state).toBe("listening"); expect(result.current.muted).toBe(false);
  });
  it("closes the prior session and history on an organization change", async () => {
    fake.context = { taskId: "old-company-task" };
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    fake.user = { ...fake.user, activeMembershipId: 2 }; fake.context = {}; rerender(); await flush();
    expect(fake.sessions[0].close).toHaveBeenCalled(); expect(fake.track.stop).toHaveBeenCalled();
    expect(result.current.assistant.messages).toEqual([]);
    expect(fake.mic).toHaveBeenCalledOnce();
  });
  it("does not disconnect an app-wide session when navigating between operational screens", async () => {
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    act(() => result.current.setAcrossVndrly(true));
    fake.path = "/gate"; rerender(); await flush();
    expect(fake.sessions).toHaveLength(1); expect(fake.sessions[0].close).not.toHaveBeenCalled();
  });
  it("keeps focus for an AskV-opened page even when cross-portal voice is off", async () => {
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    fake.intents.mockResolvedValueOnce({ ok: true, opened: true, message: "Opened Gate." });
    await act(async () => {
      await fake.onClientIntent?.({ name: "open_screen", arguments: { screen: "gate" } });
    });
    fake.path = "/gate"; rerender(); await flush();
    expect(fake.sessions[0].close).not.toHaveBeenCalled();
    expect(fake.track.stop).not.toHaveBeenCalled();
    fake.path = "/profile"; rerender(); await flush();
    expect(fake.sessions[0].close).toHaveBeenCalled();
  });
});

it("keeps the same voice session across Work Hub pages with cross-portal voice disabled", async () => {
 fake.path = "/work-hub/calendar";
 const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
 await flush();
 await act(async () => result.current.startConversation());
 const session = fake.sessions[0];
 for (const path of ["/work-hub/chat", "/work-hub/profile", "/work-hub"]) {
   fake.path = path; rerender(); await flush();
   expect(fake.sessions).toHaveLength(1);
   expect(session.close).not.toHaveBeenCalled();
   expect(fake.track.stop).not.toHaveBeenCalled();
 }
 fake.path = "/gate"; rerender(); await flush();
 expect(session.close).toHaveBeenCalled();
});
