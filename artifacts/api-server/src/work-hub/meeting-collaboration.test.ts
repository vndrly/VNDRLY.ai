import { describe, expect, it } from "vitest";
import {
  canReadMeetingMessage,
  canRemoveMeetingParticipant,
  isActiveMeetingParticipant,
  shouldWarnMeetingTime,
} from "./meeting-collaboration";

describe("meeting collaboration policy", () => {
  it("limits private messages to their two participants", () => {
    expect(canReadMeetingMessage(1, 1, 2)).toBe(true);
    expect(canReadMeetingMessage(2, 1, 2)).toBe(true);
    expect(canReadMeetingMessage(3, 1, 2)).toBe(false);
    expect(canReadMeetingMessage(3, 1, null)).toBe(true);
  });

  it("lets only an active host remove a non-host participant", () => {
    const host = { userId: 1, role: "host", removedAt: null };
    const attendee = { userId: 2, role: "participant", removedAt: null };
    expect(canRemoveMeetingParticipant(host, attendee)).toBe(true);
    expect(canRemoveMeetingParticipant(attendee, host)).toBe(false);
    expect(canRemoveMeetingParticipant(host, host)).toBe(false);
    expect(
      canRemoveMeetingParticipant(host, { ...attendee, removedAt: new Date() }),
    ).toBe(false);
  });

  it("treats removed attendees as inactive", () => {
    expect(isActiveMeetingParticipant({ userId: 1, role: "participant" })).toBe(
      true,
    );
    expect(
      isActiveMeetingParticipant({
        userId: 1,
        role: "participant",
        removedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("warns at ten minutes remaining and throughout overtime", () => {
    const hour = 60 * 60 * 1000;
    expect(shouldWarnMeetingTime(49 * 60 * 1000, hour)).toBe(false);
    expect(shouldWarnMeetingTime(50 * 60 * 1000, hour)).toBe(true);
    expect(shouldWarnMeetingTime(65 * 60 * 1000, hour)).toBe(true);
    expect(shouldWarnMeetingTime(hour, null)).toBe(false);
  });
});
