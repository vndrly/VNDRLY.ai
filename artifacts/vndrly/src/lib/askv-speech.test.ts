import { describe, expect, it } from "vitest";
import { speechPronunciationText } from "./askv-speech";

describe("speechPronunciationText", () => {
  it("speaks the VNDRLY brand as Vinderly without changing unrelated text", () => {
    expect(speechPronunciationText("Welcome to VNDRLY. Ask VNDRLY for help."))
      .toBe("Welcome to Vinderly. Ask Vinderly for help.");
  });

  it("matches the brand name case-insensitively but not inside longer words", () => {
    expect(speechPronunciationText("vndrly VNDRLY-123 unvndrlylike"))
      .toBe("Vinderly Vinderly-123 unvndrlylike");
  });
});
