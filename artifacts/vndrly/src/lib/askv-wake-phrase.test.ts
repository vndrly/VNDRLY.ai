import { describe, expect, it } from "vitest";
import { isAskVWakePhrase } from "./askv-wake-phrase";

describe("AskV wake phrase", () => {
  it("accepts AskV and a high-confidence standalone V", () => {
    expect(isAskVWakePhrase("AskV", 0.7)).toBe(true);
    expect(isAskVWakePhrase("ask v", 0.7)).toBe(true);
    expect(isAskVWakePhrase("V", 0.91)).toBe(true);
    expect(isAskVWakePhrase("V", 0.75)).toBe(false);
  });

  it("rejects ordinary phrases containing v sounds", () => {
    expect(isAskVWakePhrase("vendor", 1)).toBe(false);
    expect(isAskVWakePhrase("ask vendor", 1)).toBe(false);
  });
});
