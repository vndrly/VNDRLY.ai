import { describe, expect, it } from "vitest";
import {
  acceptParticipationAuthorization,
  applyRecordingRetention,
  askVParticipantState,
  participationState,
  placeRecordingHold,
  startAutomaticTranscript,
} from "./meeting-participation";

describe("meeting participation authorization", () => {
  it("joins an unaccepted participant in view-only mode", () => {
    expect(participationState({ authorizationAcceptedAt: null })).toEqual({
      mode: "view_only",
      audioAllowed: false,
      messagingAllowed: false,
      code: "meeting.authorization_required",
    });
  });

  it("activates a participant immediately after in-meeting acceptance", () => {
    const accepted = acceptParticipationAuthorization({
      userId: 7,
      policyVersion: 3,
      source: "in_meeting",
      acceptedAt: new Date("2026-09-14T15:00:00Z"),
    });
    expect(accepted).toMatchObject({ mode: "active", rejoinRequired: false });
    expect(participationState({ authorizationAcceptedAt: accepted.acceptedAt })).toMatchObject({
      mode: "active",
      audioAllowed: true,
      messagingAllowed: true,
    });
  });

  it("keeps Ask V visible, quiet, controllable, and outside attendance", () => {
    expect(askVParticipantState({ invited: true })).toEqual({
      visible: true,
      label: "VNDRLY Assistant",
      silentUnlessAddressed: true,
      countsTowardAttendance: false,
      countsTowardQuorum: false,
      state: "available",
    });
    expect(askVParticipantState({ invited: true, paused: true }).state).toBe("paused");
    expect(askVParticipantState({ invited: true, removed: true }).visible).toBe(false);
  });

  it("starts automatic transcription only under a verified company policy", () => {
    expect(startAutomaticTranscript({
      companyPolicyEnabled: true,
      companyPolicyVerifiedAt: new Date("2026-09-01T00:00:00Z"),
      occurrenceStatus: "live",
    })).toEqual({ start: true, indicator: "persistent", reason: "verified_company_policy" });
    expect(startAutomaticTranscript({
      companyPolicyEnabled: true,
      companyPolicyVerifiedAt: null,
      occurrenceStatus: "live",
    }).start).toBe(false);
  });
});

describe("meeting raw-media retention", () => {
  const endedAt = new Date("2026-08-01T12:00:00Z");
  const afterThirtyDays = new Date("2026-09-01T12:00:01Z");

  it("expires raw media after thirty days while retaining derived records", () => {
    expect(applyRecordingRetention({ endedAt, now: afterThirtyDays, activeHolds: [] })).toEqual({
      action: "delete_raw_media",
      rawMediaExpiresAt: new Date("2026-08-31T12:00:00Z"),
      retainTranscript: true,
      retainSummary: true,
    });
  });

  it.each(["legal", "incident", "evidence"] as const)("retains raw media during an active %s hold", (kind) => {
    const hold = placeRecordingHold({ kind, reason: "Authorized preservation", placedByUserId: 9, placedAt: endedAt });
    expect(applyRecordingRetention({ endedAt, now: afterThirtyDays, activeHolds: [hold] }).action).toBe("retain_on_hold");
  });
});
