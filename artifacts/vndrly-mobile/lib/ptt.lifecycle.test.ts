import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askVMicrophone } from "@workspace/askv-wake";

const env = vi.hoisted(() => ({
  appState: { currentState: "active" },
  listeners: new Set<(state: string) => void>(),
  permission: vi.fn(), requestPermission: vi.fn(), setMode: vi.fn(), create: vi.fn(),
  deleteFile: vi.fn(), apiFetch: vi.fn(), createSound: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() { return env.appState.currentState; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      env.listeners.add(listener); return { remove: () => env.listeners.delete(listener) };
    },
  },
  InteractionManager: { runAfterInteractions: (callback: () => void) => callback() },
}));
vi.mock("expo-av", () => ({
  Audio: {
    getPermissionsAsync: env.permission, requestPermissionsAsync: env.requestPermission,
    setAudioModeAsync: env.setMode,
    Recording: class { constructor() { return env.create(); } }, RecordingOptionsPresets: { HIGH_QUALITY: {} },
    Sound: { createAsync: env.createSound },
  },
}));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: env.deleteFile }));
vi.mock("./api", () => ({ apiFetch: env.apiFetch, getApiBase: () => "https://vndrly.ai" }));
import { createPttRecorder, playPttUri, postPttMessage, warmUpPttSession } from "./ptt";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeRecording(name: string) {
  return {
    prepareToRecordAsync: vi.fn().mockResolvedValue({}), startAsync: vi.fn().mockResolvedValue({}),
    getStatusAsync: vi.fn().mockResolvedValue({ isRecording: false, canRecord: false }),
    stopAndUnloadAsync: vi.fn().mockResolvedValue({}), getURI: () => `file:///cache/${name}.m4a`,
  };
}
function appState(state: string) {
  env.appState.currentState = state;
  for (const listener of [...env.listeners]) listener(state);
}
async function clearOwner() {
  const release = await askVMicrophone.acquire("test-cleanup", async () => {});
  await release();
}
beforeEach(async () => {
  await clearOwner();
  vi.clearAllMocks();
  env.appState.currentState = "active"; env.listeners.clear();
  env.permission.mockReset().mockResolvedValue({ status: "granted" });
  env.requestPermission.mockReset().mockResolvedValue({ status: "granted" });
  env.setMode.mockReset().mockResolvedValue(undefined);
  env.create.mockReset(); env.createSound.mockReset();
  env.deleteFile.mockReset().mockResolvedValue(undefined);
  env.apiFetch.mockReset();
});
afterEach(clearOwner);

