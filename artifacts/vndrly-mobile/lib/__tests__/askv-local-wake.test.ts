import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  listeners: new Map<string, (event: any) => void>(),
  start: vi.fn(), stop: vi.fn(), setDetectionEnabled: vi.fn(), available: true,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native.available ? {
  start: native.start, stop: native.stop, setDetectionEnabled: native.setDetectionEnabled,
  addListener: (name: string, callback: (event: any) => void) => {
    native.listeners.set(name, callback); return { remove: () => native.listeners.delete(name) };
  },
} : null }));
import { createLocalAskVWakeDetector } from "../askv-local-wake";
beforeEach(() => {
  native.available = true; native.listeners.clear();
  native.start.mockReset().mockResolvedValue(undefined);
  native.stop.mockReset().mockResolvedValue(undefined);
  native.setDetectionEnabled.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("native wake audio bridge", () => {
  it("reports unsupported when no native wake engine is installed", () => {
    native.available = false;
    expect(createLocalAskVWakeDetector({ onWake: () => {}, onError: () => {} })).toBeNull();
  });
  it("hands pre-roll and subsequent audio to one source and never wakes on V", async () => {
    const onWake = vi.fn();
    const detector = createLocalAskVWakeDetector({ onWake, onError: () => {} })!;
    await detector.start();
    native.listeners.get("onWake")!({ keyword: "V", samples: [0.1], sampleRate: 16000 });
    expect(onWake).not.toHaveBeenCalled();
    native.listeners.get("onWake")!({ keyword: "AskV", samples: [0.25, 0.5], sampleRate: 16000 });
    native.listeners.get("onAudio")!({ samples: [0.75], sampleRate: 16000 });
    const received: number[] = [];
    detector.audioSource.subscribe(frame => received.push(...frame));
    native.listeners.get("onAudio")!({ samples: [1], sampleRate: 16000 });
    expect(received).toEqual([0.25, 0.5, 0.75, 1]);
    expect(onWake).toHaveBeenCalledOnce();
    await detector.stop();
  });
  it("drops all late events and raw buffers immediately on stop", async () => {
    const onWake = vi.fn();
    const detector = createLocalAskVWakeDetector({ onWake, onError: () => {} })!;
    await detector.start();
    const callback = native.listeners.get("onWake")!;
    const stop = detector.stop();
    callback({ keyword: "AskV", samples: [1], sampleRate: 16000 });
    expect(onWake).not.toHaveBeenCalled();
    const frames: Float32Array[] = [];
    expect(() => detector.audioSource.subscribe(frame => frames.push(frame))).toThrow();
    expect(frames).toEqual([]);
    await stop;
  });
  it("preserves the entire connecting turn beyond two seconds and wipes delivered audio", async () => {
    const detector = createLocalAskVWakeDetector({ onWake: () => {}, onError: () => {} })!;
    await detector.start();
    native.listeners.get("onWake")!({ keyword: "AskV", samples: Array(32_000).fill(0.25), sampleRate: 16000 });
    native.listeners.get("onAudio")!({ samples: Array(48_000).fill(0.5), sampleRate: 16000 });
    let delivered: Float32Array | undefined;
    detector.audioSource.subscribe(frame => {
      delivered = frame;
      expect(frame.length).toBe(80_000);
      expect(frame[0]).toBe(0.25);
      expect(frame[79_999]).toBe(0.5);
    });
    expect(delivered!.every(value => value === 0)).toBe(true);
    await detector.stop();
  });
  it("fails explicitly instead of clipping a turn that exceeds the connection buffer", async () => {
    const onError = vi.fn();
    const detector = createLocalAskVWakeDetector({ onWake: () => {}, onError })!;
    await detector.start();
    native.listeners.get("onWake")!({ keyword: "AskV", samples: Array(32_000).fill(0.25), sampleRate: 16000 });
    native.listeners.get("onAudio")!({ samples: Array(224_000).fill(0.5), sampleRate: 16000 });
    expect(onError).toHaveBeenCalledWith("WAKE_AUDIO_OVERFLOW");
    expect(native.stop).toHaveBeenCalledOnce();
    expect(() => detector.audioSource.subscribe(() => {})).toThrow();
  });
  it("stops an unconnected wake after thirteen seconds, but cancels the deadline on subscription", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const detector = createLocalAskVWakeDetector({ onWake: () => {}, onError })!;
    await detector.start();
    native.listeners.get("onWake")!({ keyword: "AskV", samples: [1], sampleRate: 16000 });
    await vi.advanceTimersByTimeAsync(13_000);
    expect(onError).toHaveBeenCalledWith("WAKE_CONNECTION_TIMEOUT");
    await detector.start();
    await detector.setDetectionEnabled(false);
    detector.audioSource.subscribe(() => {});
    onError.mockClear();
    await vi.advanceTimersByTimeAsync(13_000);
    expect(onError).not.toHaveBeenCalled();
    await detector.stop();
  });
});
