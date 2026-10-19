import { describe, expect, it } from "vitest";
import { calculateSafetyEventScore } from "./safety-score";

describe("shared safety event score", () => {
  it.each([
    [
      { openRecordables: 0, oldOpenHipo: 0, staleOpen: 0, recentNearMisses: 0 },
      100,
    ],
    [
      { openRecordables: 1, oldOpenHipo: 2, staleOpen: 3, recentNearMisses: 1 },
      71,
    ],
    [
      {
        openRecordables: 1,
        oldOpenHipo: 0,
        staleOpen: 20,
        recentNearMisses: 20,
      },
      85,
    ],
    [
      {
        openRecordables: 10,
        oldOpenHipo: 0,
        staleOpen: 0,
        recentNearMisses: 0,
      },
      0,
    ],
  ])(
    "applies recorded evidence penalties and bounded reporting credit",
    (evidence, expected) => {
      expect(calculateSafetyEventScore(evidence)).toBe(expected);
    },
  );
});
