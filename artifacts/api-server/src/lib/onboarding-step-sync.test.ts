import { describe, expect, it } from "vitest";
import { newlyCompletedSteps } from "./onboarding-step-sync";

describe("newlyCompletedSteps", () => {
  it("returns steps present in after but not before", () => {
    expect(newlyCompletedSteps(["company-basics"], ["company-basics", "branding"])).toEqual([
      "branding",
    ]);
  });

  it("returns empty when nothing new", () => {
    expect(newlyCompletedSteps(["a", "b"], ["a", "b"])).toEqual([]);
  });
});
