import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ create: vi.fn(), transcribe: vi.fn(), remove: vi.fn(), background: () => {} }));
vi.mock("@/lib/ptt", () => ({ createPttRecorder: env.create }));
vi.mock("@/lib/askv-transcribe", () => ({ transcribeAskVRecording: env.transcribe, deleteAskVRecording: env.remove }));
vi.mock("@/lib/askv-audio-session", () => ({ subscribeAskVAppState: (_active: () => void, background: () => void) => {
  env.background = background; return { remove: () => {} };
} }));
import { useAskVRecording } from "@/hooks/use-askv-recording";
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
beforeEach(() => { vi.clearAllMocks(); env.transcribe.mockResolvedValue("Question"); env.remove.mockResolvedValue(undefined); });
afterEach(cleanup);
describe("AskV manual recording fallback", () => {
  it("disposes a recording whose microphone permission resolves after the finger is released", async () => {
    const start = deferred<void>();
    const recorder = { start: vi.fn(() => start.promise), stop: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
    env.create.mockResolvedValue(recorder);
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useAskVRecording({ enabled: true, beforeStart: async () => {}, onTranscript, onError: vi.fn() }));
    act(() => result.current.pressIn()); await flush();
    act(() => result.current.pressOut());
    await act(async () => { start.resolve(); await start.promise; });
    expect(result.current.recording).toBe(false);
    expect(recorder.dispose).toHaveBeenCalled();
    expect(env.transcribe).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });
  it("aborts a released recording's transcript on mute or background without sending it", async () => {
    const text = deferred<string>(); env.transcribe.mockReturnValue(text.promise);
    const recorder = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue({ uri: "file://askv.m4a", durationSeconds: 2 }), dispose: vi.fn().mockResolvedValue(undefined) };
    env.create.mockResolvedValue(recorder);
    const onTranscript = vi.fn();
    const { result, rerender } = renderHook(({ enabled }) => useAskVRecording({ enabled, beforeStart: async () => {}, onTranscript, onError: vi.fn() }), { initialProps: { enabled: true } });
    act(() => result.current.pressIn()); await flush();
    act(() => result.current.pressOut()); await flush();
    expect(env.transcribe).toHaveBeenCalledOnce();
    rerender({ enabled: false });
    act(() => env.background());
    await act(async () => { text.resolve("Late private question"); await text.promise; });
    expect(env.transcribe.mock.calls[0][1].aborted).toBe(true);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.transcribing).toBe(false);
  });
});
