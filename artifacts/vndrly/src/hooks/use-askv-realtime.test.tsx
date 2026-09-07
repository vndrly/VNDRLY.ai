import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAskVRealtimeClient } from '@/lib/askv-realtime-client';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  close: vi.fn(),
  interrupt: vi.fn(),
  setMicEnabled: vi.fn(),
  updateContext: vi.fn(),
  applyToolContext: vi.fn(),
  sendText: vi.fn(),
}));

vi.mock("@/lib/askv-realtime-client", () => ({
  createAskVRealtimeClient: vi.fn(async () => mocks),
}));

import { useAskVRealtime } from "./use-askv-realtime";

describe("useAskVRealtime", () => {
  it("passes successful mutation refresh labels to the voice provider", async () => {
    const mutation = { name: "complete_onboarding_step", refresh: ["onboarding"], replayed: false };
    const onMutation = vi.fn();
    const { result } = renderHook(() => useAskVRealtime({ onMutation }));
    await act(async () => result.current.startConversation());
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true, output: '{"ok":true}', mutation }) } as Response);
    const callbacks = vi.mocked(createAskVRealtimeClient).mock.calls.at(-1)![0];
    await act(async () => { await callbacks.onToolCall({ name: "complete_onboarding_step", callId: "step", arguments: { step: "rates", nextStep: "first-employee" } }); });
    expect(onMutation).toHaveBeenCalledWith(mutation);
  });

  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mocks.connect.mockClear();
    mocks.close.mockClear();
    mocks.interrupt.mockClear();
    mocks.setMicEnabled.mockClear();
    mocks.updateContext.mockClear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/greeting")) {
        return { ok: true, json: async () => ({ text: "I'm listening.", style: "short" }) };
      }
      if (String(url).includes('/voice/conversation')) return { ok: true, json: async () => ({ conversationId: 8, messages: [] }) };
      return { ok: true, json: async () => ({ output: "ok" }) };
    }));
  });

  it("starts a multi-turn conversation from panel open and does not close on done", async () => {
    const { result } = renderHook(() => useAskVRealtime({ acrossVndrly: false }));
    await act(async () => {
      await result.current.startConversation("open AskV", "/askv");
    });
    expect(result.current.state).toBe("listening");
    expect(result.current.greeting).toBe("I'm listening.");
    expect(mocks.connect).toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("mutes capture immediately and can publish route context", async () => {
    const { result } = renderHook(() => useAskVRealtime({ acrossVndrly: true }));
    await act(async () => {
      await result.current.startConversation("open AskV", "/askv");
    });
    act(() => {
      result.current.updateContext({ path: "/tickets/1", entityId: 1 });
      result.current.setMicEnabled(false);
    });
    expect(result.current.state).toBe("muted");
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.updateContext).toHaveBeenCalledWith({ path: "/tickets/1", entityId: 1 });
  });
  it('does not revive after mute while the greeting request is pending', async () => {
    let finish!: (response: any) => void;
    vi.mocked(fetch).mockImplementation((url) => String(url).includes('/voice/conversation')
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ ok: true, json: async () => ({}) } as Response));
    const before = vi.mocked(createAskVRealtimeClient).mock.calls.length;
    const { result } = renderHook(() => useAskVRealtime());
    let pending!: Promise<void>;
    act(() => { pending = result.current.startConversation(); });
    act(() => result.current.setMicEnabled(false));
    await act(async () => { finish({ ok: true, json: async () => ({ conversationId: 8, messages: [] }) }); await pending; });
    expect(result.current.state).toBe('muted'); expect(vi.mocked(createAskVRealtimeClient).mock.calls).toHaveLength(before);
  });
  it('closes only five minutes after playback actually finishes', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAskVRealtime({ acrossVndrly: true }));
    await act(async () => result.current.startConversation());
    const callbacks = vi.mocked(createAskVRealtimeClient).mock.calls.at(-1)![0];
    act(() => callbacks.onAudio?.());
    act(() => vi.advanceTimersByTime(6 * 60 * 1000));
    expect(result.current.state).toBe('speaking'); expect(mocks.close).not.toHaveBeenCalled();
    act(() => callbacks.onPlaybackStopped?.());
    act(() => vi.advanceTimersByTime(5 * 60 * 1000));
    expect(result.current.state).toBe('wake-idle'); expect(mocks.close).toHaveBeenCalled();
  });
  it('does not count connection time as post-greeting idle', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAskVRealtime());
    await act(async () => result.current.startConversation());
    act(() => vi.advanceTimersByTime(5 * 60 * 1000));
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it('binds top-level pending confirmation to a later persisted user event and the original key', async () => {
    const requests: any[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/tool-call')) {
        const body = JSON.parse(String(init?.body)); requests.push(body);
        return { ok: true, json: async () => requests.length === 1 ? { ok: false, requiresConfirmation: true, idempotencyKey: body.callId, arguments: body.arguments, message: 'Please confirm.' } : { output: 'done' } } as Response;
      }
      return { ok: true, json: async () => String(url).includes('/conversation') ? { conversationId: 8, messages: [] } : { text: 'Hello' } } as Response;
    });
    let finishSave!: () => void;
    const flush = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
    const { result } = renderHook(() => useAskVRealtime({ flushTranscripts: flush }));
    await act(async () => result.current.startConversation());
    const callbacks = vi.mocked(createAskVRealtimeClient).mock.calls.at(-1)![0];
    callbacks.onTranscript?.({ eventId: 'user:request', role: 'user', content: 'Submit the report.' });
    await act(async () => { await callbacks.onToolCall({ name: 'submit_safety_report', callId: 'original', arguments: { id: 7 } }); });
    callbacks.onTranscript?.({ eventId: 'user:approval', role: 'user', content: 'Yes, submit it.' });
    let pending!: Promise<string>;
    act(() => { pending = callbacks.onToolCall({ name: 'submit_safety_report', callId: 'new-call', arguments: { id: 7, confirmationPhrase: 'model text is not evidence' } }); });
    expect(requests).toHaveLength(1); expect(flush).toHaveBeenCalledOnce();
    await act(async () => { finishSave(); await pending; });
    expect(requests[1]).toMatchObject({ idempotencyKey: 'original', confirmationEventId: 'user:approval' });
  });
});