describe("PTT microphone lifecycle and ownership", () => {
  it("does not create capture after disposal while the permission prompt is pending", async () => {
    const permission = deferred<{ status: string }>();
    env.permission.mockResolvedValue({ status: "undetermined" });
    env.requestPermission.mockReturnValue(permission.promise);
    const recorder = await createPttRecorder({ deleteOnDispose: true });
    const result = recorder.start().catch((error) => error);
    await vi.waitFor(() => expect(env.requestPermission).toHaveBeenCalledTimes(1));
    await recorder.dispose();
    permission.resolve({ status: "granted" });
    expect((await result).name).toBe("AbortError");
    expect(env.create).not.toHaveBeenCalled();
    expect(env.setMode).not.toHaveBeenCalled();
    expect(askVMicrophone.owner).toBeNull();
  });

  it("does not open a new permission prompt when disposed during the permission check", async () => {
    const status = deferred<{ status: string }>();
    env.permission.mockReturnValue(status.promise);
    const recorder = await createPttRecorder();
    const result = recorder.start().catch((error) => error);
    await vi.waitFor(() => expect(env.permission).toHaveBeenCalledTimes(1));
    await recorder.dispose();
    status.resolve({ status: "undetermined" });
    expect((await result).name).toBe("AbortError");
    expect(env.requestPermission).not.toHaveBeenCalled();
    expect(env.create).not.toHaveBeenCalled();
  });

  it("cancels a pending prepare before capture starts and holds ownership until cleanup ends", async () => {
    const prepared = deferred<unknown>();
    const unloaded = deferred<unknown>();
    const native = nativeRecording("cancelled-prepare");
    native.prepareToRecordAsync.mockReturnValue(prepared.promise);
    native.stopAndUnloadAsync.mockReturnValue(unloaded.promise);
    env.create.mockReturnValue(native);
    const recorder = await createPttRecorder({ deleteOnDispose: true });
    const result = recorder.start().catch((error) => error);
    await vi.waitFor(() => expect(env.create).toHaveBeenCalledTimes(1));
    const disposed = recorder.dispose();
    let acquired = false;
    const nextLease = askVMicrophone.acquire("askv", async () => {}).then((release) => { acquired = true; return release; });
    await Promise.resolve(); await Promise.resolve();
    expect(acquired).toBe(false);
    prepared.resolve({});
    await vi.waitFor(() => expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(1));
    expect(native.startAsync).not.toHaveBeenCalled();
    expect(acquired).toBe(false);
    unloaded.resolve({});
    await disposed;
    expect((await result).name).toBe("AbortError");
    const release = await nextLease;
    expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    expect(env.deleteFile).toHaveBeenCalledWith(native.getURI(), { idempotent: true });
    expect(askVMicrophone.owner).toBe("askv");
    await release();
  });

  it("waits for an in-flight native start to unload before handing off the microphone", async () => {
    const started = deferred<unknown>(); const native = nativeRecording("late-start");
    native.startAsync.mockReturnValue(started.promise); env.create.mockReturnValue(native);
    const recorder = await createPttRecorder();
    const result = recorder.start().catch((error) => error);
    await vi.waitFor(() => expect(native.startAsync).toHaveBeenCalledTimes(1));
    let acquired = false;
    const next = askVMicrophone.acquire("askv", async () => {}).then((release) => { acquired = true; return release; });
    await Promise.resolve(); await Promise.resolve();
    expect(acquired).toBe(false);
    started.resolve({});
    expect((await result).name).toBe("AbortError");
    const release = await next;
    expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    expect(env.deleteFile).toHaveBeenCalledWith(native.getURI(), { idempotent: true });
    await release();
  });

  it("finishes cleanup after a failed stop before a newer microphone owner starts", async () => {
    const stopped = deferred<unknown>(); const cleanup = deferred<unknown>(); const native = nativeRecording("failed-stop");
    native.stopAndUnloadAsync.mockReturnValueOnce(stopped.promise).mockReturnValueOnce(cleanup.promise);
    env.create.mockReturnValue(native);
    const recorder = await createPttRecorder(); await recorder.start();
    const result = recorder.stop().catch((error) => error);
    let acquired = false;
    const next = askVMicrophone.acquire("askv", async () => {}).then((release) => { acquired = true; return release; });
    await Promise.resolve(); await Promise.resolve();
    stopped.reject(new Error("Native stop failed"));
    await vi.waitFor(() => expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(2));
    expect(acquired).toBe(false);
    cleanup.resolve({});
    expect((await result).message).toBe("Native stop failed");
    const release = await next;
    await recorder.dispose();
    expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(2);
    expect(askVMicrophone.owner).toBe("askv");
    await release();
  });

  it("does not prepare a new recorder when native unload fails and capture may still be live", async () => {
    const native = nativeRecording("unload-failure");
    env.create.mockReturnValue(native);
    const first = await createPttRecorder(); await first.start();
    native.stopAndUnloadAsync.mockRejectedValue(new Error("Native unload failed"));
    native.getStatusAsync.mockResolvedValue({ isRecording: true, canRecord: true });
    const second = await createPttRecorder();
    await expect(second.start()).rejects.toThrow("Native unload failed");
    expect(env.create).toHaveBeenCalledTimes(1);
    expect(env.deleteFile).not.toHaveBeenCalled();
    native.stopAndUnloadAsync.mockResolvedValue({});
    native.getStatusAsync.mockResolvedValue({ isRecording: false, canRecord: false });
    await first.dispose(); await second.dispose();
  });

  it("a stale recorder's disposal cannot stop a newer recording", async () => {
    const firstNative = nativeRecording("first"); const secondNative = nativeRecording("second");
    env.create.mockReturnValueOnce(firstNative).mockReturnValueOnce(secondNative);
    const first = await createPttRecorder(); const second = await createPttRecorder();
    await first.start(); await second.start();
    expect(firstNative.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    await first.dispose();
    expect(secondNative.stopAndUnloadAsync).not.toHaveBeenCalled();
    expect(askVMicrophone.owner).toBe("ptt");
    await second.dispose();
    expect(secondNative.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
  });

  it("stops the previous AskV owner before preparing PTT and yields back without stopping a newer owner", async () => {
    const stopAskV = vi.fn().mockResolvedValue(undefined);
    const oldRelease = await askVMicrophone.acquire("askv", stopAskV);
    const native = nativeRecording("ptt");
    env.create.mockImplementation(() => {
      expect(stopAskV).toHaveBeenCalledTimes(1);
      return native;
    });
    const recorder = await createPttRecorder();
    await recorder.start();
    const nextStop = vi.fn().mockResolvedValue(undefined);
    const newRelease = await askVMicrophone.acquire("askv", nextStop);
    await oldRelease(); await recorder.dispose();
    expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    expect(nextStop).not.toHaveBeenCalled();
    await newRelease();
  });

  it("warms permission without changing audio mode or interrupting the current owner", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const release = await askVMicrophone.acquire("askv", stop);
    await warmUpPttSession();
    expect(stop).not.toHaveBeenCalled();
    expect(env.setMode).not.toHaveBeenCalled();
    expect(env.create).not.toHaveBeenCalled();
    await release();
  });

  it("ignores permission-dialog inactive but cancels real background capture", async () => {
    const permission = deferred<{ status: string }>();
    const native = nativeRecording("background");
    env.permission.mockResolvedValue({ status: "undetermined" });
    env.requestPermission.mockReturnValue(permission.promise);
    env.create.mockReturnValue(native);
    const recorder = await createPttRecorder({ deleteOnDispose: true });
    const starting = recorder.start();
    await vi.waitFor(() => expect(env.requestPermission).toHaveBeenCalledTimes(1));
    appState("inactive");
    appState("active"); permission.resolve({ status: "granted" });
    await starting;
    expect(env.create).toHaveBeenCalledTimes(1);
    appState("background");
    await vi.waitFor(() => expect(native.stopAndUnloadAsync).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(askVMicrophone.owner).toBeNull());
    expect(env.deleteFile).toHaveBeenCalledWith(native.getURI(), { idempotent: true });
    appState("active");
    expect(env.create).toHaveBeenCalledTimes(1);
  });

  it("cancels a permission prompt on background without capturing after return", async () => {
    const permission = deferred<{ status: string }>();
    env.permission.mockResolvedValue({ status: "undetermined" });
    env.requestPermission.mockReturnValue(permission.promise);
    const recorder = await createPttRecorder();
    const result = recorder.start().catch((error) => error);
    await vi.waitFor(() => expect(env.requestPermission).toHaveBeenCalledTimes(1));
    appState("background"); appState("active");
    permission.resolve({ status: "granted" });
    expect((await result).name).toBe("AbortError");
    expect(env.create).not.toHaveBeenCalled();
  });

  it("keeps a stopped AskV file available until disposal, then deletes only that file", async () => {
    const native = nativeRecording("transcription");
    env.create.mockReturnValue(native);
    const recorder = await createPttRecorder({ deleteOnDispose: true });
    await recorder.start();
    expect((await recorder.stop()).uri).toBe(native.getURI());
    expect(env.deleteFile).not.toHaveBeenCalled();
    expect(askVMicrophone.owner).toBeNull();
    await recorder.dispose();
    expect(env.deleteFile).toHaveBeenCalledTimes(1);
    expect(env.deleteFile).toHaveBeenCalledWith(native.getURI(), { idempotent: true });
  });

  it("transfers normal PTT file ownership to upload and deletes it if upload fails", async () => {
    const native = nativeRecording("message");
    env.create.mockReturnValue(native);
    const recorder = await createPttRecorder();
    await recorder.start();
    const audio = await recorder.stop();
    await recorder.dispose();
    expect(env.deleteFile).not.toHaveBeenCalled();
    env.apiFetch.mockRejectedValue(new Error("Upload unavailable"));
    await expect(postPttMessage(42, audio.uri, audio.durationSeconds)).rejects.toThrow("Upload unavailable");
    expect(env.deleteFile).toHaveBeenCalledWith(audio.uri, { idempotent: true });
  });

  it("coordinates playback audio-mode changes and unloads sound before a new mic owner", async () => {
    const previousStop = vi.fn().mockResolvedValue(undefined);
    await askVMicrophone.acquire("askv", previousStop);
    const sound = { playAsync: vi.fn().mockResolvedValue({}), unloadAsync: vi.fn().mockResolvedValue({}), setOnPlaybackStatusUpdate: vi.fn() };
    env.createSound.mockResolvedValue({ sound });
    const playback = playPttUri("https://example.com/voice.m4a");
    await vi.waitFor(() => expect(sound.playAsync).toHaveBeenCalledTimes(1));
    expect(previousStop).toHaveBeenCalledTimes(1);
    const nextStop = vi.fn().mockResolvedValue(undefined);
    const release = await askVMicrophone.acquire("askv", nextStop);
    await playback;
    expect(sound.unloadAsync).toHaveBeenCalledTimes(1);
    expect(nextStop).not.toHaveBeenCalled();
    await release();
  });
});
