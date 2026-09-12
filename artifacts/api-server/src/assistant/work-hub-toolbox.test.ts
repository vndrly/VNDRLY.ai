import { describe, expect, it } from "vitest";
import { ASK_V_TOOL_REGISTRY } from "./tool-registry";
import { toolsForRealtime, workHubToolFamilyForPath } from "./tool-packs";

const namesFor = (
  path: string,
  role = "vendor",
  membershipRole: string | null = null,
) =>
  toolsForRealtime({ role, membershipRole, path }).map((tool) => tool.name);

describe("Work Hub AskV web/iOS parity", () => {
  it("keeps the legacy server toolbox available while typed tools replace it in page packs", () => {
    const read = ASK_V_TOOL_REGISTRY.find((tool) => tool.name === "query_work_hub");
    const write = ASK_V_TOOL_REGISTRY.find((tool) => tool.name === "propose_work_hub_action");
    expect(read?.roles).toEqual(expect.arrayContaining(["admin", "partner", "vendor", "field_employee"]));
    expect(write).toMatchObject({ mutating: true, confirmation: "required", auditTarget: "work_hub" });
    expect(write?.inputSchema).toMatchObject({ properties: { operationId: { format: "uuid" } } });
    expect(namesFor("/work-hub/chat")).not.toContain("propose_work_hub_action");
  });

  it("routes every Work Hub page to a compact typed family", () => {
    expect(workHubToolFamilyForPath("/work-hub/activity")).toBe("command");
    expect(workHubToolFamilyForPath("/work-hub/chat")).toBe("collaboration");
    expect(workHubToolFamilyForPath("/work-hub/channels")).toBe("collaboration");
    expect(workHubToolFamilyForPath("/work-hub/calendar")).toBe("scheduling");
    expect(workHubToolFamilyForPath("/work-hub/calls")).toBe("calls");
    expect(workHubToolFamilyForPath("/work-hub/files")).toBe("files");
    expect(workHubToolFamilyForPath("/work-hub/tasks")).toBe("tasks");
    expect(workHubToolFamilyForPath("/work-hub/meetings")).toBe("meetings");
    expect(workHubToolFamilyForPath("/work-hub/billing")).toBe("finance");
    expect(workHubToolFamilyForPath("/work-hub/administration")).toBe("administration");

    expect(namesFor("/work-hub/activity")).toEqual(expect.arrayContaining([
      "get_work_hub_briefing", "search_work_hub", "get_work_hub_activity",
    ]));
    expect(namesFor("/work-hub/chat")).toEqual(expect.arrayContaining([
      "find_work_hub_people", "list_work_hub_messages", "send_work_hub_message",
    ]));
    expect(namesFor("/work-hub/calls")).toEqual(expect.arrayContaining([
      "get_work_hub_calls", "set_work_hub_call_availability", "list_work_hub_voicemail",
    ]));
    expect(namesFor("/work-hub/meetings")).toEqual(expect.arrayContaining([
      "manage_work_hub_meeting", "get_work_hub_meeting_catchup", "ask_work_hub_meeting",
    ]));
  });

  it("gives a company administrator every organization toolbox family without widening ordinary membership", () => {
    const companyAdmin = new Set(namesFor("/work-hub/administration", "vendor", "admin"));
    expect(companyAdmin).toEqual(expect.objectContaining({ size: expect.any(Number) }));
    expect(companyAdmin.has("manage_work_hub_export")).toBe(true);
    expect(companyAdmin.has("manage_work_hub_import")).toBe(true);
    expect(companyAdmin.has("manage_work_hub_retention")).toBe(true);
    expect(companyAdmin.has("manage_work_hub_legal_hold")).toBe(true);

    const member = namesFor("/work-hub/administration", "vendor", "member");
    expect(member).not.toContain("manage_work_hub_export");
    expect(member).not.toContain("manage_work_hub_retention");
    expect(member).not.toContain("manage_work_hub_legal_hold");
  });

  it("marks every typed Work Hub mutation for confirmation and auditing", () => {
    const typed = ASK_V_TOOL_REGISTRY.filter((tool) =>
      tool.name.endsWith("_work_hub") ||
      tool.name.includes("_work_hub_"),
    ).filter((tool) => !["query_work_hub", "propose_work_hub_action"].includes(tool.name));
    expect(typed.length).toBeGreaterThanOrEqual(35);
    for (const tool of typed) {
      expect(tool.auditTarget, tool.name).toBe("work_hub");
      if (tool.mutating) expect(tool.confirmation, tool.name).toBe("required");
    }
  });
});
