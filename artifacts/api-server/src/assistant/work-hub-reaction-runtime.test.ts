import { expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";

const input = { channelId: "00000000-0000-4000-8000-000000000001", messageId: "00000000-0000-4000-8000-000000000002", operationId: "00000000-0000-4000-8000-000000000003", owner: { type: "vendor", id: 4 }, context: { kind: "organization", id: 4 }, expectedVersion: 2, reaction: "👍" };
it("preserves trusted operation, reviewed version and explicit desired state through confirmed runtime", () => {
  for (const action of ["add", "remove"] as const) {
    const args = { ...input, action };
    expect(() => validateChatGptActionInput("react_work_hub_message", args)).not.toThrow();
    expect(resolveExecutableWorkHubToolRequest("react_work_hub_message", args, false)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("react_work_hub_message", args, true)).toMatchObject({ method: "POST", path: `/work-hub/channels/${input.channelId}/messages/${input.messageId}/reactions`, body: { operationId: input.operationId, expectedVersion: 2, payload: { emoji: "👍", action } } });
  }
  expect(resolveExecutableWorkHubToolRequest("react_work_hub_message", input, true)).toMatchObject({ body: { payload: { emoji: "👍" } } });
});
it("refuses invalid desired state and emoji before preparation/execution", () => {
  for (const change of [{ action: "toggle" }, { action: "remove_all" }, { reaction: "" }]) {
    const args = { ...input, ...change };
    expect(() => validateChatGptActionInput("react_work_hub_message", args)).toThrow();
    expect(resolveExecutableWorkHubToolRequest("react_work_hub_message", args, true)).toHaveProperty("error");
  }
});
