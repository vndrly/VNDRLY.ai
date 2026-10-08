import { describe, expect, it, vi } from "vitest";
import { chatGptActionTools, chatGptReadableTools, requireChatGptReadableTool, chatGptReadToolOutput, chatGptReadToolDescription, chatGptReadToolAnnotations } from "./chatgpt-tool-access";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { findAskVTool } from "./tool-registry";

describe("ChatGPT assistant tool access", () => {
  it("offers exact-asset transfer choices under the existing read scope without inferring custody authority", () => {
    const keeper = { userId: 11, role: "field_employee", vendorId: 7, vendorRole: "gatekeeper" };
    expect(requireChatGptReadableTool(keeper, ["operations:read"], "query_asset_transfer_recipients").name).toBe("query_asset_transfer_recipients");
    expect(() => requireChatGptReadableTool(keeper, [], "query_asset_transfer_recipients")).toThrow();
    expect(requireChatGptReadableTool({ ...keeper, vendorRole: "field" }, ["operations:read"], "query_asset_transfer_recipients").description).toContain("canonical endpoint");
    expect(findAskVTool("query_asset_transfer_recipients")?.mutating).toBe(false);
  });
  it("discovers ticket scheduling for assigned or acting foremen without granting ordinary workers scheduler authority", async () => {
    const worker = { userId: 9, role: "field_employee", vendorId: 12, vendorRole: "field" };
    expect(chatGptActionTools(worker, ["tickets:write"]).some(tool => tool.name === "schedule_ticket_crew")).toBe(true);
    expect(chatGptActionTools(worker, ["tickets:read"]).some(tool => tool.name === "schedule_ticket_crew")).toBe(false);
    expect(() => requireChatGptReadableTool(worker, ["workforce:read"], "query_ticket_assignment_candidates")).toThrow();
    const { db, ticketsTable } = await import("@workspace/db");
    const { resolveSchedulerAuth } = await import("../routes/ticketSchedule");
    const originalSelect = db.select.bind(db);
    const select = vi.spyOn(db, "select");
    try {
      for (const ticket of [
        { foremanUserId: 9, actingForemanUserId: null },
        { foremanUserId: 14, actingForemanUserId: 9 },
        { foremanUserId: 14, actingForemanUserId: 15 },
      ]) {
        const builder = originalSelect({ foremanUserId: ticketsTable.foremanUserId, actingForemanUserId: ticketsTable.actingForemanUserId });
        const query = builder.from(ticketsTable);
        vi.spyOn(query, "execute").mockResolvedValue([ticket]);
        vi.spyOn(builder, "from").mockReturnValue(query);
        select.mockReturnValue(builder);
        expect(await resolveSchedulerAuth({ ...worker, partnerId: null }, 77, 12)).toBe(ticket.foremanUserId === 9 || ticket.actingForemanUserId === 9);
      }
      expect(select).toHaveBeenCalledTimes(3);
    } finally { select.mockRestore(); }
  });
  it("requires workforce consent and foreman scope for field-worker roster discovery", () => {
    const name = "query_ticket_assignment_candidates";
    const foreman = { userId: 9, role: "field_employee", vendorId: 12, vendorRole: "foreman" };
    expect(requireChatGptReadableTool(foreman, ["workforce:read"], name).name).toBe(name);
    expect(() => requireChatGptReadableTool(foreman, ["crew:read"], name)).toThrow();
    expect(() => requireChatGptReadableTool({ ...foreman, vendorRole: "field" }, ["workforce:read"], name)).toThrow();
    expect(() => requireChatGptReadableTool({ userId: 9, role: "partner", partnerId: 12 }, ["workforce:read"], name)).toThrow();
  });
  it("limits operations displays to an administrator's active company", () => {
    const tool = "query_operations_displays";
    expect(() => requireChatGptReadableTool({ userId: 1, role: "vendor", vendorId: 7, membershipRole: "admin" }, ["operations:read"], tool)).not.toThrow();
    for (const identity of [{ userId: 1, role: "vendor", vendorId: 7, membershipRole: "member" }, { userId: 1, role: "admin" }, { userId: 1, role: "field_employee", vendorId: 7 }])
      expect(() => requireChatGptReadableTool(identity, ["operations:read"], tool)).toThrow();
    expect(chatGptReadToolDescription(requireChatGptReadableTool({ userId: 1, role: "vendor", vendorId: 7, membershipRole: "admin" }, ["operations:read"], "prepare_operations_displays_action"))).toContain("No bound action");
  });
  it("discloses external market-data reads without marking them destructive", () => {
    for (const name of ["get_stock_quote", "get_crude_oil_price", "query_crew_eta", "query_ticket_route_eta", "estimate_driving_route", "query_ticket_mileage_audit"]) {
      expect(chatGptReadToolAnnotations(name)).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
    expect(chatGptReadToolAnnotations("query_asset_custody").openWorldHint).toBe(false);
  });
  const session = { userId: 17, role: "vendor", membershipRole: "member", vendorId: 4 };
  it("rejects anonymous and unsupported identities", () => {
    expect(chatGptReadableTools({}, ["gate:read", "work_hub:read"])).toEqual([]);
    expect(chatGptReadableTools({ userId: 17, role: "guest" }, ["gate:read"])).toEqual([]);
  });
  it("requires an explicit recognized scope", () => {
    expect(chatGptReadableTools(session, [])).toEqual([]);
    expect(chatGptReadableTools(session, ["*"])).toEqual([]);
  });
  it("requires separate invitation consent and a vendor administrator", () => {
    const admin = { ...session, membershipRole: "admin" };
    expect(() => requireChatGptReadableTool(admin, ["operations:read"], "query_account_invitations")).toThrow();
    expect(requireChatGptReadableTool(admin, ["invitations:read"], "query_account_invitations").name).toBe("query_account_invitations");
    expect(() => requireChatGptReadableTool(session, ["invitations:read"], "query_account_invitations")).toThrow();
    expect(() => requireChatGptReadableTool({ userId: 17, role: "partner", partnerId: 4, membershipRole: "admin" }, ["invitations:read"], "query_account_invitations")).toThrow();
    expect(() => requireChatGptReadableTool(admin, ["operations:read"], "query_workforce_coverage")).toThrow();
    expect(chatGptReadToolDescription(requireChatGptReadableTool(admin, ["invitations:read"], "prepare_account_invitations_action"))).toContain("No bound action");
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
  it("exposes channel participants only under the connected Work Hub read grant", () => {
    const name = "list_work_hub_channel_members";
    expect(requireChatGptReadableTool(session, ["work_hub:read"], name)).toMatchObject({ name, mutating: false });
    for (const scopes of [[], ["gate:read"], ["work_hub:write"]])
      expect(() => requireChatGptReadableTool(session, scopes, name)).toThrow();
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
    expect(projected).toMatchObject({ draft: raw.draft, missing: [], deviceRequiredFields: ["latitude", "longitude"], execution: "draft_only", submitted: false, formPopulated: false });
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
  it("maps only explicit known server reads including the repaired scoped worker lookup", () => {
    for (const capability of Object.values(CHATGPT_READ_CAPABILITIES)) for (const name of capability.tools) {
      const tool = findAskVTool(name);
      expect(tool, name).not.toBeNull();
      expect(tool, name).toMatchObject({ mutating: false, confirmation: "none", execution: "server" });
    }
    const all = chatGptReadableTools({ userId: 1, role: "admin", membershipRole: "admin" }, Object.keys(CHATGPT_READ_CAPABILITIES));
    expect(all.some(tool => tool.name === "lookup_open_tickets")).toBe(true);
    expect(all.some(tool => tool.name === "launch_camera")).toBe(false);
    expect(all.some(tool => tool.name === "set_ticket_lifecycle")).toBe(false);
  });
  it("projects onboarding progress without arbitrary private setup payload", () => {
    const result = chatGptReadToolOutput("lookup_user_progress", { progress: { orgType: "vendor", currentStep: "profile", completedSteps: [], payload: { federalTaxId: "synthetic-sensitive", accountSecret: "synthetic-secret" } } });
    expect(result).toEqual({ progress: { orgType: "vendor", currentStep: "profile", completedSteps: [] } });
    expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
  });
  it('exposes dictated safety drafts only with safety consent and removes client claims',()=>{
    expect(()=>requireChatGptReadableTool(session,['operations:read'],'draft_safety_report')).toThrow();
    const tool=requireChatGptReadableTool(session,['safety:read'],'draft_safety_report');
    expect(tool).toMatchObject({mutating:false,confirmation:'none',execution:'server'});
    const raw={ok:true,submitted:false,draft:{title:'Loose railing',siteLocationId:390},execution:'client',intent:{name:'prefill_draft'}};
    expect(chatGptReadToolOutput(tool.name,raw)).toMatchObject({draft:raw.draft,submitted:false,formPopulated:false,execution:'draft_only',siteAccessVerified:false});
    expect(chatGptReadToolOutput(tool.name,raw)).not.toHaveProperty('intent');
    expect(chatGptReadToolDescription(tool)).toContain('No safety record');
  });
});

it("separates approval-device GPS from missing visitor fields without minting an action or trusting model coordinates", () => {
  const draft = {
    firstName: "Synthetic",
    lastName: "Visitor",
    siteLocationId: 392,
    hostType: "vendor",
    hostVendorId: 1107,
    vehiclePlate: "SYNTHETIC",
    plateState: "OK",
    latitude: 35,
    longitude: -97,
    confirmed: true,
  };
  const ready = chatGptReadToolOutput("prepare_visitor_check_in", {
    ok: false,
    draft,
    missing: ["latitude", "longitude"],
    recovery: { promptField: "latitude" },
  }) as Record<string, unknown>;
  expect(ready).toMatchObject({
    ok: true,
    visitorDraftComplete: true,
    missing: [],
    deviceRequiredFields: ["latitude", "longitude"],
    submitted: false,
    formPopulated: false,
    siteAccessVerified: false,
    continuation: {
      toolName: "confirm_visitor_check_in",
      requiredScope: "gate:write",
      preparationRequired: true,
      deviceLocationRequired: true,
    },
  });
  expect(ready.draft).not.toHaveProperty("latitude");
  expect(ready.draft).not.toHaveProperty("longitude");
  expect(ready.draft).not.toHaveProperty("confirmed");
  expect(ready).not.toHaveProperty("recovery");
  const incomplete = chatGptReadToolOutput("prepare_visitor_check_in", {
    draft,
    missing: ["vehiclePlate", "latitude", "longitude"],
  }) as Record<string, unknown>;
  expect(incomplete).toMatchObject({
    ok: false,
    missing: ["vehiclePlate"],
    visitorDraftComplete: false,
  });
  expect(incomplete).not.toHaveProperty("continuation");
});

it("offers requester continuations only with write consent and keeps platform mediation separate",()=>{
 const actions=(session:Record<string,unknown>,scopes:string[])=>{
  const tool=chatGptActionTools(session,scopes).find(t=>t.name==="confirm_asset_custody_action");
  return (tool?.inputSchema as {properties:{action:{enum:string[]}}}|undefined)?.properties.action.enum??[];
 };
 const requester={userId:1,role:"vendor",vendorId:7,membershipRole:"admin"};
 expect(actions(requester,["assets:write"])).toEqual(expect.arrayContaining(["respond_identifier_claim","withdraw_identifier_claim"]));
 expect(actions(requester,["assets:read"])).toEqual([]);
 expect(actions({userId:1,role:"admin"},["assets:write"])).not.toContain("respond_identifier_claim");
 expect(actions(requester,["assets:write"])).not.toContain("resolve_identifier_claim");
});

import { plannedReadOperationTools } from './plan-operation-tools';
it('describes context preparation reads without bound actions',()=>{const session={userId:17,role:'vendor',vendorId:4,membershipRole:'admin'};for(const [scope,name,word] of [['crew:read','prepare_field_trips_action','recorded field trips'],['operations:read','prepare_operations_displays_action','saved routing']]){const t=requireChatGptReadableTool(session,[scope],name);expect(chatGptReadToolDescription(t)).toContain(word);expect(chatGptReadToolDescription(t)).toContain('No bound action');expect(plannedReadOperationTools([t])[0].description).toContain(word);}});
