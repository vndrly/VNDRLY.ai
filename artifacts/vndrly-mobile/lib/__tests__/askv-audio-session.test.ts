import { beforeEach, describe, expect, it, vi } from "vitest";
const audio = vi.hoisted(() => ({ request: vi.fn(), change: (_status: string) => {}, mode: vi.fn() }));
vi.mock("expo-av", () => ({ Audio: {
  getPermissionsAsync: async () => ({ status: "undetermined" }), requestPermissionsAsync: audio.request, setAudioModeAsync: audio.mode,
} }));
vi.mock("react-native", () => ({ AppState: {
  currentState: "active", addEventListener: (_name: string, callback: (status: string) => void) => { audio.change = callback; return { remove: () => {} }; },
} }));
import { configureAskVAudioSession, releaseAskVAudioSession, requestAskVMicrophonePermission, subscribeAskVAppState } from "../askv-audio-session";
beforeEach(() => { audio.request.mockReset(); audio.mode.mockReset().mockResolvedValue(undefined); });
describe("mobile microphone permission lifecycle", () => {
  it("allows the first-use permission prompt without losing startup, but still stops on real background", async () => {
    let grant!: (value: any) => void;
    audio.request.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    const stop = vi.fn(); subscribeAskVAppState(() => {}, stop);
    const pending = requestAskVMicrophonePermission(); await Promise.resolve();
    audio.change("inactive"); expect(stop).not.toHaveBeenCalled();
    audio.change("background"); expect(stop).toHaveBeenCalledOnce();
    grant({ status: "granted" }); await pending;
    audio.change("inactive"); expect(stop).toHaveBeenCalledTimes(2);
  });
  it("rejects denied permission and serializes reset behind pending audio configuration", async () => {
    audio.request.mockResolvedValue({ status: "denied" });
    await expect(requestAskVMicrophonePermission()).rejects.toThrow("askv.microphoneDenied");
    let finish!: () => void;
    audio.mode.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const start = configureAskVAudioSession(); await Promise.resolve();
    const stop = releaseAskVAudioSession();
    expect(audio.mode).toHaveBeenCalledTimes(1);
    finish(); await start; await stop;
    expect(audio.mode.mock.calls[1][0]).toMatchObject({ allowsRecordingIOS: false, staysActiveInBackground: false });
  });
});
