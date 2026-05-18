import { describe, expect, it } from "vitest";
import { bucketForDaysPastDue } from "./aging";

describe("aging bucket boundaries", () => {
  it("treats 0 days past due as current", () => {
    expect(bucketForDaysPastDue(0)).toBe("current");
  });

  it("treats negative days (not yet due) as current", () => {
    expect(bucketForDaysPastDue(-5)).toBe("current");
  });

  it("buckets day 1 into 1-15", () => {
    expect(bucketForDaysPastDue(1)).toBe("1_15");
  });

  it("buckets day 15 into 1-15 (right edge inclusive)", () => {
    expect(bucketForDaysPastDue(15)).toBe("1_15");
  });

  it("buckets day 16 into 16-30 (left edge of next bucket)", () => {
    expect(bucketForDaysPastDue(16)).toBe("16_30");
  });

  it("buckets day 30 into 16-30 (right edge inclusive)", () => {
    expect(bucketForDaysPastDue(30)).toBe("16_30");
  });

  it("buckets day 31 into 31-60", () => {
    expect(bucketForDaysPastDue(31)).toBe("31_60");
  });

  it("buckets day 60 into 31-60 (right edge inclusive)", () => {
    expect(bucketForDaysPastDue(60)).toBe("31_60");
  });

  it("buckets day 61 into 60+", () => {
    expect(bucketForDaysPastDue(61)).toBe("60_plus");
  });

  it("buckets day 365 into 60+", () => {
    expect(bucketForDaysPastDue(365)).toBe("60_plus");
  });
});
