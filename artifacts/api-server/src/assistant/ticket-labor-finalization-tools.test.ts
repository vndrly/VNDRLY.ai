import { expect, it } from "vitest";
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";
import { ticketRecordActionsForRole } from "./ticket-workflow-tools";
const session = { userId: 9, role: "vendor", vendorId: 4, sv: 1 };
const input = { action: "finalize_labor", ticketId: 7, payload: { expectedUpdatedAt: "2026-10-07T10:00:00.000Z" } };
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
it("requires trusted approval and preserves exact reviewed timestamp with server operation identity", () => {
  validateChatGptActionInput("manage_ticket_record", input);
  const bound = { ...bindWorkHubToolScope(input, session, "manage_ticket_record"), operationId };
  expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", bound, false, session)).toHaveProperty("error");
  expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", bound, true, session)).toMatchObject({ method: "POST", path: "/tickets/7/close", body: { operationId, expectedUpdatedAt: input.payload.expectedUpdatedAt } });
  expect(ticketRecordActionsForRole("partner")).not.toContain("finalize_labor");
  expect(ticketRecordActionsForRole("field_employee")).toContain("finalize_labor");
});
it("rejects unversioned or fabricated lifecycle/physical/operation fields before sending", () => {
  for (const payload of [{}, { expectedUpdatedAt: "yesterday" }, { ...input.payload, operationId }, { ...input.payload, status: "submitted" }, { ...input.payload, physicalWorkVerified: true }]) {
    expect(() => validateChatGptActionInput("manage_ticket_record", { ...input, payload })).toThrow();
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { ...input, payload, operationId }, true, session)).toHaveProperty("error");
  }
});
