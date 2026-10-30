import { describe, expect, it } from "vitest";
import { gateShiftDefinitionSchema, gateDefinitionWindows, gateCivilTime, gateClockLabel } from "./gate-shift-definition-policy";
const definition = { stationIds: ["11111111-1111-4111-a111-111111111111"], startsAtLocal: "18:00", endsAtLocal: "06:00", weekdays: [0,1,2,3,4,5,6], timezone: "America/Chicago" };
describe("recurring gate shift definitions", () => {
  it("allows empty assignments and rejects missing gates, invalid clocks and equal times", () => {
    expect(gateShiftDefinitionSchema.parse(definition)).toMatchObject({ userIds: [], crewIds: [], requiredCount: 1 });
    for (const patch of [{ stationIds: [] }, { weekdays: [] }, { startsAtLocal: "25:00" }, { endsAtLocal: "18:00" }, { timezone: "Invalid/Zone" }]) expect(gateShiftDefinitionSchema.safeParse({ ...definition, ...patch }).success).toBe(false);
  });
  it("keeps the 6 PM–6 AM overnight watch at local times across the November clock change", () => {
    const start = gateCivilTime("2026-10-31", "18:00", "America/Chicago"), end = gateCivilTime("2026-11-01", "06:00", "America/Chicago");
    expect(start.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(+end - +start).toBe(13 * 3600000);
  });
  it("generates only future watches on the selected weekdays", () => {
    const windows = gateDefinitionWindows({ ...definition, weekdays: [1] }, new Date("2026-10-29T23:00:00Z"));
    expect(windows).toHaveLength(1);
    expect(windows[0].startsAt.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(windows[0].endsAt.toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect(gateClockLabel("06:00")).toBe("06:00 AM");
    expect(gateClockLabel("18:00")).toBe("06:00 PM");
  });
});
