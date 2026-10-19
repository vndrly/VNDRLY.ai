import { describe, expect, it } from "vitest";
import { calculateGateBillingPeriod } from "./gate-billing-period";
const period = (overrides: Record<string, unknown> = {}) =>
  calculateGateBillingPeriod({
    startDay: "2026-10-01",
    now: "2026-10-03T15:00:00Z",
    dailyRateCents: 12345,
    partialDayRule: "full_day",
    coverage: [{ startedAt: "2026-10-01T17:00:00Z", endedAt: null }],
    ...overrides,
  } as Parameters<typeof calculateGateBillingPeriod>[0]);
describe("Gate daily post billing", () => {
  it("bills only completed Central days and continues today from midnight", () => {
    const value = period();
    expect(value).toMatchObject({
      timeZone: "America/Chicago",
      throughDay: "2026-10-02",
      cutoffExclusive: "2026-10-03T05:00:00.000Z",
      nextPeriodStartDay: "2026-10-03",
      billableDays: 2,
      totalCents: 24690,
    });
    expect(value.days[0]).toMatchObject({
      day: "2026-10-01",
      chargeCents: 12345,
      hasCoverageGap: true,
    });
    expect(value.days[1].hasCoverageGap).toBe(false);
  });
  it.each([
    ["2026-03-08", "2026-03-09T15:00:00Z", 23],
    ["2026-11-01", "2026-11-02T16:00:00Z", 25],
  ])("counts %s as one day across daylight saving", (startDay, now, hours) => {
    const value = period({
      startDay,
      now,
      coverage: [{ startedAt: `${startDay}T00:00:00Z`, endedAt: null }],
    });
    expect(value.days).toHaveLength(1);
    expect(value.days[0].dayMilliseconds).toBe(hours * 3600000);
    expect(value.totalCents).toBe(12345);
  });
  it("uses Central midnight, including the instant immediately before and at cutoff", () => {
    expect(
      period({ startDay: "2026-10-02", now: "2026-10-03T04:59:59.999Z" }).days,
    ).toHaveLength(0);
    expect(
      period({ startDay: "2026-10-02", now: "2026-10-03T05:00:00Z" }).days,
    ).toHaveLength(1);
  });
  it("merges multiple workers and overlapping coverage without multiplying the post charge", () => {
    const value = period({
      startDay: "2026-10-02",
      coverage: [
        { startedAt: "2026-10-02T05:00:00Z", endedAt: "2026-10-02T20:00:00Z" },
        { startedAt: "2026-10-02T18:00:00Z", endedAt: "2026-10-03T05:00:00Z" },
      ],
    });
    expect(value.days[0]).toMatchObject({
      staffedMilliseconds: 86400000,
      hasCoverageGap: false,
      chargeCents: 12345,
    });
  });
  it("does not infer staffing or charge an empty day and shows the evidence gap", () => {
    const value = period({ coverage: [] });
    expect(value.totalCents).toBe(0);
    expect(value.billableDays).toBe(0);
    expect(value.days.every((day) => day.hasCoverageGap)).toBe(true);
  });
  it("prorates only by explicit agreement, using actual DST day length and exact cents", () => {
    const value = period({
      startDay: "2026-03-08",
      now: "2026-03-09T15:00:00Z",
      dailyRateCents: 10001,
      partialDayRule: "prorate_actual_day",
      coverage: [
        { startedAt: "2026-03-08T06:00:00Z", endedAt: "2026-03-08T17:30:00Z" },
      ],
    });
    expect(value.days[0].staffedMilliseconds).toBe(11.5 * 3600000);
    expect(value.totalCents).toBe(5001);
  });
  it("rejects malformed dates, money, reverse coverage and a future period", () => {
    for (const override of [
      { startDay: "2026-02-30" },
      { dailyRateCents: 1.5 },
      { dailyRateCents: -1 },
      { now: "garbage" },
      { startDay: "2026-12-01" },
      {
        coverage: [
          {
            startedAt: "2026-10-02T10:00:00Z",
            endedAt: "2026-10-01T10:00:00Z",
          },
        ],
      },
    ])
      expect(() => period(override)).toThrow();
  });
});
