import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn(), listSites: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: m.query } }));
vi.mock("./gate-change-over", () => ({ listChangeOverSites: m.listSites }));

import { listGateWatchTimeline } from "./gate-watch-timeline";

describe("Gate watch timeline radar", () => {
  beforeEach(() => {
    m.query.mockReset();
    m.listSites.mockReset();
  });

  it("returns every unassigned gate shift starting in the next 24 hours", async () => {
    const startsAt = new Date("2026-09-22T20:00:00.000Z");
    const endsAt = new Date("2026-09-23T08:00:00.000Z");
    m.listSites.mockResolvedValue([{ id: 21, name: "West site" }]);
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes("NOT EXISTS")) return { rows: [{
        shift_id: "shift-radar",
        site_id: 21,
        site_name: "West site",
        station_id: "gate-2",
        gate_name: "West Gate",
        title: "Night watch",
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: "America/Chicago",
      }] };
      return { rows: [] };
    });

    const result = await listGateWatchTimeline({ userId: 7, vendorId: 4 } as never, new Date("2026-09-22T08:00:00.000Z"));

    expect(result.radar).toEqual([{
      shiftId: "shift-radar",
      siteId: 21,
      siteName: "West site",
      stationId: "gate-2",
      gateName: "West Gate",
      title: "Night watch",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone: "America/Chicago",
    }]);
    expect(m.query.mock.calls.some(([sql]) => sql.includes("interval '24 hours'"))).toBe(true);
  });
});
