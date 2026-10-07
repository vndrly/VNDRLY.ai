import { expect, it } from "vitest";
import { chatGptActionTools, requireChatGptReadableTool } from "./chatgpt-tool-access";
import { findAskVTool } from "./tool-registry";
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";

it("permits the canonical own-profile read for partner and admin under the existing read grant", () => {
  for (const session of [{ userId: 1069, role: "partner", partnerId: 609 }, { userId: 12, role: "admin" }]) {
    expect(requireChatGptReadableTool(session, ["work_hub:read"], "prepare_work_hub_profile")).toMatchObject({ mutating: false, confirmation: "none" });
    expect(resolveExecutableWorkHubToolRequest("prepare_work_hub_profile", bindWorkHubToolScope({}, session, "prepare_work_hub_profile"), false, session)).toEqual({ method: "GET", path: "/field/me", body: {} });
    expect(chatGptActionTools(session, ["work_hub:write"]).some(tool => tool.name === "confirm_work_hub_profile")).toBe(false);
  }
});

it("requires current connection scope even when the caller knows a cached tool name", () => {
  for (const session of [{ userId: 1069, role: "partner", partnerId: 609 }, { userId: 1073, role: "vendor", vendorId: 1107 }]) {
    for (const scopes of [[], ["gate:read", "tickets:read"], ["work_hub:write"]])
      expect(() => requireChatGptReadableTool(session, scopes, "prepare_work_hub_profile")).toThrow();
  }
  expect(findAskVTool("confirm_work_hub_profile")?.roles).toEqual(["field_employee"]);
});

it("cannot select another profile or pass foreign context to the canonical read", () => {
  const session = { userId: 1069, role: "partner", partnerId: 609 };
  const bound = bindWorkHubToolScope({ owner: { type: "vendor", id: 999 }, context: { kind: "user", id: 999 }, userId: 999 }, session, "prepare_work_hub_profile");
  expect(resolveExecutableWorkHubToolRequest("prepare_work_hub_profile", bound, false, session)).toEqual({ method: "GET", path: "/field/me", body: {} });
});
