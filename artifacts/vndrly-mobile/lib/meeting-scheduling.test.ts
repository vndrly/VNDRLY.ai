import { describe, it, expect } from "vitest";
import { localMeetingTime, makeMeetingAttempt } from "./meeting-scheduling";
describe("meeting local schedule", () => {
  it("rejects calendar rollover and invalid clocks", () => {
    expect(() => localMeetingTime("2026-02-30", "13:00")).toThrow();
    expect(() => localMeetingTime("2026-10-08", "24:00")).toThrow();
  });
  it("rejects both missing and repeated daylight-saving local times", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      expect(() => localMeetingTime("2026-03-08", "02:30")).toThrow();
      expect(() => localMeetingTime("2026-11-01", "01:30")).toThrow();
      expect(localMeetingTime("2026-10-08", "13:00")).toBe(
        "2026-10-08T18:00:00.000Z",
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it("rejects half-hour daylight-saving gaps and folds", () => {
    const original = process.env.TZ;
    process.env.TZ = "Australia/Lord_Howe";
    try {
      expect(() => localMeetingTime("2026-04-05", "01:45")).toThrow();
      expect(() => localMeetingTime("2026-10-04", "02:15")).toThrow();
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it("strictly rejects caller authority and invalid timezone", () => {
    const input = {
      title: "Actual review",
      startsAt: "2026-10-08T18:00:00Z",
      endsAt: "2026-10-08T18:15:00Z",
      timezone: "America/Chicago",
      recordingAllowed: false,
      participantUserIds: [8],
    };
    const args = [
      7,
      { type: "vendor" as const, id: 11 },
      input,
      "10000000-0000-4000-8000-000000000001",
      [],
    ] as const;
    expect(() =>
      makeMeetingAttempt(
        ...([
          ...args.slice(0, 2),
          { ...input, actorUserId: 9 },
          ...args.slice(3),
        ] as Parameters<typeof makeMeetingAttempt>),
      ),
    ).toThrow();
    expect(() =>
      makeMeetingAttempt(
        7,
        args[1],
        { ...input, timezone: "made-up" },
        args[3],
        [],
      ),
    ).toThrow();
  });
});
