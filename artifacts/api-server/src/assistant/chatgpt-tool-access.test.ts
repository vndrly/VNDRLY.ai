import { describe, expect, it } from "vitest";
import { chatGptReadableTools, requireChatGptReadableTool, chatGptReadToolOutput, chatGptReadToolDescription } from "./chatgpt-tool-access";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { findAskVTool } from "./tool-registry";

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
  it("advertises onboarding only for a resolvable administrator or field-self scope", () => {
    const has = (identity: Parameters<typeof chatGptReadableTools>[0]) => chatGptReadableTools(identity, ["onboarding:read"]).some(tool => tool.name === "lookup_user_progress");
    expect(has(session)).toBe(false);
    expect(has({ ...session, membershipRole: "admin" })).toBe(true);
    expect(has({ userId: 1, role: "admin", membershipRole: "admin" })).toBe(false);
    expect(has({ userId: 1, role: "field_employee", vendorPeopleId: null })).toBe(false);
    expect(has({ userId: 1, role: "field_employee", vendorPeopleId: 8 })).toBe(true);
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
  it("exposes Gate resolution and draft helpers only with Gate read access", () => {
    const gate = chatGptReadableTools(session, ["gate:read"]);
    for (const name of ["resolve_gate_check_in", "prepare_visitor_check_in", "prepare_visitor_check_out"]) {
      expect(gate.some(tool => tool.name === name)).toBe(true);
      expect(() => requireChatGptReadableTool(session, ["work_hub:read"], name)).toThrow();
    }
    expect(gate.some(tool => tool.name === "confirm_visitor_check_in")).toBe(false);
  });
  it("returns draft data without a client execution claim or form instruction", () => {
    const raw = { ok: true, draft: { firstName: "Sam" }, missing: ["latitude"], execution: "client", intent: { name: "prefill_gate_visit" } };
    const projected = chatGptReadToolOutput("prepare_visitor_check_in", raw);
    expect(projected).toMatchObject({ draft: raw.draft, missing: raw.missing, execution: "draft_only", submitted: false, formPopulated: false });
    expect(projected).not.toHaveProperty("intent");
    expect(raw).toHaveProperty("intent");
    expect(chatGptReadToolOutput("query_gate_stations", raw)).toBe(raw);
    expect(chatGptReadToolDescription(requireChatGptReadableTool(session, ["gate:read"], "prepare_visitor_check_in"))).toContain("No VNDRLY form is populated");
  });
  it("requires separate family consent and preserves role restrictions", () => {
    expect(() => requireChatGptReadableTool(session, ["gate:read", "work_hub:read"], "query_ticket_detail")).toThrow();
    expect(requireChatGptReadableTool(session, ["tickets:read"], "query_ticket_detail").name).toBe("query_ticket_detail");
    expect(() => requireChatGptReadableTool({ userId: 17, role: "field_employee" }, ["finance:read"], "query_invoices")).toThrow();
    expect(() => requireChatGptReadableTool(session, ["tickets:read"], "query_gps_trail")).toThrow();
    expect(requireChatGptReadableTool(session, ["crew:read"], "query_gps_trail").name).toBe("query_gps_trail");
  });
  it("maps only explicit known server reads and excludes the legacy unscoped worker lookup", () => {
    for (const capability of Object.values(CHATGPT_READ_CAPABILITIES)) for (const name of capability.tools) {
      const tool = findAskVTool(name);
      expect(tool, name).not.toBeNull();
      expect(tool, name).toMatchObject({ mutating: false, confirmation: "none", execution: "server" });
    }
    const all = chatGptReadableTools({ userId: 1, role: "admin", membershipRole: "admin" }, Object.keys(CHATGPT_READ_CAPABILITIES));
    expect(all.some(tool => tool.name === "lookup_open_tickets")).toBe(false);
    expect(all.some(tool => tool.name === "launch_camera")).toBe(false);
    expect(all.some(tool => tool.name === "set_ticket_lifecycle")).toBe(false);
  });
  it("projects onboarding progress without arbitrary private setup payload", () => {
    const result = chatGptReadToolOutput("lookup_user_progress", { progress: { orgType: "vendor", currentStep: "profile", completedSteps: [], payload: { federalTaxId: "synthetic-sensitive", accountSecret: "synthetic-secret" } } });
    expect(result).toEqual({ progress: { orgType: "vendor", currentStep: "profile", completedSteps: [] } });
    expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
  });
});
