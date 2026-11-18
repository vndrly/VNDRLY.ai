import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  user: { userId: 11, vendorId: 22 }, options: null as any, state: "stopped", start: vi.fn(async () => {}), stop: vi.fn(), updateContext: vi.fn(), sendText: vi.fn(() => false),
  guidance: undefined as any,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/gate", vi.fn()] }));
vi.mock("@/hooks/use-askv-gate-guidance", () => ({ useAskVGateGuidance: () => env.guidance }));
vi.mock("@/hooks/use-askv-realtime", () => ({ useAskVRealtime: (options: any) => {
  env.options = options;
  return { state: env.state, activeTool: null, error: null, greeting: null, startConversation: env.start, stop: env.stop, updateContext: env.updateContext, sendText: env.sendText };
} }));
import { AskVVoiceProvider, useAskVVoiceSession } from "./use-askv-voice-session";
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}><AskVVoiceProvider>{children}</AskVVoiceProvider></QueryClientProvider>;
beforeEach(() => { vi.clearAllMocks(); env.state = "stopped"; env.sendText.mockReturnValue(false); env.guidance = undefined; window.localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({})))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("starts directly without fetching capabilities, preferences, greeting or history", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(useAskVVoiceSession, { wrapper });
  await act(async () => result.current.startConversation());
  expect(env.start).toHaveBeenCalledWith(undefined, "/gate"); expect(fetch).not.toHaveBeenCalled();
});
it("shares the Next Steps active control with the voice SDK", () => {
  env.guidance = { companyId: 22, control: { targetId: "plate", prompt: "Enter a plate" } };
  renderHook(useAskVVoiceSession, { wrapper }); expect(env.updateContext).toHaveBeenCalledWith({ path: "/gate", gateGuidance: env.guidance });
});
it("attaches actual workflow results to the existing assistant helper controls", () => {
  const { result } = renderHook(useAskVVoiceSession, { wrapper });
  const offer = { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: {} };
  act(() => { env.options.onGateWorkflowOffer(offer); env.options.onToolResult({ name: "offer_gate_workflow", input: {}, output: JSON.stringify(offer) }); env.options.onTranscript({ eventId: "a1", role: "assistant", content: "I can guide you.", pending: true }, "session1"); });
  expect(result.current.assistant?.messages.at(-1)).toMatchObject({ gateWorkflowOffer: offer, content: "I can guide you.", toolCalls: [{ name: "offer_gate_workflow" }] });
  act(() => env.options.onTranscript({ eventId: "a1", role: "assistant", content: "I can guide this check-in.", pending: true }, "session1"));
  expect(result.current.assistant?.messages.at(-1)?.content).toBe("I can guide this check-in.");
});
it("passes selected calendars and saved tasks into protected SDK tool calls", () => {
  const { result } = renderHook(useAskVVoiceSession, { wrapper });
  const selection = { connectionId: "11111111-1111-4111-8111-111111111111", scope: "company" as const, personalPermission: false, savePersonalContentToCompany: false };
  act(() => { result.current.assistant!.selectConnection(selection); result.current.assistant!.selectSavedTask("saved"); });
  expect(env.options.readApplicationContext()).toEqual({ selectedConnection: selection, taskId: "saved" });
});
it("shows personal voice results without persisting them to company history", async () => {
  const { result } = renderHook(useAskVVoiceSession, { wrapper });
  act(() => result.current.assistant!.selectConnection({ connectionId: "private", scope: "personal", personalPermission: true, savePersonalContentToCompany: false }));
  await act(async () => env.options.onTranscript({ eventId: "p1", role: "assistant", content: "Private appointment", pending: false }, "session1"));
  expect(result.current.assistant?.messages.at(-1)?.content).toBe("Private appointment"); expect(fetch).not.toHaveBeenCalled();
});
it("uses the SDK for connected typing and preserves HTTP typing after a voice failure", async () => {
  const { result } = renderHook(useAskVVoiceSession, { wrapper });
  env.sendText.mockReturnValue(true); await act(async () => result.current.sendText("hello")); expect(fetch).not.toHaveBeenCalled();
  env.sendText.mockReturnValue(false);
  vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith("/conversations") ? new Response(JSON.stringify({ id: 8 })) : new Response('event: done\ndata: {"content":"Ready","assistantMessageId":23}\n\n'));
  await act(async () => result.current.sendText("Open Gate")); expect(result.current.assistant?.messages.at(-1)?.content).toBe("Ready");
});
it("stopping voice does not abort an independent typed request", async () => {
  let release!: () => void; let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/conversations")) return new Response(JSON.stringify({ id: 8 }));
    signal = init?.signal as AbortSignal; await new Promise<void>(resolve => { release = resolve; });
    return new Response('event: done\ndata: {"content":"Ready","assistantMessageId":23}\n\n');
  });
  const { result } = renderHook(useAskVVoiceSession, { wrapper }); let pending!: Promise<void>;
  await act(async () => { pending = result.current.sendText("hello"); }); act(() => result.current.stop());
  expect(signal?.aborted).toBe(false); await act(async () => { release(); await pending; });
});
it("honors explicit mute and releases the session when the panel closes without Across VNDRLY", async () => {
  const { result } = renderHook(useAskVVoiceSession, { wrapper });
  act(() => result.current.setMuted(true)); await act(async () => result.current.startConversation());
  expect(env.start).not.toHaveBeenCalled(); expect(localStorage.getItem("askv:muted:11")).toBe("1");
  act(() => result.current.closePanel()); expect(env.stop).toHaveBeenCalled();
});
