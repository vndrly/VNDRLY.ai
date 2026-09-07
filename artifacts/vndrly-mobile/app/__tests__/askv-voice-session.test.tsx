import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  user: { id: 7, activeMembershipId: 1, role: "vendor" },
  path: "/askv",
  muted: false,
  across: false,
  background: () => {},
  active: () => {},
  options: [] as any[],
  clients: [] as any[],
  create: vi.fn(),
  configure: vi.fn(),
  release: vi.fn(),
  wake: null as any,
  wakeCallbacks: null as any,
  navigate: vi.fn(),
}));
vi.mock("expo-router", () => ({ usePathname: () => env.path, router: { push: env.navigate } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user, isLoading: false }) }));
vi.mock("@/lib/auth", () => ({
  getUser: async () => env.user,
  getToken: async () => "token",
  subscribeToken: () => () => {},
  subscribeUser: () => () => {},
  setToken: async () => {},
  setUser: async () => {},
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://example.test" }));
vi.mock("@/lib/askv-speech", () => ({ stopAskVSpeech: () => {} }));
vi.mock("@/lib/askv-audio-session", () => ({
  configureAskVAudioSession: env.configure,
  requestAskVMicrophonePermission: async () => {},
  releaseAskVAudioSession: env.release,
  isAskVAppActive: () => true,
  subscribeAskVAppState: (active: () => void, background: () => void) => {
    env.active = active;
    env.background = background;
    return { remove: () => {} };
  },
}));
vi.mock("@/lib/askvVoicePreferences", () => ({
  readAskVMuted: async () => env.muted,
  readAskVAcrossVndrly: async () => env.across,
  writeAskVMuted: async (_id: number, value: boolean) => { env.muted = value; },
  writeAskVAcrossVndrly: async (_id: number, value: boolean) => { env.across = value; },
}));
vi.mock("@/lib/askv-realtime-client", () => ({ createAskVRealtimeClient: env.create }));
vi.mock("@/lib/askv-local-wake", () => ({ createLocalAskVWakeDetector: (callbacks: any) => { env.wakeCallbacks = callbacks; return env.wake; } }));
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: async () => ({ status: "denied" }),
  requestForegroundPermissionsAsync: async () => ({ status: "denied" }),
}));

import { AskVVoiceProvider, useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { subscribeAskVDataChanged } from "@/lib/askv-client-tools";

function client() {
  return { connect: vi.fn().mockResolvedValue(undefined), close: vi.fn(), interrupt: vi.fn(),
    setMicEnabled: vi.fn(), updateContext: vi.fn(), sendText: vi.fn().mockReturnValue(true) };
}
async function flush() { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); }
const wrapper = ({ children }: { children: React.ReactNode }) => <AskVVoiceProvider>{children}</AskVVoiceProvider>;

