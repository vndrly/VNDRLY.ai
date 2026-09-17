import { describe, expect, it } from "vitest";
import {
  findAvailableMeetingTimes,
  requestedMeetingAvailability,
  type ParticipantBusyInterval,
} from "./meeting-availability";

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 18, hour, minute));

describe("meeting availability", () => {
  const busy: ParticipantBusyInterval[] = [
    { userId: 11, kind: "shift", startsAt: at(14), endsAt: at(16) },
    { userId: 12, kind: "meeting", startsAt: at(16), endsAt: at(16, 30) },
  ];

  it("treats assigned shifts and meetings as hard conflicts without leaking titles", () => {
    expect(requestedMeetingAvailability(at(14, 30), at(15), busy)).toEqual({
      available: false,
      conflicts: [
        { userId: 11, kind: "shift", startsAt: at(14), endsAt: at(16) },
      ],
    });
    expect(Object.keys(busy[0]!)).toEqual([
      "userId",
      "kind",
      "startsAt",
      "endsAt",
    ]);
  });

  it("returns the earliest common openings on a fifteen-minute grid", () => {
    expect(
      findAvailableMeetingTimes({
        searchStart: at(14),
        searchEnd: at(18),
        durationMinutes: 30,
        busy,
        limit: 3,
      }),
    ).toEqual([
      { startsAt: at(16, 30), endsAt: at(17) },
      { startsAt: at(16, 45), endsAt: at(17, 15) },
      { startsAt: at(17), endsAt: at(17, 30) },
    ]);
  });

  it("does not block time for tasks because tasks are not busy intervals", () => {
    expect(requestedMeetingAvailability(at(17), at(17, 30), [])).toEqual({
      available: true,
      conflicts: [],
    });
  });
});
