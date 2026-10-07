import { expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("./chatgpt-tool-access", () => ({
  chatGptActionTools: () =>
    access.allowed ? [{ name: "manage_work_hub_meeting" }] : [],
}));
import { recoverMeetingAssistantInvitationAction } from "./meeting-assistant-invitation-recovery";
import { meetingInvitationFingerprint } from "../work-hub/meeting-assistant-invitation";
const session = {
    userId: 9,
    role: "vendor",
    vendorId: 4,
    sv: 1,
    activeMembershipId: 5,
  },
  action = {
    toolName: "manage_work_hub_meeting",
    tokenHash: "a".repeat(64),
    arguments: {
      action: "set_assistant",
      occurrenceId: "11111111-1111-4111-8111-111111111111",
      payload: { expectedVersion: 0, invited: true },
    },
  };
const command = {
    ...action.arguments.payload,
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  },
  actor = {
    userId: 9,
    ownerOrgType: "vendor" as const,
    ownerOrgId: 4,
    actorMembershipId: 5,
    actorSessionVersion: 1,
  },
  receipt = {
    ...command,
    occurrenceId: action.arguments.occurrenceId,
    actorUserId: 9,
    actorMembershipId: 5,
    actorSessionVersion: 1,
    ownerOrgType: "vendor",
    ownerOrgId: 4,
    fingerprint: meetingInvitationFingerprint(
      action.arguments.occurrenceId,
      actor,
      command,
    ),
    version: 1,
    status: "applied",
    changed: true,
    recordedAt: "2026-10-07T10:00:00Z",
    consentAccepted: false,
    deviceCaptureStarted: false,
  };
it("recovers only exact canonical receipt through GET without reexecuting", async () => {
  access.allowed = true;
  const request = vi.fn().mockResolvedValue({ receipt });
  expect(
    await recoverMeetingAssistantInvitationAction(
      action,
      session,
      ["work_hub:write"],
      request,
    ),
  ).toEqual(receipt);
  expect(request).toHaveBeenCalledWith(
    "/work-hub/meetings/" +
      action.arguments.occurrenceId +
      "/askv/operations/" +
      command.operationId +
      "?expectedVersion=0&invited=true",
    "GET",
    {},
    session,
  );
});
it("missing/current-denied/changed actor or intent cannot fabricate recovery", async () => {
  access.allowed = true;
  for (const r of [
    null,
    { ...receipt, invited: false },
    { ...receipt, actorUserId: 10 },
    { ...receipt, version: 2 },
  ])
    expect(
      await recoverMeetingAssistantInvitationAction(
        action,
        session,
        [],
        vi.fn().mockResolvedValue({ receipt: r }),
      ),
    ).toBeNull();
  const request = vi.fn();
  access.allowed = false;
  expect(
    await recoverMeetingAssistantInvitationAction(action, session, [], request),
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
  access.allowed = true;
  expect(
    await recoverMeetingAssistantInvitationAction(
      {
        ...action,
        arguments: { ...action.arguments, operationId: command.operationId },
      },
      session,
      [],
      request,
    ),
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
