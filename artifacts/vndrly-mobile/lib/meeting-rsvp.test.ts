import { describe, it, expect, vi } from "vitest";
import { makeRsvpAttempt, submitRsvpAttempt } from "./meeting-rsvp";
const input = {
  operationId: "10000000-0000-4000-8000-000000000001",
  occurrenceId: "10000000-0000-4000-8000-000000000002",
  expectedFingerprint: "a".repeat(64),
  response: "accepted" as const,
};
const receipt = {
  operationId: input.operationId,
  occurrenceId: input.occurrenceId,
  actorUserId: 7,
  commandFingerprint: "b".repeat(64),
  scheduleFingerprint: input.expectedFingerprint,
  response: input.response,
  recordedAt: "2026-10-07T15:00:00Z",
  status: "response_recorded",
  physicalAttendanceVerified: false,
  recordingConsentGranted: false,
  externalAttendeeAcceptanceVerified: false,
};
describe("native exact meeting RSVP", () => {
  it("recovers committed response before retry without execute", async () => {
    const a = makeRsvpAttempt(input, 7, "b".repeat(64));
    const api = vi.fn().mockResolvedValue({ receipt, replayed: true });
    await expect(submitRsvpAttempt(a, true, api, () => true)).resolves.toEqual(
      receipt,
    );
    expect(api.mock.calls[0][0]).toContain("/readback");
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("executes identical immutable body only after authorized null readback", async () => {
    const a = makeRsvpAttempt(input, 7, "b".repeat(64));
    const api = vi
      .fn()
      .mockResolvedValueOnce({ receipt: null, replayed: false })
      .mockResolvedValueOnce({ receipt, replayed: false });
    await submitRsvpAttempt(a, true, api, () => true);
    expect(api.mock.calls[0][1].body).toBe(api.mock.calls[1][1].body);
  });
  it("does not resend when readback denied", async () => {
    const api = vi.fn().mockRejectedValue({ status: 403 });
    await expect(
      submitRsvpAttempt(
        makeRsvpAttempt(input, 7, "b".repeat(64)),
        true,
        api,
        () => true,
      ),
    ).rejects.toBeDefined();
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("refuses altered actor/fingerprint and account changed during request", async () => {
    const a = makeRsvpAttempt(input, 7, "b".repeat(64));
    await expect(
      submitRsvpAttempt(
        a,
        false,
        async () => ({
          receipt: { ...receipt, actorUserId: 8 },
          replayed: false,
        }),
        () => true,
      ),
    ).rejects.toThrow();
    let current = true;
    await expect(
      submitRsvpAttempt(
        a,
        false,
        async () => {
          current = false;
          return { receipt, replayed: false };
        },
        () => current,
      ),
    ).rejects.toThrow();
  });
});
