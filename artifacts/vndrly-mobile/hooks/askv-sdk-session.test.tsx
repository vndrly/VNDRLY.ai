import React from "react";
import { AppState } from "react-native";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  user: { id: 7, activeMembershipId: 1, role: "vendor" },
  path: "/askv", preference: vi.fn(), mic: vi.fn(), sessions: [] as any[],
  track: { stop: vi.fn() }, fetch: vi.fn(), typedSend: vi.fn(),
  authListeners: [] as (() => void)[], intents: vi.fn(), changed: vi.fn(),
  context: {} as any,
  acrossPreference: vi.fn(),
}));
vi.mock("expo-router", () => ({ usePathname: () => fake.path }));
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
  sdkTransport: () => ({ on: vi.fn(), sendEvent: vi.fn() }),
}));
vi.mock("@/lib/askv-client-tools", () => ({
  executeAskVClientIntent: fake.intents, emitAskVDataChanged: fake.changed,
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
    transport = { on: vi.fn(), sendEvent: vi.fn() };
    constructor(public agent: any, public options: any) { fake.sessions.push(this); }
  },
}));
vi.mock("@/hooks/use-assistant", () => ({
  useAssistant: () => ({
    messages: [], conversationId: null, streaming: false, activeTool: null, error: null,
    getConversationId: () => null, getConversationVersion: () => 1,
    getApplicationContext: () => fake.context,
    restoreConversation: vi.fn(), upsertMessage: vi.fn(), send: fake.typedSend,
    startNew: vi.fn(), clear: vi.fn(), stopGeneration: vi.fn(), loadLatest: vi.fn(),
  }),
}));
import { AskVVoiceProvider, useAskVVoiceSession } from "./use-askv-voice-session";
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
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("SDK-backed AskV", () => {
  it("fills the native check-in with the current OCR plate and selected gate before staging", async () => {
    fake.path = "/gate";
    let draft: Record<string, unknown> = { voiceMode: "check-in", siteLocationId: 9, gateStationId: "selected-gate", vehiclePlate: "ABCD14", plateState: "OK" };
    const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, fill: values => { draft = { ...draft, ...values }; } });
    try {
      fake.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...config, tools: [{ name: "confirm_visitor_check_in", description: "Stage check-in", parameters: { type: "object", properties: {} } }] })));
      const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
      await act(async () => result.current.startConversation());
      fake.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, requiresConfirmation: true, idempotencyKey: "focus-stage" })));
      await act(async () => fake.sessions[0].agent.options.tools[0].execute({ firstName: "Bob", lastName: "Smith", company: "Bob's Trucking" }, undefined, { toolCall: { callId: "focus-stage" } }));
      expect(readGateVoiceDraft()).toMatchObject({ firstName: "Bob", lastName: "Smith", vehiclePlate: "ABCD14", plateState: "OK", siteLocationId: 9, gateStationId: "selected-gate" });
      const call = fake.fetch.mock.calls.find(([url]: any[]) => url.endsWith("/voice/actions"));
      expect(JSON.parse(call[1].body).arguments).toMatchObject({ vehiclePlate: "ABCD14", plateState: "OK", siteLocationId: 9 });
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
    expect(fake.sessions).toHaveLength(1); expect(fake.sessions[0].sendMessage).toHaveBeenCalledWith("Explain this Gate map");
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
  it("routes connected typed turns through the SDK instead of HTTP chat plus TTS", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await act(async () => result.current.startConversation());
    await act(async () => result.current.assistant.send("hello"));
    expect(fake.sessions[0].sendMessage).toHaveBeenCalledWith("hello");
    expect(fake.typedSend).not.toHaveBeenCalled();
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
    expect(fake.sessions[0].sendMessage).toHaveBeenCalledWith("another question");
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
    expect(fake.typedSend).toHaveBeenCalledWith("hello", "ios_text", undefined);
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
});
