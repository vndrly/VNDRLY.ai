import { expect, it } from "vitest";
import { displayActionRequest } from "./operations-display-action-adapter";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { sanitizeChatGptActionInput, validateChatGptActionInput } from "./chatgpt-write-capabilities";
import { chatGptActionTools } from "./chatgpt-tool-access";
const id = "00000000-0000-4000-8000-000000000001";
const command = { action: "route", operationId: id, displayId: id, expectedUpdatedAt: "2026-10-07T10:00:00.123Z", reason: "Show site", monitorName: "Left", view: "gate_log", siteLocationId: 392 };
it("requires real approval before canonical routing and preserves exact command on retry/readback", () => {
  expect(resolveExecutableWorkHubToolRequest("confirm_operations_displays_action", command, false)).toMatchObject({ requiresConfirmation: true });
  const sent = resolveExecutableWorkHubToolRequest("confirm_operations_displays_action", command, true);
  expect(sent).toEqual({ method: "POST", path: "/implementation-a/operations-displays/commands", body: command });
  expect(displayActionRequest(command, true)).toEqual({ method: "POST", path: "/implementation-a/operations-displays/commands/readback", body: command });
  expect(displayActionRequest(command)).toEqual(sent);
});
it("strips model replay keys before review but rejects pairing/device identity and stale or unsupported fields", () => {
  const reviewed = sanitizeChatGptActionInput("confirm_operations_displays_action", { ...command, confirmed: true });
  expect(reviewed).not.toHaveProperty("operationId"); expect(reviewed).not.toHaveProperty("confirmed");
  expect(() => validateChatGptActionInput("confirm_operations_displays_action", reviewed)).not.toThrow();
  for (const bad of [{ ...command, companionDeviceId: id }, { ...command, token: "secret" }, { ...command, action: "register" }, { ...command, expectedUpdatedAt: undefined }, { ...command, monitorName: undefined }]) expect(() => displayActionRequest(bad)).toThrow();
});
it("supports only exact room or revoke shapes and eligible separately consented discovery", () => {
  const common = { displayId: id, operationId: id, expectedUpdatedAt: command.expectedUpdatedAt, reason: "Saved intent" };
  expect(displayActionRequest({ ...common, action: "join_room", monitorName: "Right", meetingOccurrenceId: id }).body).toMatchObject({ action: "join_room", meetingOccurrenceId: id });
  expect(displayActionRequest({ ...common, action: "revoke" }).body).toMatchObject({ action: "revoke" });
  const admin = { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin" };
  const names = (session = admin, scopes = ["operations:write"]) => chatGptActionTools(session, scopes).map(tool => tool.name);
  expect(names()).toContain("confirm_operations_displays_action");
  expect(names(admin, ["operations:read"])).not.toContain("confirm_operations_displays_action");
  expect(names({ ...admin, membershipRole: "member" })).not.toContain("confirm_operations_displays_action");
});
