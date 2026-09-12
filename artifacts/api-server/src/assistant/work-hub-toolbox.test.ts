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
  it("does not advertise operations that lack a safe executable Work Hub route", () => {
    const actions = (name: string) => {
      const tool = ASK_V_TOOL_REGISTRY.find((entry) => entry.name === name);
      const properties = tool?.inputSchema.properties as
        | Record<string, { enum?: string[] }>
        | undefined;
      return properties?.action?.enum;
    };
    expect(actions("manage_work_hub_channel")).toEqual(["create", "delete"]);
    expect(actions("manage_work_hub_channel_member")).toEqual(["add", "invite"]);
    expect(actions("manage_work_hub_shift")).toEqual(["create", "claim"]);
    expect(actions("manage_work_hub_scheduling")).toEqual([
      "set_availability",
      "book",
    ]);
    expect(actions("manage_work_hub_meeting")).toEqual([
      "create",
      "join",
      "leave",
      "end",
    ]);
    expect(actions("manage_work_hub_meeting_file")).toEqual(["delete"]);
    expect(actions("manage_work_hub_task")).toEqual([
      "create",
      "update",
      "complete",
      "cancel",
    ]);
    expect(actions("manage_work_hub_form_template")).toEqual([
      "create",
      "assign",
    ]);
    expect(actions("manage_work_hub_approval")).toEqual([
      "request",
      "approve",
      "reject",
    ]);
  });

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
    expect(namesFor("/work-hub/channels", "vendor", "member"))
      .not.toContain("manage_work_hub_channel");
    expect(namesFor("/work-hub/channels", "vendor", "admin"))
      .toContain("manage_work_hub_channel");
    expect(namesFor("/work-hub/administration", "admin", null)).not.toContain(
      "manage_work_hub_legal_hold",
    );
  });

  it("loads the complete role-safe toolbox on the dedicated Ask V page", () => {
    const companyAdmin = namesFor("/work-hub/askv", "vendor", "admin");
    expect(companyAdmin).toEqual(expect.arrayContaining([
      "send_work_hub_message",
      "manage_work_hub_task",
      "manage_work_hub_scheduling",
      "start_work_hub_call",
      "ask_work_hub_meeting",
      "prepare_work_hub_file_upload",
      "manage_work_hub_finance",
      "manage_work_hub_export",
      "manage_work_hub_legal_hold",
    ]));
    const member = namesFor("/work-hub/askv", "vendor", "member");
    expect(member).toContain("send_work_hub_message");
    expect(member).not.toContain("manage_work_hub_export");
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
