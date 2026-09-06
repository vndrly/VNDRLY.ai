import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { isWakeKeyword, PcmRingBuffer, type WakeAudioSource } from "@workspace/askv-wake";

type NativeWake = {
  start(options: { modelDirectory: string }): Promise<void>;
  stop(): Promise<void>;
  setDetectionEnabled(enabled: boolean): Promise<void>;
  addListener(event: string, callback: (event: any) => void): { remove(): void };
};
export interface LocalAskVWakeDetector {
  start(): Promise<void>;
  stop(): Promise<void>;
  setDetectionEnabled(enabled: boolean): Promise<void>;
  audioSource: WakeAudioSource;
}

export function createLocalAskVWakeDetector(callbacks: {
  onWake(): void;
  onError(code: string): void;
}): LocalAskVWakeDetector | null {
  if (Platform.OS !== "ios") return null;
  let native: NativeWake | null;
  try { native = requireOptionalNativeModule<NativeWake>("AskVWake"); } catch { return null; }
  if (!native) return null;
  let alive = false;
  let version = 0;
  let pendingStart: Promise<void> | null = null;
  let detecting = true;
  let subscriptions: Array<{ remove(): void }> = [];
  const listeners = new Set<(frame: Float32Array) => void>();
  // Native supplies 2 s of pre-roll. Keep the complete connecting turn in RAM,
  // up to 15 s; a slow connection must fail visibly rather than clip the question.
  const capacity = 240_000;
  const buffer = new PcmRingBuffer(capacity);
  let bufferedLength = 0;
  let connectionDeadline: ReturnType<typeof setTimeout> | undefined;
  const clearDeadline = () => { clearTimeout(connectionDeadline); connectionDeadline = undefined; };
  const clearBuffer = () => { buffer.clear(); bufferedLength = 0; };
  const fail = (code: string) => {
    if (!alive) return;
    void stop().catch(() => undefined);
    callbacks.onError(code);
  };
  const awaitConnection = () => {
    if (!connectionDeadline && !listeners.size) {
      connectionDeadline = setTimeout(() => fail("WAKE_CONNECTION_TIMEOUT"), 13_000);
    }
  };
  const frame = (event: { samples: number[]; sampleRate: number }) => {
    if (!alive || event.sampleRate !== 16000 || !Array.isArray(event.samples)) return;
    const samples = Float32Array.from(event.samples);
    event.samples.fill(0);
    try {
      if (!listeners.size) {
        if (bufferedLength + samples.length > capacity) { fail("WAKE_AUDIO_OVERFLOW"); return; }
        awaitConnection();
        buffer.push(samples); bufferedLength += samples.length;
      } else listeners.forEach(listener => listener(samples));
    } finally { samples.fill(0); }
  };
  const stop = async () => {
    alive = false; version += 1; pendingStart = null;
    subscriptions.forEach(subscription => subscription.remove()); subscriptions = [];
    listeners.clear(); clearBuffer(); clearDeadline();
    await native.stop();
  };
  return {
    start() {
      if (alive) return pendingStart ?? Promise.resolve();
      alive = true; detecting = true; const current = ++version;
      subscriptions = [
        native.addListener("onWake", (event: { keyword: string; samples: number[]; sampleRate: number }) => {
          if (!alive || version !== current || !detecting || !isWakeKeyword(event.keyword)) return;
          detecting = false; frame(event); if (alive) callbacks.onWake();
        }),
        native.addListener("onAudio", event => { if (version === current && !detecting) frame(event); }),
        native.addListener("onError", (event: { code: string }) => {
          if (version === current) fail(event.code);
        }),
      ];
      pendingStart = native.start({ modelDirectory: "" }).then(async () => {
        if (!alive || version !== current) {
          throw Object.assign(new Error("Wake startup cancelled"), { name: "AbortError" });
        }
      }).catch(async error => { if (version === current) await stop(); throw error; });
      return pendingStart;
    },
    stop,
    async setDetectionEnabled(enabled) {
      if (!alive) throw new Error("assistant.wake_unavailable");
      detecting = enabled;
      if (enabled) { clearBuffer(); clearDeadline(); }
      else awaitConnection();
      await native.setDetectionEnabled(enabled);
    },
    audioSource: {
      subscribe(listener) {
        if (!alive) throw new Error("assistant.wake_unavailable");
        listeners.add(listener);
        clearDeadline();
        const buffered = buffer.snapshot(); clearBuffer();
        try { if (buffered.length) listener(buffered); }
        catch (error) { listeners.delete(listener); throw error; }
        finally { buffered.fill(0); }
        return () => { listeners.delete(listener); };
      },
      stop,
    },
  };
}
