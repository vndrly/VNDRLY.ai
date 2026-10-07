import { describe, expect, it } from "vitest";
import { toolsForRealtime, VOICE_WORKFLOWS } from "./tool-packs";
import { DATA_TOOL_NAMES } from "./tool-names";

describe("AskV realtime tool packs", () => {
  it("gives the dedicated AskV page its market quote tools", () => {
    const names = toolsForRealtime({ role: "vendor", path: "/work-hub/askv" }).map(tool => tool.name);
    expect(names).toContain("get_stock_quote");
    expect(names).toContain("get_crude_oil_price");
  });
  it("gives native AskV the same complete role-safe toolbox as web AskV", () => {
    const context = { role: "vendor", membershipRole: "admin" } as const;
    const web = toolsForRealtime({ ...context, path: "/work-hub/askv" }).map((tool) => tool.name);
    const native = toolsForRealtime({ ...context, path: "/mobile/work-hub/askv" }).map((tool) => tool.name);
    expect(native).toEqual(web);
    expect(native).toEqual(expect.arrayContaining([
      "send_work_hub_message",
      "manage_work_hub_task",
      "manage_work_hub_calendar_item",
      "query_asset_custody",
      "open_screen",
    ]));
  });
  it("keeps every native page toolbox equal to its web counterpart for every role", () => {
    const paths = [
      "/dashboard", "/tickets", "/tickets/42", "/schedule", "/gatekeeper",
      "/gate/shift-notes", "/notifications", "/profile", "/compliance", "/reports",
      "/onboarding/vendor", "/work-hub/askv", "/work-hub/activity", "/work-hub/chat",
      "/work-hub/channels", "/work-hub/crews", "/work-hub/calendar", "/work-hub/calls",
      "/work-hub/voicemail", "/work-hub/files", "/work-hub/files-notes", "/work-hub/inventory",
      "/work-hub/assets", "/work-hub/tasks-forms", "/work-hub/meetings", "/work-hub/finance",
      "/work-hub/administration", "/work-hub/implementation-exports", "/work-hub/settings-connections",
    ];
    for (const role of ["admin", "partner", "vendor", "field_employee"] as const) {
      for (const membershipRole of ["admin", "member"] as const) {
        for (const path of paths) {
          const web = toolsForRealtime({ role, membershipRole, path }).map((tool) => tool.name);
          const native = toolsForRealtime({ role, membershipRole, path: `/mobile${path}` }).map((tool) => tool.name);
          expect(native, `${role}/${membershipRole}: ${path}`).toEqual(web);
        }
      }
    }
  });
  it("keeps Shift Notes read-first and exposes safe Profile tools", () => {
    const history = toolsForRealtime({ role: "vendor", path: "/gate/shift-notes" });
    expect(history.map(t => t.name)).toContain("query_shift_notes");
    expect(history.filter(t => t.mutating)).toEqual([]);
    expect(toolsForRealtime({ role: "vendor", membershipRole: "admin", path: "/mobile/profile" }).map(t => t.name)).toContain("prepare_work_hub_profile");
    expect(toolsForRealtime({ role: "vendor", membershipRole: "member", path: "/mobile/profile" }).map(t => t.name)).not.toContain("confirm_work_hub_gate_location");
  });
  it("loads canonical native Work Hub aliases", () => {
    for (const path of ["/work-hub/files-notes", "/work-hub/inventory", "/work-hub/assets"]) {
      const names = toolsForRealtime({ role: "vendor", path }).map(t => t.name);
      expect(names).toContain("list_work_hub_files");
      expect(names).toContain("query_asset_custody");
      expect(names).toContain("list_work_hub_notes");
      expect(names).toContain("manage_work_hub_note");
    }
    expect(toolsForRealtime({ role: "vendor", path: "/work-hub/tasks-forms" }).map(t => t.name)).toContain("manage_work_hub_task");
    expect(toolsForRealtime({ role: "vendor", path: "/work-hub/implementation-exports" }).map(t => t.name)).toContain("preview_work_hub_role_export");
  });
  it("exposes Gate Report in gate and reports workflows only to office roles", () => {
    for (const workflow of ["gate", "reports"] as const) {
      for (const role of ["admin", "partner", "vendor"]) {
        expect(toolsForRealtime({ role, workflow }).map(tool => tool.name)).toContain("query_gate_report");
      }
      expect(toolsForRealtime({ role: "field_employee", workflow }).map(tool => tool.name)).not.toContain("query_gate_report");
    }
  });
  it("loads the existing onboarding workflow from its screen and from another screen", () => {
    for (const args of [
      { path: "/onboarding/vendor" },
      { path: "/mobile/onboarding/partner" },
      { path: "/gate", workflow: "onboarding" as const },
    ]) {
      const names = toolsForRealtime({ role: "vendor", ...args }).map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        "lookup_user_progress", "start_onboarding", "set_onboarding_field",
        "complete_onboarding_step", "finalize_onboarding",
      ]));
      expect(names).not.toContain("schedule_ticket_crew");
      expect(names).not.toContain("set_ticket_flag");
    }
  });

  it("limits finalization to organization roles and keeps self onboarding for field employees", () => {
    const names = (role: string) => toolsForRealtime({ role, path: "/onboarding/field" }).map((tool) => tool.name);
    expect(names("field_employee")).toContain("set_onboarding_field");
    expect(names("field_employee")).toContain("complete_onboarding_step");
    expect(names("field_employee")).not.toContain("finalize_onboarding");
    expect(names("admin")).not.toContain("set_onboarding_field");
    expect(names("any")).not.toContain("set_onboarding_field");
  });

  it("keeps every retained read-only data tool discoverable in a bounded workflow", () => {
    const names = new Set(
      VOICE_WORKFLOWS.flatMap((workflow) =>
        toolsForRealtime({ role: "admin", workflow }).map((tool) => tool.name),
      ),
    );
    for (const name of DATA_TOOL_NAMES)
      expect(names.has(name), name).toBe(true);
    for (const workflow of VOICE_WORKFLOWS) {
      const tools = toolsForRealtime({ role: "admin", workflow });
      expect(tools.length).toBeLessThanOrEqual(35);
      expect(tools.some((tool) => tool.name === "select_tool_pack")).toBe(true);
    }
  });
  it("keeps office workflow selection read-only and rechecks role gates", () => {
    for (const workflow of ["finance", "reports", "catalog"] as const) {
      expect(
        toolsForRealtime({ role: "vendor", workflow }).every(
          (tool) => !tool.mutating,
        ),
      ).toBe(true);
    }
    expect(
      toolsForRealtime({ role: "field_employee", workflow: "finance" }).map(
        (tool) => tool.name,
      ),
    ).not.toContain("query_invoices");
    expect(
      toolsForRealtime({ role: "vendor", path: "/reports" }).map(
        (tool) => tool.name,
      ),
    ).toContain("query_1099_k_summary");
  });
  it("sends a compact core plus role plus screen pack instead of the full catalog", () => {
    const gate = toolsForRealtime({
      role: "vendor",
      path: "/gatekeeper",
      entityId: 12,
    });
    const names = gate.map((tool) => tool.name);
    expect(names).toContain("query_attention_briefing");
    expect(names).toContain("prepare_visitor_check_in");
    expect(names).toContain("search_gate_history");
    expect(names).toContain("resolve_gate_check_in");
    expect(names).toContain("confirm_visitor_check_in");
    expect(names).toContain("confirm_visitor_check_out");
    expect(names).toContain("open_screen");
    expect(names).not.toContain("query_1099_k_summary");
    expect(names).not.toContain("lookup_accounting_connection");
    expect(new Set(names).size).toBe(names.length);
  });

  it("adds field ticket mutators on ticket screens", () => {
    const names = toolsForRealtime({
      role: "field_employee",
      path: "/tickets/10959",
      entityId: 10959,
    }).map((tool) => tool.name);
    expect(names).toContain("set_ticket_lifecycle");
    expect(names).toContain("close_ticket_for_review");
    expect(names).toContain("post_ticket_comment");
    expect(names).toContain("start_ticket_entry");
    expect(names).not.toContain("confirm_visitor_check_in");
  });

  it("does not hide authorization — denied tools still fail at execution", () => {
    const names = toolsForRealtime({
      role: "field_employee",
      path: "/gatekeeper",
    }).map((tool) => tool.name);
    expect(names).not.toContain("query_invoices");
  });

  it("keeps each page-aware Work Hub voice pack bounded", () => {
    for (const path of [
      "/work-hub/activity",
      "/work-hub/chat",
      "/work-hub/channels",
      "/work-hub/crews",
      "/work-hub/calendar",
      "/work-hub/calls",
      "/work-hub/files",
      "/work-hub/tasks",
      "/work-hub/meetings",
      "/work-hub/billing",
      "/work-hub/administration",
    ]) {
      const tools = toolsForRealtime({
        role: "vendor",
        membershipRole: "admin",
        path,
      });
      expect(tools.length, path).toBeLessThanOrEqual(35);
      expect(tools.map((tool) => tool.name), path).toContain("select_tool_pack");
    }
  });
  it("routes conversation away rules and crew administration without removing either from Ask V", () => {
    const names=(path:string)=>toolsForRealtime({role:"vendor",membershipRole:"admin",path}).map(tool=>tool.name);
    const chat=names("/work-hub/chat?channel=exact"),crews=names("/work-hub/crews"),command=names("/work-hub/askv");
    for(const path of ["/work-hub/askv?run=exact","/work-hub/askv#run","/native/work-hub/askv?run=exact"])expect(names(path)).toEqual(command);
    for(const name of ["query_work_hub_away_responder","query_work_hub_away_channels","manage_work_hub_away_responder"]){expect(chat).toContain(name);expect(crews).not.toContain(name);expect(command).toContain(name);}
    for(const name of ["get_work_hub_crew_members","manage_work_hub_crew","manage_work_hub_crew_member"]){expect(chat).not.toContain(name);expect(crews).toContain(name);expect(command).toContain(name);}
    for(const name of ["list_work_hub_channels","list_work_hub_channel_members","send_work_hub_message"]){expect(chat).toContain(name);}
  });
});
