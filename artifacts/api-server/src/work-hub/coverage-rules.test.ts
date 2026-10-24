import { describe, it, expect } from "vitest";
import { applyCoverageRules } from "./coverage-rules";
describe("permanent responsibility", () => {
  it("follows transfers in order and preserves unrelated positions", () => {
    expect(
      applyCoverageRules(
        [1, 9],
        [
          { original_user_id: 1, replacement_user_id: 2 },
          { original_user_id: 2, replacement_user_id: 3 },
        ],
        2,
      ),
    ).toEqual([3, 9]);
  });
  it("does not add another person to an already full shift", () => {
    expect(
      applyCoverageRules(
        [9],
        [{ original_user_id: null, replacement_user_id: 2 }],
        1,
      ),
    ).toEqual([9]);
  });
  it("fills a vacancy without duplicating a worker", () => {
    expect(
      applyCoverageRules(
        [],
        [
          { original_user_id: null, replacement_user_id: 2 },
          { original_user_id: null, replacement_user_id: 2 },
        ],
        2,
      ),
    ).toEqual([2]);
  });
  it("applies saved responsibility when the next dated shift is created empty", () => {
    expect(
      applyCoverageRules(
        [],
        [{ original_user_id: 1, replacement_user_id: 2 }],
        1,
      ),
    ).toEqual([2]);
  });
});
