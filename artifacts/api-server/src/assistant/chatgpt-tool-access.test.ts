import { describe, expect, it } from "vitest";
import { chatGptReadableTools, requireChatGptReadableTool } from "./chatgpt-tool-access";

describe("ChatGPT assistant tool access", () => {
  const session = { userId: 17, role: "vendor", membershipRole: "member", vendorId: 4 };
  it("rejects anonymous and unsupported identities", () => {
    expect(chatGptReadableTools({}, ["gate:read", "work_hub:read"])).toEqual([]);
    expect(chatGptReadableTools({ userId: 17, role: "guest" }, ["gate:read"])).toEqual([]);
  });
  it("requires an explicit recognized scope", () => {
    expect(chatGptReadableTools(session, [])).toEqual([]);
    expect(chatGptReadableTools(session, ["*"])).toEqual([]);
  });
  it("keeps Gate and Work Hub grants separate", () => {
    const gate = chatGptReadableTools(session, ["gate:read"]);
    const hub = chatGptReadableTools(session, ["work_hub:read"]);
    expect(gate.length).toBeGreaterThan(0);
    expect(hub.length).toBeGreaterThan(0);
    expect(gate.some((tool) => tool.workHubFamily)).toBe(false);
    expect(hub.every((tool) => Boolean(tool.workHubFamily))).toBe(true);
  });
  it("excludes writes and client operations even for an administrator", () => {
    const tools = chatGptReadableTools({ userId: 1, role: "admin", membershipRole: "admin" }, ["gate:read", "work_hub:read"]);
    expect(tools.every((tool) => !tool.mutating && tool.confirmation === "none" && tool.execution !== "client")).toBe(true);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    expect(() => requireChatGptReadableTool(session, ["gate:read"], "confirm_visitor_check_out")).toThrow();
    expect(() => requireChatGptReadableTool(session, ["gate:read"], "arbitrary_sql")).toThrow();
  });
});