beforeEach(() => {
  env.user = { id: 7, activeMembershipId: 1, role: "vendor" };
  env.path = "/askv";
  env.muted = false;
  env.across = false;
  env.clients = [];
  env.options = [];
  env.wake = null; env.wakeCallbacks = null;
  env.navigate.mockReset();
  env.create.mockReset().mockImplementation(async (options) => {
    const next = client(); env.clients.push(next); env.options.push(options); return next;
  });
  env.release.mockReset().mockResolvedValue(undefined);
  env.configure.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/chat")
    ? new Response('event: done\ndata: {"content":"Typed reply","assistantMessageId":23}\n\n', { status: 200 })
    : new Response(JSON.stringify(
    url.includes("voice/capabilities") ? { enabled: true } :
    url.includes("voice/greeting") ? { text: "Good morning, Brian. I'm listening." } :
    url.includes("voice/conversation") ? { conversationId: 11, messages: [] } : { ok: true, messageId: 22, tools: [], toolMetadata: [] },
  ), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("mobile AskV session ownership", () => {
  it("honors the server pilot switch before acquiring audio and retains typing", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith("/capabilities") ? new Response('{"enabled":false}') : original(...args));
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    expect(env.create).not.toHaveBeenCalled();
    expect(result.current.error).toBe("askv.naturalVoiceUnavailable");
    await act(async () => { await result.current.assistant.send("Typed question"); });
    expect(result.current.assistant.messages.some(message => message.content === "Typed reply")).toBe(true);
  });
  it("dispatches typed client-intent events and reports the actual UI outcome", async () => {
    env.muted = true;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith("/chat")
      ? new Response('event: client_intent\ndata: {"intent":{"name":"open_screen","arguments":{"screen":"gate"}}}\n\nevent: done\ndata: {"content":"Checked you in","assistantMessageId":23}\n\n') : original(...args));
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.assistant.send("Open Gate"); });
    expect(env.navigate).toHaveBeenCalledWith("/(tabs)/gate");
    expect(result.current.assistant.messages.at(-1)?.content).toBe("Opened the requested screen.");
  });
  it("refreshes existing screens after a server-confirmed typed mutation", async () => {
    env.muted = true;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith("/chat")
      ? new Response('event: mutation\ndata: {"mutation":{"name":"confirm_visitor_check_in","refresh":["gate","visits"]}}\n\nevent: done\ndata: {"content":"Checked in","assistantMessageId":23}\n\n') : original(...args));
    const changed = vi.fn(); const unsubscribe = subscribeAskVDataChanged(changed);
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.assistant.send("Confirm check-in"); });
    expect(changed).toHaveBeenCalledOnce(); unsubscribe();
  });
  it("unmutes a persisted mute without reading the previous React closure", async () => {
    env.muted = true;
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    expect(result.current.muted).toBe(true);
    act(() => result.current.setMuted(false));
    await flush();
    expect(env.clients).toHaveLength(1);
    expect(env.clients[0].connect).toHaveBeenCalledOnce();
  });

  it("coalesces simultaneous opens into one microphone and connection", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await Promise.all([result.current.startConversation(), result.current.startConversation()]); });
    expect(env.clients).toHaveLength(1);
  });
  it("applies the latest screen after navigation during connection", async () => {
    env.across = true;
    let resolve!: (value: any) => void;
    env.create.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    let start!: Promise<void>;
    act(() => { start = result.current.startConversation(); }); await flush();
    env.path = "/ticket/42"; rerender(); await flush();
    const connected = client();
    await act(async () => { resolve(connected); await start; });
    expect(connected.updateContext).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/ticket/42" }));
    const contexts = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/context"));
    expect(JSON.parse(String(contexts.at(-1)![1]?.body))).toMatchObject({ path: "/ticket/42", entityId: 42 });
  });

  it("closes a client that arrives after mute while startup is pending", async () => {
    let resolve!: (value: any) => void;
    env.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    let start!: Promise<void>;
    act(() => { start = result.current.startConversation(); });
    await flush();
    act(() => result.current.setMuted(true));
    const late = client();
    await act(async () => { resolve(late); await start; });
    expect(late.close).toHaveBeenCalled();
    expect(late.connect).not.toHaveBeenCalled();
    expect(result.current.state).toBe("muted");
  });
  it("waits for every overlapping audio cleanup before reopening", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    let releaseAudio!: () => void;
    env.release.mockImplementationOnce(() => new Promise<void>(done => { releaseAudio = done; }));
    let first!: Promise<void>; let second!: Promise<void>; let reopened!: Promise<void>;
    act(() => { first = result.current.stop(); }); await flush();
    act(() => { second = result.current.stop(); }); await flush();
    act(() => { reopened = result.current.startConversation(); }); await flush();
    expect(env.clients).toHaveLength(1);
    await act(async () => { releaseAudio(); await first; await second; await reopened; });
    expect(env.clients).toHaveLength(2);
  });

  it("closes on background, logout/org changes, and unmount", async () => {
    const { result, rerender, unmount } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.background());
    expect(env.clients[0].close).toHaveBeenCalled();
    act(() => env.active());
    await act(async () => { await result.current.startConversation(); });
    env.user = { ...env.user, activeMembershipId: 2 };
    rerender();
    await flush();
    expect(env.clients[1].close).toHaveBeenCalled();
    await act(async () => { await result.current.startConversation(); });
    unmount();
    expect(env.clients[2].close).toHaveBeenCalled();
  });

  it("sends the server greeting to the audio session and waits for playback before idle", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await result.current.startConversation(); });
    expect(env.options[0].greeting).toBe("Good morning, Brian. I'm listening.");
    expect(result.current.state).toBe("greeting");
    act(() => env.options[0].onAudio());
    act(() => { vi.advanceTimersByTime(300_001); });
    expect(env.clients[0].close).not.toHaveBeenCalled();
    act(() => env.options[0].onDone());
    expect(result.current.state).toBe("listening");
    act(() => { vi.advanceTimersByTime(300_001); });
    expect(env.clients[0].close).toHaveBeenCalled();
  });

  it("keeps a new user turn alive beyond the previous idle deadline", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onDone());
    act(() => { vi.advanceTimersByTime(299_999); env.options[0].onSpeechStarted(); vi.advanceTimersByTime(2); });
    expect(env.clients[0].close).not.toHaveBeenCalled();
  });
  it("keeps one native microphone for wake-idle and resumes from the exact wake callback", async () => {
    vi.useFakeTimers(); env.across = true;
    env.wake = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), setDetectionEnabled: vi.fn().mockResolvedValue(undefined), audioSource: { subscribe: vi.fn(), stop: vi.fn() } };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onDone());
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    expect(result.current.state).toBe("wake-idle");
    expect(env.clients[0].close).toHaveBeenCalled();
    expect(env.wake.stop).not.toHaveBeenCalled();
    act(() => env.wakeCallbacks.onWake()); await flush();
    expect(env.clients).toHaveLength(2);
    expect(env.options[1].audioSource).toBe(env.options[0].audioSource);
    act(() => env.wakeCallbacks.onError("AUDIO_INTERRUPTED"));
    expect(env.clients[1].close).toHaveBeenCalled();
    expect(result.current.state).toBe("interrupted");
  });
  it("stops idle wake capture immediately when across-VNDRLY is disabled on AskV", async () => {
    vi.useFakeTimers(); env.across = true;
    env.wake = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), setDetectionEnabled: vi.fn().mockResolvedValue(undefined), audioSource: {} };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onDone());
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    expect(result.current.state).toBe("wake-idle");
    act(() => result.current.setAcrossVndrly(false)); await flush();
    expect(env.wake.stop).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("stopped");
  });
  it("hands the manual microphone over before enabling across-VNDRLY wake capture", async () => {
    vi.useFakeTimers();
    env.wake = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), setDetectionEnabled: vi.fn().mockResolvedValue(undefined), audioSource: {} };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    env.wake.start.mockImplementation(async () => { expect(env.clients[0].close).toHaveBeenCalledOnce(); });
    act(() => result.current.setAcrossVndrly(true)); await flush();
    expect(env.clients).toHaveLength(2);
    expect(env.options[1].audioSource).toBe(env.wake.audioSource);
    act(() => env.options[1].onDone());
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    expect(result.current.state).toBe("wake-idle");
  });
  it("does not let a late wake-idle transition overwrite mute", async () => {
    vi.useFakeTimers(); env.across = true;
    let enable!: () => void;
    env.wake = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
      setDetectionEnabled: vi.fn((enabled: boolean) => enabled ? new Promise<void>(done => { enable = done; }) : Promise.resolve()), audioSource: {} };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onDone());
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    act(() => result.current.setMuted(true));
    await act(async () => enable());
    expect(result.current.state).toBe("muted");
  });
  it("does not restart capture after a newer Stop while enabling across-VNDRLY", async () => {
    env.wake = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), setDetectionEnabled: vi.fn().mockResolvedValue(undefined), audioSource: {} };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    let release!: () => void;
    env.release.mockImplementationOnce(() => new Promise<void>(done => { release = done; }));
    act(() => result.current.setAcrossVndrly(true)); await flush();
    act(() => { void result.current.stop(); });
    await act(async () => release()); await flush();
    expect(env.clients).toHaveLength(1);
    expect(env.wake.start).not.toHaveBeenCalled();
    expect(result.current.state).toBe("stopped");
  });
  it("releases capture when across-VNDRLY is disabled during the transition to wake-idle", async () => {
    vi.useFakeTimers(); env.across = true;
    let enable!: () => void;
    env.wake = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
      setDetectionEnabled: vi.fn((enabled: boolean) => enabled ? new Promise<void>(done => { enable = done; }) : Promise.resolve()), audioSource: {} };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onDone());
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    act(() => result.current.setAcrossVndrly(false));
    await act(async () => enable());
    expect(env.wake.stop).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("stopped");
  });
  it("opens manual voice without starting a wake detector when across-VNDRLY is off", async () => {
    env.wake = { start: vi.fn().mockRejectedValue(new Error("MODEL_INVALID")), stop: vi.fn().mockResolvedValue(undefined), setDetectionEnabled: vi.fn(), audioSource: {} };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    expect(env.wake.start).not.toHaveBeenCalled();
    expect(env.wakeCallbacks).toBeNull();
    expect(result.current.error).toBeNull();
    expect(env.options[0].audioSource).toBeUndefined();
    expect(env.clients[0].connect).toHaveBeenCalled();
    act(() => { env.options[0].onAudio(); env.options[0].onDone(); });
    expect(result.current.state).toBe("listening");
  });
  it("restores conversation audio after an optional wake failure and ignores its late errors", async () => {
    env.across = true;
    const events: string[] = [];
    env.configure.mockImplementation(async () => { events.push("configure"); });
    env.wake = {
      start: vi.fn(async () => { env.wakeCallbacks.onError("MODEL_INVALID"); throw new Error("MODEL_INVALID"); }),
      stop: vi.fn(async () => { events.push("detector-stopped"); }), setDetectionEnabled: vi.fn(), audioSource: {},
    };
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    expect(result.current.wakeSupported).toBe(false);
    expect(result.current.error).toBeNull();
    expect(events).toEqual(["configure", "detector-stopped", "configure"]);
    expect(env.options[0].audioSource).toBeUndefined();
    act(() => { env.options[0].onAudio(); env.options[0].onDone(); env.wakeCallbacks.onError("AUDIO_INTERRUPTED"); });
    expect(env.clients[0].close).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe("listening");
  });
  it("does not start idle while interrupted playback clears during a user utterance", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useAskVVoiceSession, { wrapper }); await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => { env.options[0].onAudio(); env.options[0].onSpeechStarted(); env.options[0].onDone(); vi.advanceTimersByTime(300_001); });
    expect(env.clients[0].interrupt).toHaveBeenCalledOnce();
    expect(env.clients[0].close).not.toHaveBeenCalled();
  });

  it("shows voice and typed turns in one history, and keeps the same conversation after mute", async () => {
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onTranscript({ eventId: "voice-user-1", role: "user", content: "Remember Alpha" }));
    act(() => env.options[0].onTranscript({ eventId: "voice-assistant-1", role: "assistant", content: "Alpha remembered" }));
    await flush();
    env.clients[0].sendText.mockReturnValue("typed-1");
    await act(async () => { await result.current.assistant.send("Continue Alpha"); });
    expect(result.current.assistant.messages.map(message => message.content)).toEqual(["Remember Alpha", "Alpha remembered", "Continue Alpha"]);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/chat"))).toBe(false);
    act(() => result.current.setMuted(true));
    await act(async () => { await result.current.assistant.send("Continue by typing"); });
    const chat = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/chat"))!;
    expect(JSON.parse(String(chat[1]?.body))).toMatchObject({ conversationId: 11, message: "Continue by typing" });
    expect(result.current.assistant.messages.map(message => message.content)).toContain("Typed reply");
    expect(result.current.assistant.messages.map(message => message.content)).toContain("Remember Alpha");
  });

  it("clears the previous organization history when switching organization", async () => {
    const { result, rerender } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onTranscript({ eventId: "private-1", role: "user", content: "Old organization detail" }));
    await flush();
    expect(result.current.assistant.messages).toHaveLength(1);
    env.user = { ...env.user, activeMembershipId: 2 };
    rerender();
    await flush();
    expect(result.current.assistant.messages).toEqual([]);
    expect(result.current.assistant.conversationId).toBeNull();
  });
  it("requires a later persisted user reply before forwarding a confirmation", async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let tools = 0;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith("/tool-call")
      ? new Response(JSON.stringify(++tools === 1 ? { requiresConfirmation: true, idempotencyKey: "action-1" } : { output: '{"ok":true}' }))
      : originalFetch(...args));
    const { result } = renderHook(useAskVVoiceSession, { wrapper });
    await flush();
    await act(async () => { await result.current.startConversation(); });
    act(() => env.options[0].onTranscript({ eventId: "request-1:user", role: "user", content: "Change this item" }));
    await act(async () => { await env.options[0].onToolCall({ name: "edit_item", callId: "action-1", arguments: '{"id":1}' }); });
    let pending: string = "";
    await act(async () => { pending = await env.options[0].onToolCall({ name: "edit_item", callId: "generated-2", arguments: '{"id":1,"idempotencyKey":"action-1","confirmationPhrase":"yes","confirmationEventId":"fabricated"}' }); });
    expect(JSON.parse(pending).awaitingUserConfirmation).toBe(true);
    expect(tools).toBe(1);
    act(() => env.options[0].onTranscript({ eventId: "actual-reply:user", role: "user", content: "Yes, change it" }));
    await act(async () => { await env.options[0].onToolCall({ name: "edit_item", callId: "generated-3", arguments: '{"id":1,"idempotencyKey":"action-1","confirmationPhrase":"yes"}' }); });
    const toolRequests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/tool-call"));
    expect(JSON.parse(String(toolRequests[1][1]?.body))).toMatchObject({ confirmationEventId: "actual-reply:user", idempotencyKey: "action-1", arguments: { id: 1 } });
    const calls = vi.mocked(fetch).mock.calls;
    const savedIndex = calls.findIndex(([url, init]) => String(url).endsWith("/transcript") && String(init?.body).includes("actual-reply:user"));
    expect(savedIndex).toBeGreaterThan(-1);
    expect(savedIndex).toBeLessThan(calls.indexOf(toolRequests[1]));
  });
});
