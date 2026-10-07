import { expect, it } from "vitest";
import {
  resolveExecutableWorkHubToolRequest,
  bindWorkHubToolScope,
} from "./work-hub-tool-runtime";
import {
  sanitizeChatGptActionInput,
  validateChatGptActionInput,
} from "./chatgpt-write-capabilities";
const occurrenceId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222",
  session = { userId: 9, role: "vendor", vendorId: 4, membershipRole: "admin" };
it.each([true, false])(
  "requires prepared confirmation and forwards explicit desired state %s with trusted UUID",
  (invited) => {
    const input = {
      action: "set_assistant",
      occurrenceId,
      payload: { expectedVersion: 0, invited },
    };
    validateChatGptActionInput("manage_work_hub_meeting", input);
    const bound = {
      ...bindWorkHubToolScope(input, session, "manage_work_hub_meeting"),
      operationId,
    };
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_work_hub_meeting",
        bound,
        false,
        session,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_work_hub_meeting",
        bound,
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: "/work-hub/meetings/" + occurrenceId + "/askv",
      body: { operationId, expectedVersion: 0, invited },
    });
  },
);
it("rejects missing revision, extra consent and invalid occurrence before any canonical request", () => {
  for (const input of [
    { action: "set_assistant", occurrenceId, payload: { invited: true } },
    {
      action: "set_assistant",
      occurrenceId,
      payload: { expectedVersion: 0, invited: true, consentAccepted: true },
    },
    {
      action: "set_assistant",
      occurrenceId: "../other",
      payload: { expectedVersion: 0, invited: true },
    },
  ])
    expect(() =>
      validateChatGptActionInput("manage_work_hub_meeting", input),
    ).toThrow();
  expect(
    sanitizeChatGptActionInput("manage_work_hub_meeting", {
      action: "set_assistant",
      operationId,
      confirmed: true,
      payload: { expectedVersion: 0, invited: true },
    }),
  ).not.toHaveProperty("operationId");
});
