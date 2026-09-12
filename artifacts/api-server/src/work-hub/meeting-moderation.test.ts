import { describe, expect, it } from "vitest";
import {
  imposeHostMute,
  releaseHostMute,
  routeSpeakRequest,
  MeetingModerationError,
  type ModerationParticipant,
} from "./meeting-moderation";

const host = { userId: 1, role: "host", present: true } satisfies ModerationParticipant;
const coHost = { userId: 2, role: "co_host", present: true } satisfies ModerationParticipant;
const attendee = { userId: 3, role: "participant", present: true } satisfies ModerationParticipant;

describe("meeting moderation", () => {
  it("lets the host mute an attendee across all devices and fences older audio generations", () => {
    const result = imposeHostMute(host, attendee, new Date("2026-09-12T12:00:00Z"));
    expect(result).toMatchObject({ hostMutedById: 1, hostMuteGeneration: 1 });
    expect(result.hostMutedAt).toEqual(new Date("2026-09-12T12:00:00Z"));
  });

  it("lets an assigned co-host mute and release an attendee", () => {
    const muted = imposeHostMute(coHost, attendee, new Date());
    expect(releaseHostMute(coHost, { ...attendee, ...muted })).toMatchObject({ hostMutedAt: null, hostMutedById: null, hostMuteGeneration: 2 });
  });

  it("does not let an organization admin without a meeting role release host mute", () => {
    const adminAttendee = { userId: 4, role: "participant", present: true, organizationAdmin: true } satisfies ModerationParticipant;
    expect(() => releaseHostMute(adminAttendee, { ...attendee, ...imposeHostMute(host, attendee, new Date()) })).toThrowError(MeetingModerationError);
  });

  it("routes a speak request to the present host, then co-hosts, with admins notification-only", () => {
    const mutedAttendee = { ...attendee, hostMutedAt: new Date() };
    expect(routeSpeakRequest([host, coHost, mutedAttendee, { userId: 4, role: "participant", present: true, organizationAdmin: true }], attendee.userId)).toEqual({ authorityUserIds: [1, 2], fallbackAdminUserIds: [4] });
  });

  it("requires host mute before requesting to speak", () => {
    expect(() => routeSpeakRequest([host, attendee], attendee.userId)).toThrowError(MeetingModerationError);
  });
});
