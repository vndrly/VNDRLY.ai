import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  readFleetAvailability,
  requireFleetAvailability,
} from "./fleet-availability";

const window = {
  plannedStartAt: "2026-10-10T10:00:00Z",
  plannedEndAt: "2026-10-10T11:00:00Z",
  timezone: "America/Chicago",
};
function client(
  availability: unknown[] = [],
  shifts: unknown[] = [],
  meetings: unknown[] = [],
) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: availability })
    .mockResolvedValueOnce({ rows: shifts })
    .mockResolvedValueOnce({ rows: meetings });
  return { query } as unknown as Pick<PoolClient, "query">;
}
const covering = {
  id: "available",
  starts_at: new Date(window.plannedStartAt),
  ends_at: new Date(window.plannedEndAt),
  available: true,
  recurrence: null,
};
describe("recorded Fleet driver schedule evidence", () => {
  it("preserves the unplanned policy without inventing or reading a window", async () => {
    const db = client();
    const result = await readFleetAvailability(db, 7, 2, undefined);
    expect(result).toEqual({
      window: null,
      state: "not_requested",
      blockers: [],
      physicalReadinessVerified: false,
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(() => requireFleetAvailability(result)).not.toThrow();
  });
  it("requires a covering nonrecurring saved window and retains exact company/user parameters", async () => {
    const db = client([covering]);
    const result = await readFleetAvailability(db, 7, 2, window);
    expect(result.state).toBe("recorded_available");
    expect(result.window).toEqual(window);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("owner_org_id=$2"),
      [2, 7, window.plannedStartAt, window.plannedEndAt],
    );
    expect(() => requireFleetAvailability(result)).not.toThrow();
  });
  it("recorded unavailability overrides a covering available row", async () => {
    const result = await readFleetAvailability(
      client([covering, { ...covering, available: false }]),
      7,
      2,
      window,
    );
    expect(result.state).toBe("recorded_unavailable");
    expect(() => requireFleetAvailability(result)).toThrow(
      "fleet.driver_schedule_conflict",
    );
  });
  it("reports shift and accepted meeting conflict reasons without exposing private IDs", async () => {
    const db = client(
      [covering],
      [{ id: "private-shift" }],
      [{ id: "private-meeting" }],
    );
    const result = await readFleetAvailability(db, 7, 2, window);
    expect(result.state).toBe("recorded_conflict");
    expect(result.blockers).toEqual(["shift", "accepted_meeting"]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("p.rsvp='accepted'"),
      expect.any(Array),
    );
  });
  it("refuses insufficient and recurring evidence rather than inferring availability", async () => {
    for (const rows of [
      [],
      [{ ...covering, ends_at: window.plannedStartAt }],
      [{ ...covering, recurrence: {} }],
    ]) {
      const result = await readFleetAvailability(client(rows), 7, 2, window);
      expect(result.state).toMatch(/^unknown_/);
      expect(() => requireFleetAvailability(result)).toThrow(
        "fleet.driver_availability_unknown",
      );
    }
  });
  it("rejects malformed windows before any persistence read", async () => {
    const db = client();
    await expect(
      readFleetAvailability(db, 7, 2, {
        ...window,
        plannedEndAt: window.plannedStartAt,
      }),
    ).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
});
