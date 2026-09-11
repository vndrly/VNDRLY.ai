import { askVMicrophone } from "@workspace/askv-wake";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGateSpeechSession,
  type GateSpeechRecognition,
} from "./gate-speech-session";

class FakeRecognition implements GateSpeechRecognition {
  continuous = false;
  interimResults = true;
  lang = "";
  onstart: (() => void) | null = null;
  start = vi.fn(() => {
    this.onstart?.();
  });
  stop = vi.fn(() => {
    this.onend?.();
  });
  onresult: GateSpeechRecognition["onresult"] = null;
  onerror: GateSpeechRecognition["onerror"] = null;
  onend: GateSpeechRecognition["onend"] = null;
}

afterEach(async () => {
  const release = await askVMicrophone.acquire("test-cleanup", async () => {});
  await release();
});
describe("createGateSpeechSession", () => {
  it("keeps recognition active across browser end events until the user toggles it off", async () => {
    const recognitions: FakeRecognition[] = [];
    let restart: (() => void) | undefined;
    const listening = vi.fn();
    const session = createGateSpeechSession({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      onTranscript: vi.fn(),
      onListeningChange: listening,
      onError: vi.fn(),
      scheduleRestart: (callback) => {
        restart = callback;
        return 1;
      },
      cancelRestart: vi.fn(),
    });

    await session.toggle();
    expect(recognitions).toHaveLength(1);
    expect(recognitions[0].continuous).toBe(true);
    expect(recognitions[0].start).toHaveBeenCalledTimes(1);
    expect(listening).toHaveBeenLastCalledWith(true);

    recognitions[0].onend?.();
    await vi.waitFor(() => expect(restart).toBeTypeOf("function"));
    restart?.();
    await vi.waitFor(() => expect(recognitions).toHaveLength(2));
    expect(recognitions[1].start).toHaveBeenCalledTimes(1);

    await session.toggle();
    expect(recognitions[1].stop).toHaveBeenCalledTimes(1);
    expect(listening).toHaveBeenLastCalledWith(false);
    restart = undefined;
    recognitions[1].onend?.();
    expect(restart).toBeUndefined();
  });

  it("emits only the new final transcript from a result event", async () => {
    const recognition = new FakeRecognition();
    const onTranscript = vi.fn();
    const session = createGateSpeechSession({
      createRecognition: () => recognition,
      onTranscript,
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });

    await session.toggle();
    recognition.onresult?.({
      resultIndex: 1,
      results: {
        0: { 0: { transcript: "old words" }, isFinal: true },
        1: { 0: { transcript: "Bob Villa checking out" }, isFinal: true },
        length: 2,
      },
    });

    expect(onTranscript).toHaveBeenCalledWith(
      "Bob Villa checking out",
      "1:1:2",
    );
  });

  it("ignores no-speech errors but stops cleanly on microphone permission errors", async () => {
    const recognition = new FakeRecognition();
    const listening = vi.fn();
    const onError = vi.fn();
    const session = createGateSpeechSession({
      createRecognition: () => recognition,
      onTranscript: vi.fn(),
      onListeningChange: listening,
      onError,
    });

    await session.toggle();
    recognition.onerror?.({ error: "no-speech" });
    expect(onError).not.toHaveBeenCalled();
    expect(session.isListening()).toBe(true);

    recognition.onerror?.({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(session.isListening()).toBe(false);
    expect(listening).toHaveBeenLastCalledWith(false);
  });
});

describe("Gate speech microphone contention", () => {
  it("starts a fresh recognizer when clicked during a normal restart gap and ignores stale results", async () => {
    const recognitions: FakeRecognition[] = [];
    const onTranscript = vi.fn();
    const cancelRestart = vi.fn();
    const session = createGateSpeechSession({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      onTranscript,
      onListeningChange: vi.fn(),
      onError: vi.fn(),
      scheduleRestart: () => 1,
      cancelRestart,
    });
    await session.toggle();
    recognitions[0].onend?.();
    await vi.waitFor(() => expect(askVMicrophone.owner).toBeNull());
    await session.toggle();
    expect(recognitions).toHaveLength(2);
    expect(recognitions[1].start).toHaveBeenCalledOnce();
    expect(recognitions[0].onresult).toBeNull();
    expect(onTranscript).not.toHaveBeenCalled();
    await session.dispose();
  });
  it("waits for the previous owner and stops recognition before another owner captures", async () => {
    let finishWake!: () => void;
    await askVMicrophone.acquire(
      "wake",
      () =>
        new Promise<void>((resolve) => {
          finishWake = resolve;
        }),
    );
    const recognition = new FakeRecognition();
    const session = createGateSpeechSession({
      createRecognition: () => recognition,
      onTranscript: vi.fn(),
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });
    const starting = session.toggle();
    await vi.waitFor(() => expect(finishWake).toBeTypeOf("function"));
    expect(recognition.start).not.toHaveBeenCalled();
    finishWake();
    await starting;
    const releaseAskV = await askVMicrophone.acquire("askv", async () => {});
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(session.isListening()).toBe(false);
    await session.dispose();
    expect(askVMicrophone.owner).toBe("askv");
    await releaseAskV();
  });
  it("cancels a queued start on dispose", async () => {
    let finishWake!: () => void;
    await askVMicrophone.acquire(
      "wake",
      () =>
        new Promise<void>((resolve) => {
          finishWake = resolve;
        }),
    );
    const recognition = new FakeRecognition();
    const session = createGateSpeechSession({
      createRecognition: () => recognition,
      onTranscript: vi.fn(),
      onListeningChange: vi.fn(),
      onError: vi.fn(),
    });
    const starting = session.toggle();
    await vi.waitFor(() => expect(finishWake).toBeTypeOf("function"));
    await session.dispose();
    finishWake();
    await starting;
    expect(recognition.start).not.toHaveBeenCalled();
    expect(askVMicrophone.owner).toBeNull();
  });
});
