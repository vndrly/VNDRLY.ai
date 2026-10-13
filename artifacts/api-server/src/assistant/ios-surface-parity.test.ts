import { describe, expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { toolsForRealtime } from "./tool-packs";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { runClientTool } from "./client-tools";

const actor = { userId: 1, role: "vendor", vendorId: 3, membershipRole: "admin" };
describe("new iOS surface parity", () => {
  it("resolves recorded GPS and commercial planning through canonical authorized endpoints", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(resolveExecutableWorkHubToolRequest("query_fleet_location_history", { runId: id }, false, actor)).toMatchObject({ method: "GET", path: `/fleet/runs/${id}/location-history` });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_ticket_plan", { ticketId: 42 }, false, actor)).toMatchObject({ method: "GET", path: "/fleet/tickets/42/plan" });
    expect(resolveExecutableWorkHubToolRequest("recommend_fleet_destinations", { siteId: 42, material: "water" }, false, actor)).toMatchObject({ method: "GET", path: "/fleet/destinations/recommend?siteId=42&material=water" });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_location_history", { runId: "invalid" }, false, actor)).toHaveProperty("error");
  });
  it("requires confirmed revision-bound Fleet planning writes", () => {
    const input={ticketId:42,operationId:"00000000-0000-4000-8000-000000000001",expectedVersion:0,mode:"batch",rateCents:2500,closure:"manual",closesAt:null,destinationIds:["00000000-0000-4000-8000-000000000002"]};
    expect(resolveExecutableWorkHubToolRequest("save_fleet_ticket_plan",input,false,actor)).toHaveProperty("requiresConfirmation",true);
    expect(resolveExecutableWorkHubToolRequest("save_fleet_ticket_plan",input,true,actor)).toMatchObject({method:"POST",path:"/fleet/tickets/42/plan",body:{rateCents:2500,mode:"batch"}});
    expect(resolveExecutableWorkHubToolRequest("save_fleet_ticket_plan",{...input,siteId:999},true,actor)).toHaveProperty("error");
  });
  it("separates coverage reads from confirmed company changes", () => {
    expect(resolveExecutableWorkHubToolRequest("query_gate_coverage_map", {}, false, actor)).toMatchObject({ method: "GET", path: "/gate-change-over/coverage-map" });
    expect(resolveExecutableWorkHubToolRequest("set_company_operations", { categories: ["gate", "fleet"] }, false, actor)).toHaveProperty("requiresConfirmation", true);
    expect(resolveExecutableWorkHubToolRequest("set_company_operations", { categories: ["gate", "fleet"] }, true, actor)).toMatchObject({ method: "PATCH", path: "/company-operations", body: { categories: ["gate", "fleet"] } });
    expect(resolveExecutableWorkHubToolRequest("set_company_operations", { categories: ["gate"] }, true, { ...actor, membershipRole: "employee" })).toHaveProperty("error");
  });
  it("discovers new tools on maps without bypassing ChatGPT read scopes", () => {
    const names = toolsForRealtime({ role: "vendor", membershipRole: "admin", path: "/fleet-map" }).map(tool => tool.name);
    expect(names).toContain("query_fleet_location_history");
    expect(CHATGPT_READ_CAPABILITIES["fleet:read"].tools).toContain("query_fleet_ticket_plan");
    expect(CHATGPT_READ_CAPABILITIES["crew:read"].tools).toContain("query_gate_coverage_map");
  });
  it("opens native surfaces as client intents without writing records", () => {
    for (const screen of ["fleet-log", "fleet-map", "gate-map", "company-operations", "work-hub-attention", "work-hub-safety", "work-hub-my-work"]) {
      expect(JSON.parse(runClientTool("open_screen", { screen }, actor as never))).toMatchObject({ ok: true, execution: "client", intent: { name: "open_screen", arguments: { screen } } });
    }
  });
});
