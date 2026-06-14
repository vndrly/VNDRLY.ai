import { describe, expect, it } from "vitest";
import {
  computeKickbackRate,
  EMPTY_REVENUE_PIPELINE,
} from "./analytics-rollups";

describe("computeKickbackRate", () => {
  it("returns 0 when there are no tickets", () => {
    expect(computeKickbackRate(0, 0)).toBe(0);
    expect(computeKickbackRate(3, 0)).toBe(0);
  });

  it("rounds kickback share to whole percent", () => {
    expect(computeKickbackRate(1, 3)).toBe(33);
    expect(computeKickbackRate(2, 4)).toBe(50);
  });
});

describe("EMPTY_REVENUE_PIPELINE", () => {
  it("zeros all pipeline segments", () => {
    expect(EMPTY_REVENUE_PIPELINE).toEqual({
      pendingReview: { count: 0, total: 0 },
      awaitingPayment: { count: 0, total: 0 },
      approvedUnpaid: { count: 0, total: 0 },
    });
  });
});
