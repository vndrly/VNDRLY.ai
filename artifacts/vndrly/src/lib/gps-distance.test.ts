import { describe, expect, it } from "vitest";
import { summarizeGpsDistance } from "@workspace/map-utils";
const ping = (longitude: number, minutes: number, ticketId = 1) => ({ latitude: 35, longitude, ticketId, recordedAt: new Date(Date.UTC(2026, 8, 7, 12, minutes)) });
describe("recorded GPS distance", () => {
  it("sorts records and sums plausible same-ticket segments", () => {
    const result = summarizeGpsDistance([ping(-97.99, 2), ping(-98, 0), ping(-97.995, 1)]);
    expect(result.segments).toBe(2);
    expect(result.meters).toBeGreaterThan(900);
    expect(result.meters).toBeLessThan(920);
  });
  it("does not invent mileage across gaps, tickets, or GPS jumps", () => {
    const result = summarizeGpsDistance([ping(-98, 0), ping(-97, 1), ping(-97, 30), ping(-96.99, 31, 2)]);
    expect(result.meters).toBe(0);
    expect(result.gaps).toBe(3);
  });
  it("does not count duplicate pings as missing coverage", () => {
    expect(summarizeGpsDistance([ping(-98, 0), ping(-98, 0)]).gaps).toBe(0);
  });
});
