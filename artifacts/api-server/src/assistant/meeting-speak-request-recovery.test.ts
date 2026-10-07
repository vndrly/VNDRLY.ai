import { expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("./chatgpt-tool-access", () => ({
  chatGptActionTools: () =>
    access.allowed ? [{ name: "moderate_work_hub_meeting" }] : [],
}));
import { recoverMeetingSpeakRequestAction } from "./meeting-speak-request-recovery";
import {
  bindWorkHubToolScope,
  resolveExecutableWorkHubToolRequest,
} from "./work-hub-tool-runtime";
import {
  sanitizeChatGptActionInput,
  validateChatGptActionInput,
} from "./chatgpt-write-capabilities";
const args = {
    action: "request_to_speak",
    occurrenceId: "11111111-1111-4111-8111-111111111111",
  },
  session = {
    userId: 9,
    role: "vendor",
    vendorId: 4,
    activeMembershipId: 3,
    sv: 1,
  },
  id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  action = {
    toolName: "moderate_work_hub_meeting",
    tokenHash: "a".repeat(64),
    arguments: args,
  },
  receipt = {
    operationId: id,
    occurrenceId: args.occurrenceId,
    actorUserId: 9,
    actorMembershipId: 3,
    actorSessionVersion: 1,
    ownerOrgType: "vendor",
    ownerOrgId: 4,
    requestId: id,
    requestedAt: "2026-10-07T10:00:00Z",
    status: "saved",
    microphoneOpened: false,
    consentAccepted: false,
  };
it("requires actual approval, trusted UUID and strict requester-only arguments", () => {
  expect(
    sanitizeChatGptActionInput(action.toolName, {
      ...args,
      operationId: "model",
      confirmed: true,
    }),
  ).toEqual(args);
  validateChatGptActionInput(action.toolName, args);
  const input = {
    ...bindWorkHubToolScope(args, session, action.toolName),
    operationId: id,
  };
  expect(
    resolveExecutableWorkHubToolRequest(action.toolName, input, false, session),
  ).toHaveProperty("error");
  expect(
    resolveExecutableWorkHubToolRequest(action.toolName, input, true, session),
  ).toMatchObject({
    method: "POST",
    path: `/work-hub/meetings/${args.occurrenceId}/request-to-speak`,
    body: { operationId: id },
  });
  for (const changed of [
    { ...args, targetUserId: 10 },
    { ...args, payload: { consentAccepted: true } },
    { ...args, occurrenceId: "bad" },
  ])
    expect(() =>
      validateChatGptActionInput(action.toolName, changed),
    ).toThrow();
});
it("recovers exact current-session receipt via GET only and rejects changed account/occurrence/op", async () => {
  const request = vi.fn().mockResolvedValue({ receipt });
  expect(
    await recoverMeetingSpeakRequestAction(
      action,
      session,
      ["work_hub:write"],
      request,
    ),
  ).toEqual(receipt);
  expect(request).toHaveBeenCalledWith(
    `/work-hub/meetings/${args.occurrenceId}/request-to-speak/operations/${id}`,
    "GET",
    {},
    session,
  );
  for (const changed of [
    null,
    { ...receipt, actorUserId: 10 },
    { ...receipt, actorMembershipId: 4 },
    { ...receipt, ownerOrgId: 5 },
    { ...receipt, ownerOrgType: "partner" },
    { ...receipt, actorSessionVersion: 2 },
    { ...receipt, occurrenceId: id },
    { ...receipt, operationId: args.occurrenceId },
  ])
    expect(
      await recoverMeetingSpeakRequestAction(
        action,
        session,
        [],
        vi.fn().mockResolvedValue({ receipt: changed }),
      ),
    ).toBeNull();
  access.allowed = false;
  request.mockClear();
  expect(
    await recoverMeetingSpeakRequestAction(action, session, [], request),
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
