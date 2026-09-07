import { describe, expect, it } from "vitest";
import {
  ASK_V_TOOL_REGISTRY,
  toAnthropicTools,
  toRealtimeToolMetadata,
  toRealtimeTools,
  toolsForRole,
} from "./tool-registry";

describe("AskV tool registry", () => {
  it("keeps existing AskV data and write tools in one registry", () => {
    const names = ASK_V_TOOL_REGISTRY.map((tool) => tool.name);
    expect(names).toContain("query_tickets");
    expect(names).toContain("query_crew_eta");
    expect(names).toContain("lookup_map_origin");
    expect(names).toContain("query_attention_briefing");
    expect(names).toContain("query_ticket_route_eta");
    expect(names).toContain("query_ticket_mileage_audit");
    expect(names).toContain("query_ticket_proof_packet");
    expect(names).toContain("schedule_ticket_crew");
    expect(names).toContain("set_ticket_flag");
    expect(names).toContain("post_ticket_comment");
    expect(names).toContain("confirm_visitor_check_in");
    expect(names).toContain("set_ticket_lifecycle");
    expect(names).toContain("open_screen");
    expect(new Set(names).size).toBe(names.length);
  });

  it("emits the existing Anthropic schema contract", () => {
    const tools = toAnthropicTools(ASK_V_TOOL_REGISTRY);
    const schedule = tools.find((tool) => tool.name === "schedule_ticket_crew");
    expect(schedule?.input_schema.type).toBe("object");
    expect(schedule?.input_schema.required).toContain("ticketId");
    expect(schedule?.input_schema.required).toContain("scheduledStartAt");
  });

  it("emits supported Realtime function fields with closed parameter schemas", () => {
    const tools = toRealtimeTools(ASK_V_TOOL_REGISTRY);
    const schedule = tools.find((tool) => tool.name === "schedule_ticket_crew");
    const queryTickets = tools.find((tool) => tool.name === "query_tickets");
    expect(schedule).toMatchObject({
      type: "function",
      name: "schedule_ticket_crew",
    });
    expect(schedule?.parameters.type).toBe("object");
    expect(schedule?.parameters.additionalProperties).toBe(false);
    // The live Realtime endpoint rejects session.tools[0].strict even though
    // Responses supports it. Parameters and server validation remain strict.
    expect(tools.every(tool => !Object.hasOwn(tool, "strict"))).toBe(true);
    expect(queryTickets?.parameters.required).toEqual(
      expect.arrayContaining(["status", "vendorId", "siteId", "sinceDays", "limit", "countOnly"]),
    );
    const queryTicketProperties = queryTickets?.parameters.properties as Record<string, unknown> | undefined;
    expect(queryTicketProperties?.status).toMatchObject({
      type: ["string", "null"],
    });
  });

  it("emits Realtime client metadata for voice confirmation UX", () => {
    const metadata = toRealtimeToolMetadata(ASK_V_TOOL_REGISTRY);
    const schedule = metadata.find((tool) => tool.name === "schedule_ticket_crew");
    const queryTickets = metadata.find((tool) => tool.name === "query_tickets");
    const briefing = metadata.find((tool) => tool.name === "query_attention_briefing");
    expect(schedule).toEqual({
      name: "schedule_ticket_crew",
      mutating: true,
      confirmation: "required",
      auditTarget: "ticket",
    });
    expect(queryTickets).toMatchObject({
      name: "query_tickets",
      mutating: false,
      confirmation: "none",
    });
    expect(briefing).toMatchObject({
      name: "query_attention_briefing",
      mutating: false,
      confirmation: "none",
      auditTarget: "ticket",
    });
  });

  it("tracks mutating metadata separately from schema", () => {
    const schedule = ASK_V_TOOL_REGISTRY.find((tool) => tool.name === "schedule_ticket_crew");
    const markRead = ASK_V_TOOL_REGISTRY.find((tool) => tool.name === "mark_notifications_read");
    expect(schedule?.mutating).toBe(true);
    expect(schedule?.confirmation).toBe("required");
    expect(markRead?.mutating).toBe(true);
    expect(markRead?.confirmation).toBe("required");
    const checkIn = ASK_V_TOOL_REGISTRY.find((tool) => tool.name === "confirm_visitor_check_in");
    const openScreen = ASK_V_TOOL_REGISTRY.find((tool) => tool.name === "open_screen");
    expect(checkIn).toMatchObject({
      mutating: true,
      confirmation: "required",
      risk: "high",
      execution: "server",
      pack: "screen",
    });
    expect(openScreen).toMatchObject({
      execution: "client",
      pack: "core",
    });
  });

  it("role-filters office-only tools before a Realtime session is minted", () => {
    const fieldTools = toolsForRole("field_employee").map((tool) => tool.name);
    expect(fieldTools).toContain("query_ticket_detail");
    expect(fieldTools).toContain("query_ticket_proof_packet");
    expect(fieldTools).toContain("query_ticket_logged_miles");
    expect(fieldTools).toContain("query_ticket_route_eta");
    expect(fieldTools).toContain("query_ticket_mileage_audit");
    expect(fieldTools).toContain("lookup_map_origin");
    expect(fieldTools).toContain("query_attention_briefing");
    expect(fieldTools).toContain("post_ticket_comment");
    expect(fieldTools).not.toContain("query_invoice_summary");
    expect(fieldTools).not.toContain("query_crew_route_summary");
  });
});
