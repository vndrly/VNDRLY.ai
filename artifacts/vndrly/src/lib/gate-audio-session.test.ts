import { askVMicrophone } from "@workspace/askv-wake";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGateAudioSession,
  type GateAudioRecorder,
  type GateAudioStream,
} from "./gate-audio-session";

class FakeRecorder implements GateAudioRecorder {
  mimeType = "audio/webm";
  state = "inactive";
  ondataavailable: GateAudioRecorder["ondataavailable"] = null;
  onerror: GateAudioRecorder["onerror"] = null;
  onstop: GateAudioRecorder["onstop"] = null;

  start = vi.fn(() => {
    this.state = "recording";
  });

  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["voice"], { type: this.mimeType }),
    });
    this.onstop?.();
  });
}

afterEach(async () => {
  const release = await askVMicrophone.acquire("test-cleanup", async () => {});
  await release();
});
describe("createGateAudioSession", () => {
  it("records until the second toggle, then releases the mic and returns the audio", async () => {
    const stopTrack = vi.fn();
    const stream: GateAudioStream = { getTracks: () => [{ stop: stopTrack }] };
    const recorder = new FakeRecorder();
    const onAudio = vi.fn();
    const listening = vi.fn();
    const session = createGateAudioSession({
      getStream: vi.fn(async () => stream),
      createRecorder: () => recorder,
      onAudio,
      onListeningChange: listening,
      onError: vi.fn(),
    });

    await session.toggle();
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(session.isListening()).toBe(true);
    expect(listening).toHaveBeenLastCalledWith(true);

    await session.toggle();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(listening).toHaveBeenLastCalledWith(false);
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onAudio.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it("stops a stream acquired after the user toggles off during the permission prompt", async () => {
    const stopTrack = vi.fn();
    let resolveStream: ((stream: GateAudioStream) => void) | undefined;
    const getStream = vi.fn(
      () =>
        new Promise<GateAudioStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    const recorder = new FakeRecorder();
    const session = createGateAudioSession({
      getStream,
      createRecorder: () => recorder,
      onAudio: vi.fn(),
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });

    const starting = session.toggle();
    await vi.waitFor(() => expect(getStream).toHaveBeenCalledOnce());
    const stopping = session.toggle();
    resolveStream?.({ getTracks: () => [{ stop: stopTrack }] });
    await Promise.all([starting, stopping]);

    expect(recorder.start).not.toHaveBeenCalled();
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(session.isListening()).toBe(false);
  });
});

describe("Gate audio microphone contention", () => {
  it("awaits the old owner, then cancels recording when a new owner takes over", async () => {
    let finishWake!: () => void;
    await askVMicrophone.acquire(
      "wake",
      () =>
        new Promise<void>((resolve) => {
          finishWake = resolve;
        }),
    );
    const stopTrack = vi.fn();
    const getStream = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    }));
    const onAudio = vi.fn();
    const recorder = new FakeRecorder();
    const session = createGateAudioSession({
      getStream,
      createRecorder: () => recorder,
      onAudio,
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });
    const starting = session.toggle();
    await vi.waitFor(() => expect(finishWake).toBeTypeOf("function"));
    expect(getStream).not.toHaveBeenCalled();
    finishWake();
    await starting;
    expect(askVMicrophone.owner).toBe("gate");
    const releaseAskV = await askVMicrophone.acquire("askv", async () => {});
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(session.isListening()).toBe(false);
    expect(onAudio).not.toHaveBeenCalled();
    await session.dispose();
    expect(askVMicrophone.owner).toBe("askv");
    await releaseAskV();
  });
  it("does not launch capture after cancellation while waiting for ownership", async () => {
    let finishWake!: () => void;
    await askVMicrophone.acquire(
      "wake",
      () =>
        new Promise<void>((resolve) => {
          finishWake = resolve;
        }),
    );
    const getStream = vi.fn();
    const session = createGateAudioSession({
      getStream,
      createRecorder: () => new FakeRecorder(),
      onAudio: vi.fn(),
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });
    const starting = session.toggle();
    await vi.waitFor(() => expect(finishWake).toBeTypeOf("function"));
    await session.dispose();
    finishWake();
    await starting;
    expect(getStream).not.toHaveBeenCalled();
    expect(askVMicrophone.owner).toBeNull();
  });
  it("cleans up a granted stream if recorder construction fails", async () => {
    const stopTrack = vi.fn();
    const session = createGateAudioSession({
      getStream: async () => ({ getTracks: () => [{ stop: stopTrack }] }),
      createRecorder: () => {
        throw new Error("recorder unavailable");
      },
      onAudio: vi.fn(),
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });
    await session.toggle();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(askVMicrophone.owner).toBeNull();
  });
});
