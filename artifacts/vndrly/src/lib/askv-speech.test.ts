import { afterEach, describe, expect, it, vi } from "vitest";
import { speechPronunciationText, speakAskV, stopAskVSpeech } from "./askv-speech";
afterEach(() => { stopAskVSpeech(); vi.unstubAllGlobals(); });

describe("speechPronunciationText", () => {
  it("aborts obsolete speech requests and ignores their late failures", async () => {
    const signals: AbortSignal[] = [];
    const failures: Array<(reason: Error) => void> = [];
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak });
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signals.push(init.signal); return new Promise((_resolve, reject) => failures.push(reject)); }));
    speakAskV("First answer"); speakAskV("Second answer");
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    stopAskVSpeech();
    expect(signals[1].aborted).toBe(true);
    failures.forEach(reject => reject(new Error("late")));
    await Promise.resolve(); await Promise.resolve();
    expect(speak).not.toHaveBeenCalled();
  });
  it("speaks the VNDRLY brand as Vinderly without changing unrelated text", () => {
    expect(speechPronunciationText("Welcome to VNDRLY. Ask VNDRLY for help."))
      .toBe("Welcome to Vinderly. Ask Vinderly for help.");
  });

  it("matches the brand name case-insensitively but not inside longer words", () => {
    expect(speechPronunciationText("vndrly VNDRLY-123 unvndrlylike"))
      .toBe("Vinderly Vinderly-123 unvndrlylike");
  });
});
