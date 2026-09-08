import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAskVRealtime } from "./use-askv-realtime";

const fixture = vi.hoisted(() => ({ args: null as any, close: vi.fn(), connect: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/askv-realtime-client", () => ({ createAskVRealtimeClient: (args: any) => {
  fixture.args = args;
  return fixture.create();
} }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/voice/conversation')
    ? { conversationId: 8, messages: [] } : { text: "I'm listening." } })));
  fixture.connect.mockResolvedValue(undefined);
  fixture.create.mockResolvedValue({ close: fixture.close, connect: fixture.connect });
});
afterEach(() => vi.unstubAllGlobals());

describe("AskV session lifetime", () => {
  it("keeps an opted-in continuous session after an answer and closes on stop", async () => {
    const { result } = renderHook(useAskVRealtime);
    await act(async () => { await result.current.startConversation(); });
    act(() => fixture.args.onPlaybackStopped());
    expect(result.current.state).toBe("listening");
    expect(fixture.close).not.toHaveBeenCalled();
    act(() => result.current.stop());
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("stopped");
  });
  it("closes a microphone connection that completes after stop", async () => {
    let resolve!: (value: unknown) => void;
    fixture.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useAskVRealtime);
    let pending!: Promise<void>;
    act(() => { pending = result.current.startConversation(); });
    await act(async () => { await vi.waitFor(() => expect(resolve).toBeDefined()); });
    act(() => result.current.stop());
    await act(async () => {
      resolve({ close: fixture.close, connect: fixture.connect });
      await pending;
    });
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.connect).not.toHaveBeenCalled();
    expect(result.current.state).toBe("stopped");
  });
  it("closes an active microphone on unmount", async () => {
    const { result, unmount } = renderHook(useAskVRealtime);
    await act(async () => { await result.current.startConversation(); });
    unmount();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
});
