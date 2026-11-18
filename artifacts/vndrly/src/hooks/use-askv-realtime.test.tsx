import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ sessions: [] as any[], agents: [] as any[], tracks: [] as any[], mic: vi.fn(), release: vi.fn(), intent: vi.fn(async (_intent?: any) => ({ ok: true })), handlers: {} as Record<string, Function> }));
vi.mock("@workspace/askv-realtime-sdk", () => ({
  RealtimeAgent: class { constructor(options: any) { Object.assign(this, options); env.agents.push(this); } },
  RealtimeSession: class {
    on = vi.fn((name, handler) => { env.handlers[name] = handler; });
    connect = vi.fn(async () => undefined); close = vi.fn(); interrupt = vi.fn(); sendMessage = vi.fn(); updateAgent = vi.fn(async () => undefined);
    constructor(public agent: any, public options: any) { env.sessions.push(this); }
  },
  OpenAIRealtimeWebRTC: class { on = vi.fn(); constructor(public options: any) {} },
  tool: (definition: any) => definition,
}));
vi.mock("@workspace/askv-wake", () => ({ askVMicrophone: { acquire: vi.fn(async () => env.release) } }));
vi.mock("@/lib/askv-client-intents", () => ({
  parseAskVClientIntent: (output: any) => { try { const parsed = typeof output === "string" ? JSON.parse(output) : output; return parsed?.execution === "client" ? parsed.intent : null; } catch { return null; } },
  applyAskVClientIntentVerified: (...args: any[]) => env.intent(args[0]),
}));
vi.mock("@/lib/askv-tool-location", () => ({ addAskVToolLocation: async (_name: string, input: any) => input }));
import { useAskVRealtime } from "./use-askv-realtime";
const config = { clientSecret: "ek_test", model: "gpt-realtime-2.1", voice: "marin", instructions: "You are V", tools: [
  { name: "offer_gate_workflow", description: "Offer help", parameters: { type: "object", properties: {} } },
  { name: "select_tool_pack", description: "Select tools", parameters: { type: "object", properties: {} } },
] };
beforeEach(() => {
  vi.clearAllMocks(); env.sessions.length = 0; env.agents.length = 0; env.handlers = {};
  env.release.mockResolvedValue(undefined); env.tracks = [{ stop: vi.fn() }]; env.mic.mockResolvedValue({ getTracks: () => env.tracks });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: env.mic } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(config))));
});
afterEach(() => vi.unstubAllGlobals());
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
  await act(async () => { resolve({ getTracks: () => env.tracks }); await start; });
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
