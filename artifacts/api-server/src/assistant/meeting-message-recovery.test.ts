import { expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("./chatgpt-tool-access", () => ({
  chatGptActionTools: () =>
    access.allowed ? [{ name: "send_work_hub_meeting_message" }] : [],
}));
import { recoverMeetingMessageAction } from "./meeting-message-recovery";
import {
  resolveExecutableWorkHubToolRequest,
  bindWorkHubToolScope,
} from "./work-hub-tool-runtime";
import {
  sanitizeChatGptActionInput,
  validateChatGptActionInput,
} from "./chatgpt-write-capabilities";
const args = {
    occurrenceId: "11111111-1111-4111-8111-111111111111",
    body: "Reviewed synthetic room text",
    recipientUserId: 10,
  },
  session = { userId: 9, role: "vendor", vendorId: 4 },
  id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  action = {
    toolName: "send_work_hub_meeting_message",
    tokenHash: "a".repeat(64),
    arguments: args,
  },
  receipt = {
    id,
    occurrenceId: args.occurrenceId,
    userId: 9,
    body: args.body,
    recipientUserId: 10,
    createdAt: "2026-10-07T10:00:00Z",
    messageType: "typed",
    status: "saved",
    consentAccepted: false,
    deviceCaptureStarted: false,
  };
it("prepares exact public/private room messages with trusted UUID and refuses incomplete/extra fields", () => {
  validateChatGptActionInput(action.toolName, args);
  const bound = {
    ...bindWorkHubToolScope(args, session, action.toolName),
    operationId: id,
  };
  expect(
    resolveExecutableWorkHubToolRequest(action.toolName, bound, false, session),
  ).toHaveProperty("error");
  expect(
    resolveExecutableWorkHubToolRequest(action.toolName, bound, true, session),
  ).toMatchObject({
    method: "POST",
    path: `/work-hub/meetings/${args.occurrenceId}/chat`,
    body: { id, body: args.body, recipientUserId: 10 },
  });
  expect(
    sanitizeChatGptActionInput(action.toolName, {
      ...args,
      operationId: "model",
      confirmed: true,
    }),
  ).toEqual(args);
  for (const bad of [
    { ...args, body: "" },
    { ...args, recipientUserId: -1 },
    { ...args, consentAccepted: true },
    { ...args, occurrenceId: "not-id" },
  ])
    expect(() => validateChatGptActionInput(action.toolName, bad)).toThrow();
});
it("recovers only the exact saved current-user room message by GET, never sends", async () => {
  access.allowed = true;
  const request = vi.fn().mockResolvedValue({ receipt });
  expect(
    await recoverMeetingMessageAction(
      action,
      session,
      ["work_hub:write"],
      request,
    ),
  ).toEqual(receipt);
  expect(request).toHaveBeenCalledWith(
    `/work-hub/meetings/${args.occurrenceId}/chat/operations/${id}`,
    "GET",
    {},
    session,
  );
  for (const changed of [
    null,
    { ...receipt, body: "different" },
    { ...receipt, userId: 10 },
    { ...receipt, recipientUserId: null },
    { ...receipt, occurrenceId: id },
  ])
    expect(
      await recoverMeetingMessageAction(
        action,
        session,
        [],
        vi.fn().mockResolvedValue({ receipt: changed }),
      ),
    ).toBeNull();
  access.allowed = false;
  const denied = vi.fn();
  expect(
    await recoverMeetingMessageAction(action, session, [], denied),
  ).toBeNull();
  expect(denied).not.toHaveBeenCalled();
});
