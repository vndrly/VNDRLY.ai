import { describe, it, expect } from "vitest";
import { MATURITY_CATEGORIES, projectSafetyMaturity } from "@workspace/api-zod";
describe("safety maturity transition", () => {
  it("never converts absent or old scores into verified maturity", () => {
    for (const raw of [null, { score: 100 }, { scoreHistory: [{ score: 100 }] }]) {
      expect(projectSafetyMaturity(raw)).toMatchObject({ score: 0, incomplete: true, demo: false });
    }
  });
  const demo = { version: 1, demo: true, assessedAt: "2026-10-31T00:00:00.000Z", categories: MATURITY_CATEGORIES.map(c => ({ id: c.id, level: 3, evidence: "Synthetic example" })) };
  it("weights the approved six categories without incident points", () => {
    expect(projectSafetyMaturity(demo)).toMatchObject({ score: 75, demo: true });
    expect(MATURITY_CATEGORIES.map(c => c.weight)).toEqual([15,25,20,15,15,10]);
  });
  it("never treats synthetic records as verified real-company evidence", () => {
    expect(projectSafetyMaturity({ ...demo, demo: false })).toMatchObject({ score: 0, incomplete: true, demo: false });
  });
  it("rejects duplicate category data", () => {
    expect(projectSafetyMaturity({ ...demo, categories: demo.categories.map(() => demo.categories[0]) }).score).toBe(0);
  });
});
