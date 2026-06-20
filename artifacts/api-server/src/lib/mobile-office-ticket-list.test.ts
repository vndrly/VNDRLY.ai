import { describe, expect, it } from "vitest";

import {
  MOBILE_OFFICE_COMPLETED_RETENTION_DAYS,
  cutoffDateForMobileOfficeCompleted,
} from "./mobile-office-ticket-list";

describe("mobile office ticket list retention", () => {
  it("uses a 30-day completed retention window by default", () => {
    const now = Date.parse("2026-06-20T12:00:00.000Z");
    const cutoff = cutoffDateForMobileOfficeCompleted(now);
    expect(MOBILE_OFFICE_COMPLETED_RETENTION_DAYS).toBe(30);
    expect(cutoff.toISOString()).toBe("2026-05-21T12:00:00.000Z");
  });
});
