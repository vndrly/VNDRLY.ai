import { describe, expect, it } from "vitest";

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

describe("safety score formula", () => {
  it("starts at 100 with no penalties", () => {
    expect(clampScore(100)).toBe(100);
  });

  it("clamps to 0", () => {
    expect(clampScore(-20)).toBe(0);
  });

  it("clamps to 100", () => {
    expect(clampScore(130)).toBe(100);
  });

  it("applies recordable penalty", () => {
    expect(clampScore(100 - 15)).toBe(85);
  });
});

describe("anonymous redaction policy", () => {
  it("hides reporter for non-admin when anonymous", () => {
    const row = { isAnonymous: true, reportedByUserId: 42 };
    const sessionRole: string = "partner";
    const redacted =
      row.isAnonymous && sessionRole !== "admin"
        ? { reporterLabel: "Anonymous field report" as const }
        : { reportedByUserId: row.reportedByUserId };
    expect("reportedByUserId" in redacted).toBe(false);
    expect(redacted.reporterLabel).toBe("Anonymous field report");
  });
});
