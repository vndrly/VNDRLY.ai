import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { userId: 11, vendorId: 22 } as { userId: number; vendorId: number } | null,
  startConversation: vi.fn(async () => undefined),
  stop: vi.fn(),
  setMicEnabled: vi.fn(),
  updateContext: vi.fn(),
  sendText: vi.fn(() => false),
  state: "stopped" as string,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/askv", vi.fn()],
}));

vi.mock("@/hooks/use-askv-realtime", () => ({
  useAskVRealtime: () => ({
    state: mocks.state,
    error: null,
    greeting: "I'm listening.",
    startConversation: mocks.startConversation,
    stop: mocks.stop,
    setMicEnabled: mocks.setMicEnabled,
    updateContext: mocks.updateContext,
    sendText: mocks.sendText,
  }),
}));

vi.mock("@/hooks/use-askv-wake-listener", () => ({
  useAskVWakeListener: () => ({ ready: false, error: null, supported: true }),
}));

import { AskVVoiceProvider, useAskVVoiceSession } from "./use-askv-voice-session";
import { writeAskVMuted } from "@/lib/askv-voice-preferences";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}><AskVVoiceProvider>{children}</AskVVoiceProvider></QueryClientProvider>;
}

describe("AskVVoiceProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.user = { userId: 11, vendorId: 22 };
    mocks.startConversation.mockClear();
    mocks.stop.mockClear();
    mocks.setMicEnabled.mockClear();
  });

  it("persists mute per user and browser without disabling typed AskV", () => {
    const { result } = renderHook(() => useAskVVoiceSession(), { wrapper });
    act(() => {
      result.current.setMuted(true);
    });
    expect(result.current.muted).toBe(true);
    expect(window.localStorage.getItem("askv:muted:11")).toBe("1");
    expect(mocks.stop).toHaveBeenCalled();
    act(() => writeAskVMuted(11, false));
  });
  it('reads stored mute before the first panel-open action', async () => {
    window.localStorage.setItem('askv:muted:11', '1');
    const { result } = renderHook(() => useAskVVoiceSession(), { wrapper });
    await act(async () => result.current.startConversation('open'));
    expect(result.current.muted).toBe(true); expect(mocks.startConversation).not.toHaveBeenCalled();
  });
  it('honors a mute and start in the same event without stale state', async () => {
    const { result } = renderHook(() => useAskVVoiceSession(), { wrapper });
    await act(async () => { result.current.setMuted(true); await result.current.startConversation(); });
    expect(mocks.startConversation).not.toHaveBeenCalled();
  });
  it('enforces a disabled rollout before opening the microphone', async () => {
    window.localStorage.setItem('askvNaturalVoice', '0');
    const { result } = renderHook(() => useAskVVoiceSession(), { wrapper });
    await act(async () => result.current.startConversation());
    expect(mocks.startConversation).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
  });
  it('does not open after the panel closes while capabilities are still loading', async () => {
    let finish!: (response: any) => void;
    vi.stubGlobal('fetch', vi.fn((url) => String(url).includes('/capabilities')
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: false })));
    const { result } = renderHook(() => useAskVVoiceSession(), { wrapper });
    let pending!: Promise<void>;
    act(() => { pending = result.current.startConversation(); });
    act(() => result.current.closePanel());
    await act(async () => { finish({ ok: true, json: async () => ({ enabled: true }) }); await pending; });
    expect(mocks.startConversation).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});
