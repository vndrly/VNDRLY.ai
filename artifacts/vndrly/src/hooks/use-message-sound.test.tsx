import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_CREATED_BROWSER_EVENT } from "@/lib/notifications-api";
import { useMessageSound, useMessageSoundPreference } from "./use-message-sound";

let contexts: FakeAudioContext[];
const start = vi.fn();
class FakeAudioContext {
  state = "suspended";
  destination = {};
  constructor() { contexts.push(this); }
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  decodeAudioData = vi.fn(async () => ({}));
  createBufferSource = vi.fn(() => ({ buffer: null, connect: vi.fn(), start }));
}
function message(userId = 7, notificationId = 12) {
  window.dispatchEvent(new CustomEvent(NOTIFICATION_CREATED_BROWSER_EVENT, { detail: {
    type: "notification.created", userId, notificationId, audible: true,
    notifType: "work_hub_message", createdAt: new Date().toISOString(),
  } }));
}
describe("browser message audio lifecycle", () => {
  beforeEach(() => {
    contexts = []; start.mockClear(); localStorage.clear();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  });
  afterEach(() => vi.unstubAllGlobals());
  it("does not play before interaction, then plays the existing asset once for repeated events", async () => {
    const { unmount } = renderHook(() => useMessageSound(7));
    act(() => message());
    await act(async () => { await Promise.resolve(); });
    expect(contexts).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event("pointerdown")));
    act(() => { message(); message(); });
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    unmount();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });
  it("updates local preferences in the same tab and suppresses playback", async () => {
    const { result, unmount } = renderHook(() => { useMessageSound(7); return useMessageSoundPreference(7); });
    act(() => window.dispatchEvent(new Event("pointerdown")));
    act(() => result.current.setEnabled(false));
    act(() => message());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.enabled).toBe(false); expect(start).not.toHaveBeenCalled();
    unmount();
  });
  it("closes the previous account audio context and never rings its messages for the new account", async () => {
    const { rerender, unmount } = renderHook(({ id }) => useMessageSound(id), { initialProps: { id: 7 } });
    act(() => window.dispatchEvent(new Event("pointerdown")));
    rerender({ id: 8 });
    expect(contexts[0].close).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event("keydown")));
    act(() => { message(7); message(8); });
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(contexts[1].createBufferSource).toHaveBeenCalledOnce();
    unmount();
  });
});
