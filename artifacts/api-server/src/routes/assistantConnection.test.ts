import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createHmac } from "node:crypto";
import { ASSISTANT_RESOURCE, CHATGPT_CLIENT_ID, assistantPkceChallenge, type AssistantOAuthGrant } from "../assistant/chatgpt-oauth";

const mocks = vi.hoisted(() => ({ validate: vi.fn(), store: vi.fn(), run: vi.fn(), taskRead: vi.fn(), audit: vi.fn(), bound: vi.fn(), pending: vi.fn(), durableResult: vi.fn() }));
vi.mock("../assistant/natural-voice-write-tools", async importOriginal => ({ ...await importOriginal<typeof import('../assistant/natural-voice-write-tools')>(), callNaturalVoiceDomainApi: (...args: unknown[]) => mocks.taskRead(...args) }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mocks.validate, withAssistantGrants: mocks.store }));
vi.mock("./assistant", () => ({ runTool: mocks.run }));
vi.mock("../assistant/action-audit", () => ({ writeAskVActionAudit: mocks.audit }));
vi.mock("../lib/rate-limit-factory", () => ({ createRateLimiter: () => ({ enforce: async () => true }) }));
vi.mock("../assistant/askv-pending-confirmation", () => ({ organizationKeyFromSession: (session: Record<string, unknown>) => JSON.stringify([session.role, session.vendorId, session.partnerId, session.activeMembershipId]), askvPendingConfirmations: { set: mocks.pending }, runBoundTypedAskVTool: mocks.bound }));
vi.mock("../assistant/askv-idempotency", async (importOriginal) => ({ ...await importOriginal<typeof import("../assistant/askv-idempotency")>(), readPersistentAskVMutationResult: mocks.durableResult }));
import router from "./assistantConnection";
import { resolveExecutableWorkHubToolRequest } from "../assistant/work-hub-tool-runtime";

const app = express();
app.use(cookieParser(), express.json(), express.urlencoded({ extended: false }));
app.use("/api/assistant-connection", router);
const base = "/api/assistant-connection";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "q".repeat(43);
const auth = { client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect, response_type: "code", resource: ASSISTANT_RESOURCE, code_challenge_method: "S256", code_challenge: assistantPkceChallenge(verifier), scope: "gate:read work_hub:read", state: "opaque-state" };
const session = { userId: 17, role: "vendor", membershipRole: "member", vendorId: 4, sv: 1, exp: Math.floor(Date.now() / 1000) + 600 };
function cookie(actor = session) {
  const body = Buffer.from(JSON.stringify(actor)).toString("base64");
  return `vndrly_session=${body}.${createHmac("sha256", "test-secret").update(body).digest("hex")}`;
}
let grants: AssistantOAuthGrant[];
beforeEach(() => {
  process.env.ASSISTANT_CONNECTION_ENABLED = "1";
  grants = [];
  mocks.validate.mockReset().mockImplementation(async (value) => ({ ...value, exp: Math.floor(Date.now() / 1000) + 60 }));
  mocks.store.mockReset().mockImplementation(async (_id, operation) => operation(grants));
  mocks.run.mockReset().mockResolvedValue(JSON.stringify({ sites: [{ id: 3 }] }));
  mocks.taskRead.mockReset().mockImplementation(async (path, _method, _input, actor) => {
    // Existing fixtures supply task records through this common mock; production uses the exact canonical endpoint.
    const raw = JSON.parse(await mocks.run('list_work_hub_tasks', {}, actor, ''));
    const rows = Array.isArray(raw) ? raw : raw.tasks ?? raw.items ?? [];
    const row = rows.find((item: { id: string }) => path.endsWith('/' + item.id));
    return row ? { ...row, subjectType: 'task' } : { ok: false, status: 404 };
  });
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.pending.mockReset();
  mocks.bound.mockReset().mockImplementation(async (args) => args.execute({ ...args.input, confirmed: true, idempotencyKey: "server-approved-test-key" }));
  mocks.durableResult.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ client_id: CHATGPT_CLIENT_ID, redirect_uris: [redirect], token_endpoint_auth_methods_supported: ["none"] }) }));
});
afterEach(() => { delete process.env.ASSISTANT_CONNECTION_ENABLED; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('uses the actual saved WorkHub creation receipt and refuses changed resource revision at checkpoint approval', async () => {
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111', savedId='33333333-3333-4333-8333-333333333333';
 const credentials=await tokens('work_hub:read work_hub:write');
 const call=(name:string,args:unknown)=>request(app).post(base+'/mcp').set('Authorization','Bearer '+credentials.access_token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
 const resource={id:savedId,title:'Follow up',ownerOrgType:'vendor',ownerOrgId:4,version:1,status:'open',assigneeUserId:null};
 mocks.run.mockImplementation(async (_name,input)=>JSON.stringify({operationId:input.operationId,appliedAt:new Date().toISOString(),replayed:false,resource}));
 const prepared=(await call('manage_work_hub_task',{action:'create',owner:{type:'vendor',id:4},context:{kind:'organization',id:4},expectedVersion:null,payload:{title:'Follow up'}})).body.result;
 expect((await call('v_submit_panel_action',prepared._meta.componentApproval)).body.result.structuredContent.ok).toBe(true);
 const reference=prepared._meta.componentApproval.reference;
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'create',specialist:'V',toolNames:['manage_work_hub_task'],dependsOn:[],completion:{kind:'canonical_work_hub_task_action_saved',action:'create',title:'Follow up'}}]);
 const row={id:taskId,subjectType:'task',ownerOrgType:'vendor',ownerOrgId:4,version:3,status:'open',description:encodePlanDescription(plan)};
 mocks.taskRead.mockImplementation(async path=>path.endsWith('/'+taskId)?row:{...resource,subjectType:'task'});
 const checkpoint=(await call('v_prepare_work_plan_completion',{taskId,expectedTaskVersion:3,stepId:'create',actionReference:reference})).body.result;
 expect(checkpoint.isError).toBe(false); expect(mocks.bound).toHaveBeenCalledOnce();
 resource.version=2;
 expect((await call('v_submit_panel_action',checkpoint._meta.componentApproval)).body.result.isError).toBe(true);
 expect(mocks.bound).toHaveBeenCalledOnce();
});
it('reads an authorized plan beyond the first100 and refuses foreign detail or missing task scope', async () => {
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing'],dependsOn:[]}]);
 const row={id:taskId,subjectType:'task',ownerOrgType:'vendor',ownerOrgId:4,version:7,status:'open',description:encodePlanDescription(plan)};
 const credentials=await tokens('work_hub:read');
 const call=(token=credentials.access_token)=>request(app).post(base+'/mcp').set('Authorization','Bearer '+token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'v_resume_work_plan',arguments:{taskId}}});
 mocks.run.mockResolvedValue(JSON.stringify(Array.from({length:100},(_,id)=>({id:'different-task-'+id}))));
 mocks.taskRead.mockResolvedValue(row);
 expect(JSON.parse((await call()).body.result.content[0].text)).toMatchObject({taskId,taskVersion:7,eligibleStepIds:['brief']});
 expect(mocks.run).not.toHaveBeenCalled();
 expect(mocks.taskRead).toHaveBeenCalledWith(`/work-hub/search/items/task/${taskId}`,'GET',{},expect.objectContaining({userId:17,vendorId:4}));
 mocks.taskRead.mockResolvedValue({...row,ownerOrgId:5});
 expect((await call()).body.result.isError).toBe(true);
 const limited=await tokens('tickets:read'); mocks.taskRead.mockClear();
 expect((await call(limited.access_token)).body.result.isError).toBe(true);
 expect(mocks.taskRead).not.toHaveBeenCalled();
});
it.each([false, true])('rechecks observed plan completion at approval (changed task: %s)', async changed => {
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing'],dependsOn:[],completion:{kind:'planned_read_observed'}}]);
 const row={id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:1,status:'open',description:encodePlanDescription(plan)};
 const credentials=await tokens('work_hub:read work_hub:write');
 const call=(name:string,args:unknown)=>request(app).post(base+'/mcp').set('Authorization','Bearer '+credentials.access_token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
 mocks.run.mockImplementation(async name => JSON.stringify(name==='list_work_hub_tasks'?[row]:{tasks:[],events:[]}));
 const receipt=(await call('v_run_work_plan_read',{taskId,stepId:'brief',toolArguments:{get_work_hub_briefing:{}}})).body.result.structuredContent.checkpointReceipt;
 const prepared=(await call('v_prepare_work_plan_completion',{taskId,expectedTaskVersion:1,stepId:'brief',receipt})).body.result;
 expect(prepared.isError).toBe(false);
 expect(grants[0].actions![0].state).toBe('pending');
 expect(mocks.bound).not.toHaveBeenCalled();
 if(changed) row.version=2;
 const response=(await call('v_submit_panel_action',prepared._meta.componentApproval)).body.result;
 if(changed) { expect(response.isError).toBe(true); expect(mocks.bound).not.toHaveBeenCalled(); }
 else { expect(response.structuredContent.status).toBe('completed'); expect(mocks.bound).toHaveBeenCalledOnce(); }
});
async function consent(scope = auth.scope) {
  const response = await request(app).get(`${base}/authorize`).query({ ...auth, scope }).set("Cookie", cookie());
  expect(response.status).toBe(200);
  expect(response.headers["content-security-policy"]).toContain("form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect");
  const consentValue = /name="consent" value="([^"]+)"/.exec(response.text)![1];
  const nonceCookie = response.headers["set-cookie"][0].split(";")[0];
  return { consentValue, selectedScopes: scope.split(" "), cookies: `${cookie()}; ${nonceCookie}` };
}
async function tokens(scope = auth.scope) {
  const form = await consent(scope);
  const authorized = await request(app).post(`${base}/authorize`).set("Origin", "https://vndrly.ai").set("Cookie", form.cookies).type("form").send({ consent: form.consentValue, selected_scope: form.selectedScopes });
  expect(authorized.status).toBe(303);
  const callback = new URL(authorized.headers.location);
  expect(callback.searchParams.get("state")).toBe(auth.state);
  expect(callback.searchParams.get("iss")).toBe("https://vndrly.ai/api/assistant-connection");
  const response = await request(app).post(`${base}/token`).type("form").send({ grant_type: "authorization_code", client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect, resource: ASSISTANT_RESOURCE, code: callback.searchParams.get("code"), code_verifier: verifier });
  expect(response.status).toBe(200);
  return response.body;
}
describe("ChatGPT account connection boundary", () => {
  it.each([
    { name: "reschedule_work_hub_meeting", input: { occurrenceId: "11111111-1111-4111-8111-111111111111", expectedFingerprint: "a".repeat(64), startsAt: "2026-10-08T14:00:00.000Z", endsAt: "2026-10-08T15:00:00.000Z", timezone: "America/Chicago" } },
    { name: "prepare_ticket_invoices", input: { basis: "recorded_invoice_activity", tickets: [{ ticketId: 21, expectedUpdatedAt: "2026-10-07T10:00:00.000Z" }] } },
  ])("submits approved $name with only the trusted operation ID and does not repeat it", async ({ name, input }) => {
    const credentials = await tokens("work_hub:read work_hub:write finance:read finance:write");
    const actor = { ...session, activeMembershipId: 8, membershipRole: "admin" };
    grants[0].session = { ...grants[0].session, ...actor };
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_prepare_action", arguments: { toolName: name, arguments: { ...input, operationId: "99999999-9999-4999-8999-999999999999", confirmed: true } } } });
    expect(response.body.result.isError).toBe(false);
    const prepared = response.body.result.structuredContent;
    expect(grants[0].actions![0].arguments).not.toHaveProperty("operationId");
    expect(mocks.run).not.toHaveBeenCalled();
    const path = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(path).set("Cookie", cookie(actor));
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const proof = approval.headers["set-cookie"][0].split(";")[0];
    mocks.run.mockResolvedValue(JSON.stringify({ ok: true, saved: name }));
    const submit = () => request(app).post(path).set("Cookie", `${cookie(actor)}; ${proof}`).set("Origin", "https://vndrly.ai").type("form").send({ nonce });
    expect((await submit()).status).toBe(200);
    expect((await submit()).status).toBe(200);
    expect(mocks.bound).toHaveBeenCalledOnce();
    expect(mocks.bound.mock.calls[0][0].input.operationId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(mocks.bound.mock.calls[0][0].input.operationId).not.toBe("99999999-9999-4999-8999-999999999999");
  });
  it("advertises calendar snapshot reads and approved rescheduling with their separate current permissions", async () => {
    const credentials = await tokens("work_hub:read work_hub:write");
    grants[0].session = { ...grants[0].session, activeMembershipId: 8, membershipRole: "admin" };
    const invoke = () => request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (await invoke()).body.result.tools;
    expect(tools.find((tool: { name: string }) => tool.name === "query_calendar_reschedule_snapshot")).toMatchObject({ outputSchema: { additionalProperties: false }, securitySchemes: [{ type: "oauth2", scopes: ["work_hub:read"] }] });
    const write = tools.find((tool: { name: string }) => tool.name === "reschedule_work_hub_meeting");
    expect(write.securitySchemes).toEqual([{ type: "oauth2", scopes: ["work_hub:write"] }]);
    expect(write._meta.securitySchemes).toEqual(write.securitySchemes);
    grants[0].scopes = ["work_hub:read"];
    expect((await invoke()).body.result.tools.some((tool: { name: string }) => tool.name === write.name)).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("advertises both required finance permissions for invoice preparation without changing other finance metadata", async () => {
    const credentials = await tokens("work_hub:read work_hub:write finance:read finance:write");
    grants[0].session = { ...grants[0].session, activeMembershipId: 8, membershipRole: "admin" };
    const tools = (await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/list" })).body.result.tools;
    const preparation = tools.find((tool: { name: string }) => tool.name === "prepare_ticket_invoices");
    const expected = [{ type: "oauth2", scopes: ["finance:read", "finance:write"] }];
    expect(preparation.securitySchemes).toEqual(expected);
    expect(preparation._meta.securitySchemes).toEqual(expected);
  });
  it("reads exact invoice candidates through the canonical endpoint and refuses consent removal before another lookup", async () => {
    const credentials = await tokens("work_hub:read finance:read");
    grants[0].session = { ...grants[0].session, activeMembershipId: 8, membershipRole: "admin" };
    const output = { company: { type: "vendor", id: 4 }, observedAt: new Date().toISOString(), source: "canonical_approved_uninvoiced_tickets", tickets: [{ ticketId: 21, siteLocationId: 3, status: "approved", expectedUpdatedAt: new Date().toISOString() }], page: { limit: 1, nextAfterTicketId: null, truncated: false }, automaticApprovalCreated: false, invoicesPrepared: false };
    mocks.taskRead.mockResolvedValue(output);
    const invoke = (method: string, params?: unknown) => request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method, params });
    const descriptor = (await invoke("tools/list")).body.result.tools.find((tool: { name: string }) => tool.name === "query_ticket_invoice_candidates");
    expect(descriptor).toMatchObject({ annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["finance:read"] }], outputSchema: { additionalProperties: false } });
    expect((await invoke("tools/call", { name: descriptor.name, arguments: { limit: 1, afterTicketId: 20 } })).body.result.structuredContent).toEqual(output);
    expect(mocks.taskRead).toHaveBeenCalledWith("/invoices/ticket-preparation/candidates?limit=1&afterTicketId=20", "GET", {}, expect.objectContaining({ userId: 17, vendorId: 4 }));
    grants[0].scopes = grants[0].scopes.filter(scope => scope !== "finance:read");
    expect((await invoke("tools/list")).body.result.tools.some((tool: { name: string }) => tool.name === descriptor.name)).toBe(false);
    expect((await invoke("tools/call", { name: descriptor.name, arguments: {} })).body.result.isError).toBe(true);
    expect(mocks.taskRead).toHaveBeenCalledOnce();
    expect(mocks.pending).not.toHaveBeenCalled();
  });
  it("prepares a saved invoice-activity plan through the supported tool and refuses it after finance consent removal", async () => {
    const credentials = await tokens("work_hub:read work_hub:write finance:read");
    grants[0].session = { ...grants[0].session, activeMembershipId: 8, membershipRole: "admin" };
    const input = { planId: "11111111-1111-4111-8111-111111111111", title: "Synthetic invoice history", steps: [{ id: "invoice", specialist: "Finn", toolNames: ["query_invoice_activity"], dependsOn: [] }] };
    const call = () => request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_prepare_work_plan", arguments: input } });
    const prepared = (await call()).body.result;
    expect(prepared.isError).not.toBe(true);
    expect(prepared.structuredContent).toMatchObject({ status: "pending", requiresConfirmation: true });
    expect(grants[0].actions?.[0].toolName).toBe("manage_work_hub_task");
    expect(mocks.run).not.toHaveBeenCalled();
    grants[0].scopes = grants[0].scopes.filter(scope => scope !== "finance:read");
    expect((await call()).body.result.isError).toBe(true);
    expect(grants[0].actions).toHaveLength(1);
  });
  it("discovers invoice activity only for a current company finance grant and refuses a direct ungranted call", async () => {
    const credentials = await tokens("gate:read work_hub:read finance:read");
    grants[0].session = { ...grants[0].session, activeMembershipId: 8, membershipRole: "admin" };
    const invoke = (method: string, params?: unknown) => request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method, params });
    const listed = (await invoke("tools/list")).body.result.tools;
    expect(listed.find((tool: { name: string }) => tool.name === "query_invoice_activity")).toMatchObject({ annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["finance:read"] }] });
    grants[0].scopes = grants[0].scopes.filter(scope => scope !== "finance:read");
    expect((await invoke("tools/list")).body.result.tools.some((tool: { name: string }) => tool.name === "query_invoice_activity")).toBe(false);
    const rejected = (await invoke("tools/call", { name: "query_invoice_activity", arguments: {} })).body.result;
    expect(rejected.isError).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("challenges missing Fleet consent for the authorized Partner workspace source before reading records", async () => {
    const credentials = await tokens("gate:read work_hub:read");
    grants[0].session = { ...grants[0].session, role: "partner", vendorId: null, partnerId: 609, membershipRole: "admin" };
    mocks.run.mockImplementation(async (name, input) => {
      if (name === "query_fleet_site_activity" && Object.keys(input).length === 0) return JSON.stringify({ sites: [{siteId:392,name:"Private site name"}] });
      throw new Error("Record read must require consent");
    });
    const invoke = (method: string, params?: unknown) => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({jsonrpc:"2.0",id:1,method,params});
    const listed = (await invoke("tools/list")).body.result;
    expect(listed.tools.find((tool: {name:string}) => tool.name === "query_fleet_site_activity").securitySchemes).toEqual([{type:"oauth2",scopes:["fleet:read"]}]);
    mocks.run.mockClear();
    const result = (await invoke("tools/call", {name:"v_show_workspace",arguments:{view:"fleet_site",siteId:392}})).body.result;
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain('error="insufficient_scope"');
    expect(result._meta["mcp/www_authenticate"][0]).toContain('scope="gate:read work_hub:read fleet:read"');
    expect(JSON.stringify(result)).not.toContain("Private site name");
    expect(result.structuredContent).toBeUndefined();
    expect(mocks.run.mock.calls).toEqual([["query_fleet_site_activity",{},expect.any(Object),""]]);
    expect(grants[0].scopes).toEqual(["gate:read","work_hub:read"]);
    expect(grants[0].actions ?? []).toEqual([]);
    expect(mocks.bound).not.toHaveBeenCalled();
    mocks.run.mockResolvedValue(JSON.stringify({sites:[]}));
    const denied = (await invoke("tools/call",{name:"v_show_workspace",arguments:{view:"fleet_site",siteId:392}})).body.result;
    expect(denied.isError).toBe(true);
    expect(denied._meta?.["mcp/www_authenticate"]).toBeUndefined();
    grants[0].scopes.push("fleet:read");
    mocks.run.mockClear();
    mocks.run.mockResolvedValue(JSON.stringify({sites:[{siteId:392,name:"Consented site"}]}));
    const consented = (await invoke("tools/call",{name:"v_show_workspace",arguments:{view:"fleet_site"}})).body.result;
    expect(consented.isError).toBe(false);
    expect(consented._meta?.["mcp/www_authenticate"]).toBeUndefined();
    expect(consented.structuredContent).toMatchObject({view:"fleet_site",sourceTool:"query_fleet_site_activity"});
  });
  it("labels cancellation tools as potentially destructive without widening their input operation", async () => {
    const credentials = await tokens("gate:write fleet:dispatch");
    const descriptors = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({jsonrpc:"2.0",id:1,method:"tools/list"});
    const tools = descriptors.body.result.tools;
    for (const name of ["manage_gate_shift_cancel_handoff","cancel_fleet_cargo_transfer","cancel_fleet_equipment_replacement"]) {
      const tool=tools.find((item:{name:string})=>item.name===name);
      expect(tool.annotations.destructiveHint).toBe(true);
      expect(tool.inputSchema.properties).not.toHaveProperty("action");
    }
  });
  it("issues only selected scopes and refuses scope expansion or empty consent", async () => {
    const form = await consent("gate:read gate:write tickets:read tickets:write finance:write");
    const sendSelection = (selected_scope: unknown) => request(app).post(`${base}/authorize`)
      .set("Origin", "https://vndrly.ai").set("Cookie", form.cookies).type("form")
      .send({ consent: form.consentValue, selected_scope });
    expect((await sendSelection(["gate:read", "operations:write"])).status).toBe(400);
    expect((await sendSelection([])).status).toBe(400);
    expect(grants).toHaveLength(0);
    const response = await sendSelection(["gate:read", "gate:write", "tickets:read", "tickets:write"]);
    expect(response.status).toBe(303);
    expect(grants[0].scopes).toEqual(["gate:read", "gate:write", "tickets:read", "tickets:write"]);
    const callback = new URL(response.headers.location);
    const exchanged = await request(app).post(`${base}/token`).type("form").send({
      grant_type: "authorization_code", client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect,
      resource: ASSISTANT_RESOURCE, code: callback.searchParams.get("code"), code_verifier: verifier,
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.scope).toBe("gate:read gate:write tickets:read tickets:write");
    const tools = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${exchanged.body.access_token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(tools.body.result.tools.some((tool: { name: string }) => tool.name === "record_ticket_payment")).toBe(false);
  });
  it("requests eligible finance consent before either direct or generic preparation", async () => {
    const credentials = await tokens("gate:read gate:write");
    const original = grants[0].session;
    grants[0].session = { ...original, role: "partner", vendorId: null, partnerId: 8, membershipRole: "admin" };
    const invoke = (method: string, params?: unknown) => request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method, params });
    const listed = await invoke("tools/list");
    const tool = listed.body.result.tools.find((t: { name: string }) => t.name === "record_ticket_payment");
    expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["finance:write"] }]);
    const generic = listed.body.result.tools.find((t: { name: string }) => t.name === "v_prepare_action");
    expect(generic.inputSchema.properties.toolName.enum).toContain("record_ticket_payment");
    expect(generic.securitySchemes).toEqual([{ type: "oauth2", scopes: ["gate:read", "gate:write"] }]);
    expect(generic._meta.securitySchemes).toEqual(generic.securitySchemes);
    const ordinary = (await invoke("tools/call", { name: "v_prepare_action", arguments: { toolName: "manage_gate_shift", arguments: { action: "prepare_handoff", stationId: "00000000-0000-4000-8000-000000000009" } } })).body.result;
    expect(ordinary._meta?.["mcp/www_authenticate"]).toBeUndefined();
    expect(ordinary.isError).toBe(false);
    grants[0].actions = [];
    // Tool discovery may inspect trusted Partner site choices; payment preparation must not read or execute anything.
    expect(mocks.run.mock.calls.map(([tool])=>tool)).toEqual(["query_fleet_site_activity"]);
    mocks.run.mockClear();

    for (const params of [{ name: "record_ticket_payment", arguments: { ticketId: 1 } }, { name: "v_prepare_action", arguments: { toolName: "record_ticket_payment", arguments: { ticketId: 1 } } }]) {
      const result = (await invoke("tools/call", params)).body.result;
      expect(result.isError).toBe(true);
      expect(result._meta["mcp/www_authenticate"][0]).toContain('error="insufficient_scope"');
      expect(result._meta["mcp/www_authenticate"][0]).toContain('scope="gate:read gate:write finance:write"');
    }
    expect(grants[0].actions ?? []).toEqual([]);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.bound).not.toHaveBeenCalled();
    grants[0].session = { ...original, role: "field_employee" };
    const denied = await invoke("tools/list");
    expect(denied.body.result.tools.some((t: { name: string }) => t.name === "record_ticket_payment")).toBe(false);
    expect(denied.body.result.tools.find((t: { name: string }) => t.name === "v_prepare_action").inputSchema.properties.toolName.enum).not.toContain("record_ticket_payment");
    const deniedCall = (await invoke("tools/call", { name: "record_ticket_payment", arguments: {} })).body.result;
    expect(deniedCall._meta?.["mcp/www_authenticate"]).toBeUndefined();
    grants[0].session = { ...original, role: "partner", vendorId: null, partnerId: 8, membershipRole: "admin" };
    grants[0].scopes.push("finance:write");
    const prepared = (await invoke("tools/call", { name: "record_ticket_payment", arguments: { ticketId: 1, payload: { paymentMethod: "check", paymentReference: "Synthetic check" } } })).body.result;
    expect(prepared.isError).toBe(false);
    expect(JSON.parse(prepared.content[0].text)).toMatchObject({ status: "pending", result: null });
    expect(grants[0].actions).toHaveLength(1);
    expect(mocks.bound).not.toHaveBeenCalled();
  });

  it("reads connection context without unrelated Work Hub permissions or credentials", async () => {
    const credentials = await tokens("gate:read");
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_connection_context", arguments: {} } });
    const context = JSON.parse(response.body.result.content[0].text);
    expect(context).toMatchObject({ userId: 17, vendorId: 4, grantedScopes: ["gate:read"], operationalAccessVerified: false });
    expect(Object.keys(context)).not.toContain("sv");
    expect(Object.keys(context)).not.toContain("exp");
    expect(response.body.result.content[0].text).not.toContain(credentials.access_token);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(["valid", "revoked", "scope removed", "wrong user", "station denied", "wrong station"])("rechecks Gate device navigation when %s", async condition => {
    const credentials = await tokens("gate:read");
    const stationId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
    mocks.run.mockResolvedValue(JSON.stringify({ station: { id: stationId, site_id: 392 } }));
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_open_gate_handoff", arguments: { stationId } } });
    expect(response.body.result.isError).toBe(false);
    const result = JSON.parse(response.body.result.content[0].text);
    expect(result).toMatchObject({ stationId, handoffTransferred: false });
    if (condition === "revoked") grants[0].revoked = true;
    if (condition === "scope removed") grants[0].scopes = [];
    if (condition === "station denied") mocks.run.mockResolvedValue(JSON.stringify({ error: "Denied" }));
    if (condition === "wrong station") mocks.run.mockResolvedValue(JSON.stringify({ station: { id: "another" } }));
    const opened = await request(app).get(new URL(result.deviceUrl).pathname).set("Cookie", cookie(condition === "wrong user" ? { ...session, userId: 18 } : session));
    expect(opened.status).toBe(condition === "valid" ? 302 : 403);
    if (condition === "valid") expect(opened.headers.location).toBe("/gate/change-over?stationId=" + stationId + "&siteId=392");
    expect(mocks.bound).not.toHaveBeenCalled();
  });
  it("does not issue Gate links for inaccessible stations or arbitrary destinations", async () => {
    const credentials = await tokens("gate:read");
    mocks.run.mockResolvedValue(JSON.stringify({ error: "Denied" }));
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_open_gate_handoff", arguments: { stationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05" } } });
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.content[0].text).not.toContain("deviceUrl");
  });
  it.each(["valid", "revoked", "scope removed", "wrong user", "run denied", "wrong run"])("rechecks Fleet run handoff when %s", async condition => {
    const credentials = await tokens("fleet:read");
    const runId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
    mocks.run.mockResolvedValue(JSON.stringify({ id: runId }));
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_open_fleet_run", arguments: { runId } } });
    expect(response.body.result.isError).toBe(false);
    const result = JSON.parse(response.body.result.content[0].text);
    expect(result).toMatchObject({ runId, entrySaved: false, deviceCaptureStarted: false, nativeAppOpened: false });
    if (condition === "revoked") grants[0].revoked = true;
    if (condition === "scope removed") grants[0].scopes = [];
    if (condition === "run denied") mocks.run.mockResolvedValue(JSON.stringify({ error: "Denied" }));
    if (condition === "wrong run") mocks.run.mockResolvedValue(JSON.stringify({ id: "another" }));
    const opened = await request(app).get(new URL(result.deviceUrl).pathname).set("Cookie", cookie(condition === "wrong user" ? { ...session, userId: 18 } : session));
    expect(opened.status).toBe(condition === "valid" ? 302 : 403);
    if (condition === "valid") expect(opened.headers.location).toBe("/fleet/runs/" + runId);
    expect(mocks.bound).not.toHaveBeenCalled();
  });
  it.each(["valid", "revoked", "scope removed", "wrong user", "ticket denied", "wrong ticket"])("rechecks ticket entry handoff when %s", async condition => {
    const credentials = await tokens("tickets:read");
    mocks.run.mockResolvedValue(JSON.stringify({ ticketId: 42, status: "in_progress" }));
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_open_ticket_entry", arguments: { ticketId: 42, entry: "photo" } } });
    expect(response.body.result.isError).toBe(false);
    const result = JSON.parse(response.body.result.content[0].text);
    expect(result).toMatchObject({ entrySaved: false, deviceCaptureStarted: false, ticketId: 42 });
    if (condition === "revoked") grants[0].revoked = true;
    if (condition === "scope removed") grants[0].scopes = [];
    if (condition === "ticket denied") mocks.run.mockResolvedValue(JSON.stringify({ error: "Denied" }));
    if (condition === "wrong ticket") mocks.run.mockResolvedValue(JSON.stringify({ ticketId: 43 }));
    const opened = await request(app).get(new URL(result.deviceUrl).pathname).set("Cookie", cookie(condition === "wrong user" ? { ...session, userId: 18 } : session));
    expect(opened.status).toBe(condition === "valid" ? 302 : 403);
    if (condition === "valid") expect(opened.headers.location).toBe("/tickets/42?askvEntry=photo");
    expect(mocks.bound).not.toHaveBeenCalled();
  });
  it("does not issue ticket entry links for inaccessible or unrelated tickets", async () => {
    const credentials = await tokens("tickets:read");
    for (const output of [{ error: "Denied" }, { ticketId: 43 }, null]) {
      mocks.run.mockResolvedValue(JSON.stringify(output));
      const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_open_ticket_entry", arguments: { ticketId: 42, entry: "photo" } } });
      expect(response.body.result.isError).toBe(true);
      expect(response.body.result.content[0].text).not.toContain("deviceUrl");
    }
  });
  it.each(["valid", "revoked", "scope removed", "wrong user", "meeting denied", "stale browser session"])("checks meeting handoff when %s", async (condition) => {
    const credentials = await tokens("work_hub:read");
    const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
    mocks.run.mockResolvedValue(JSON.stringify({ ok: true, transcript: [] }));
    const response = await request(app).post(base + "/mcp").set("Authorization", "Bearer " + credentials.access_token).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_work_hub_meeting_catchup", arguments: { occurrenceId } } });
    const result = JSON.parse(response.body.result.content[0].text);
    expect(result.deviceCaptureStarted).toBe(false);
    const path = new URL(result.deviceUrl).pathname;
    if (condition === "revoked") grants[0].revoked = true;
    if (condition === "scope removed") grants[0].scopes = [];
    if (condition === "meeting denied") mocks.run.mockResolvedValue(JSON.stringify({ error: "Denied" }));
    if (condition === "stale browser session") mocks.validate.mockRejectedValueOnce(new Error("Session expired"));
    const opened = await request(app).get(path).set("Cookie", cookie(condition === "wrong user" ? { ...session, userId: 18 } : session));
    expect(opened.status).toBe(condition === "valid" ? 302 : 403);
    if (condition === "valid") expect(opened.headers.location).toBe("/work-hub/meetings?meeting=" + occurrenceId);
    else {
      expect(opened.headers.location).toBeUndefined();
      expect(opened.text).toContain('href="/switch-account"');
      expect(opened.text).not.toContain('href="/login"');
      expect(opened.text).toContain("No microphone, camera, or recording was started");
    }
  });

  it.each(["valid", "access expired", "revoked", "scope removed", "wrong user", "tampered", "external destination"])("keeps the file device handoff bound when %s", async (condition) => {
    const credentials = await tokens("operations:read");
    mocks.run.mockResolvedValue(JSON.stringify({ url: "/work-hub/files" }));
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deep_link_to", arguments: { screen: "work-hub-files" } } });
    const result = JSON.parse(response.body.result.content[0].text);
    expect(result.completed).toBe(false);
    const path = new URL(result.url).pathname;
    if (condition === "access expired") { grants[0].accessExpiresAt = Date.now() - 1; grants[0].accessHash = "refreshed-access-hash"; }
    if (condition === "revoked") grants[0].revoked = true;
    if (condition === "scope removed") grants[0].scopes = [];
    if (condition === "external destination") mocks.run.mockResolvedValue(JSON.stringify({ url: "https://example.com" }));
    const opened = await request(app).get(condition === "tampered" ? `${path}changed` : path).set("Cookie", cookie(condition === "wrong user" ? { ...session, userId: 18 } : session));
    if (["valid", "access expired"].includes(condition)) {
      expect(opened.status).toBe(302);
      expect(opened.headers.location).toBe("/work-hub/files");
    } else {
      expect(opened.status).toBe(403);
      expect(opened.headers.location).toBeUndefined();
    }
  });
  it("keeps panel proof component-only and binds submission to the current grant", async () => {
    const credentials = await tokens("tickets:write");
    const call = (name: string, args: Record<string, unknown>, access = credentials.access_token) => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${access}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const prepared = await call("manage_ticket_record", { action: "update", ticketId: 12, payload: { description: "Reviewed repair" } });
    const component = prepared.body.result._meta.componentApproval;
    expect(JSON.stringify(prepared.body.result.content)).not.toContain(component.proof);
    expect(mocks.run).not.toHaveBeenCalled();
    const descriptors = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(descriptors.body.result.tools.find((tool: { name: string }) => tool.name === "v_submit_panel_action")._meta.ui.visibility).toEqual(["app"]);
    for (const name of ["manage_ticket_record_update", "v_prepare_action", "v_submit_panel_action"]) {
      expect(descriptors.body.result.tools.find((tool: { name: string }) => tool.name === name).annotations.destructiveHint).toBe(true);
    }
    const ticketTool = descriptors.body.result.tools.find((tool: { name: string }) => tool.name === "manage_ticket_record_update");
    expect(ticketTool.inputSchema.properties).not.toHaveProperty("action");
    expect(descriptors.body.result.tools.some((tool: { name: string }) => tool.name === "manage_ticket_record")).toBe(false);
    expect(ticketTool._meta.ui.resourceUri).toBe("ui://vndrly/action/v6.html");
    for (const version of [1, 2, 3, 4]) {
      const resource = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: `ui://vndrly/action/v${version}.html` } });
      expect(resource.body.result.contents[0].mimeType).toContain("text/html");
      expect(resource.body.result.contents[0].text).toContain("v_submit_panel_action");
    }
    expect(ticketTool.description).toContain("This call only prepares the change");
    expect(descriptors.body.result.tools.find((tool: { name: string }) => tool.name === "v_action_status").outputSchema.required).toEqual(["state", "toolName", "result"]);
    expect((await call("v_submit_panel_action", { reference: component.reference, proof: "model-confirmed" })).body.result.isError).toBe(true);
    const other = await tokens("tickets:write");
    expect((await call("v_submit_panel_action", component, other.access_token)).body.result.isError).toBe(true);
    mocks.run.mockImplementation(async (name, input, actor, _history, _stream, trusted) => {
      expect(resolveExecutableWorkHubToolRequest(name, input, trusted, actor)).toMatchObject({ method: "PATCH", path: "/tickets/12" });
      return JSON.stringify({ ok: true, id: 12 });
    });
    expect((await call("v_submit_panel_action", component)).body.result.structuredContent).toMatchObject({ status: "completed", ok: true, result: { id: 12 } });
    expect((await call("v_submit_panel_action", component)).body.result.structuredContent.status).toBe("completed");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it.each(["revoked", "scope removed", "expired", "tampered"])("rejects a panel action when authorization is %s", async (condition) => {
    const credentials = await tokens("tickets:write");
    const call = (name: string, args: Record<string, unknown>) => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const prepared = await call("manage_ticket_record", { action: "update", ticketId: 12, payload: { description: "Reviewed repair" } });
    const component = prepared.body.result._meta.componentApproval;
    if (condition === "revoked") grants[0].revoked = true;
    if (condition === "scope removed") grants[0].scopes = [];
    if (condition === "expired") grants[0].actions![0].expiresAt = Date.now() - 1;
    if (condition === "tampered") component.proof += "altered";
    const denied = await call("v_submit_panel_action", component);
    expect(denied.status !== 200 || denied.body.result?.isError === true).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("does not mint a component submission proof for a location-dependent action", async () => {
    const credentials = await tokens("gate:write");
    const prepared = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "confirm_visitor_check_in", arguments: { siteId: 3, firstName: "Fixture", lastName: "Driver" } } });
    expect(prepared.body.result._meta.componentApproval).toMatchObject({ requiresLocation: true });
    expect(prepared.body.result._meta.componentApproval).not.toHaveProperty("proof");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("never uses model-supplied ticket coordinates to auto-check in", async () => {
    const credentials = await tokens("tickets:write");
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "manage_ticket_record", arguments: { action: "create", payload: { description: "Repair", initialState: "on_site", checkInLatitude: 35, checkInLongitude: -97, confirmed: true } } } });
    expect(JSON.parse(response.body.result.content[0].text).status).toBe("pending");
    expect(grants[0].actions?.[0].arguments).toMatchObject({ payload: { description: "Repair", initialState: "pending_arrival" } });
    expect(grants[0].actions?.[0].arguments.payload).not.toHaveProperty("checkInLatitude");
    expect(grants[0].actions?.[0].arguments.payload).not.toHaveProperty("checkInLongitude");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("dispatches an approved ticket mutation once and reuses its saved result", async () => {
    const credentials = await tokens("tickets:write");
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "manage_ticket_record", arguments: { action: "update", ticketId: 12, payload: { description: "Reviewed repair" } } } });
    const prepared = JSON.parse(response.body.result.content[0].text);
    expect(prepared.status).toBe("pending");
    expect(mocks.run).not.toHaveBeenCalled();
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    mocks.run.mockImplementation(async (name, input, actor, _history, _stream, trusted) => {
      expect(resolveExecutableWorkHubToolRequest(name, input, trusted, actor)).toMatchObject({ method: "PATCH", path: "/tickets/12", body: { description: "Reviewed repair" } });
      return JSON.stringify({ ok: true, id: 12 });
    });
    const submit = () => request(app).post(actionPath).set("Origin", "https://vndrly.ai").set("Cookie", `${cookie()}; ${actionCookie}`).type("form").send({ nonce });
    expect((await submit()).status).toBe(200);
    await submit();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(grants[0].actions?.[0]).toMatchObject({ state: "completed", result: JSON.stringify({ ok: true, id: 12 }) });
  });
  it("prepares separately consented onboarding changes without private audit values or legal acceptance", async () => {
    mocks.validate.mockImplementation(async (value) => ({ ...value, membershipRole: "admin", exp: Math.floor(Date.now() / 1000) + 60 }));
    const read = await tokens("onboarding:read");
    const call = (access: string, path: string) => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${access}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_onboarding_field", arguments: { path, value: "synthetic-private-value" } } });
    expect((await call(read.access_token, "taxIds.federalTaxId")).body.result.isError).toBe(true);
    const write = await tokens("onboarding:write");
    expect((await call(write.access_token, "legalConsent.accepted")).body.result.isError).toBe(true);
    const prepared = await call(write.access_token, "taxIds.federalTaxId");
    expect(JSON.parse(prepared.body.result.content[0].text)).toMatchObject({ status: "pending", requiresConfirmation: true });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("synthetic-private-value");
    expect(prepared.body.result._meta.componentApproval).toMatchObject({ toolName: "set_onboarding_field", arguments: { path: "taxIds.federalTaxId", value: "synthetic-private-value" } });
    expect(JSON.stringify(prepared.body.result.content)).not.toContain("synthetic-private-value");
  });
  it("projects final onboarding completion before durable execution and result readback", async () => {
    mocks.validate.mockImplementation(async (value) => ({ ...value, membershipRole: "admin", exp: Math.floor(Date.now() / 1000) + 60 }));
    const credentials = await tokens("onboarding:write");
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "finalize_onboarding", arguments: {} } });
    const prepared = JSON.parse(response.body.result.content[0].text);
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    mocks.run.mockResolvedValue(JSON.stringify({ ok: true, response: JSON.stringify({ orgType: "vendor", currentStep: "done", completedAt: "2026-10-06", payload: { taxId: "synthetic-private-value" } }) }));
    const result = await request(app).post(actionPath).set("Origin", "https://vndrly.ai").set("Cookie", `${cookie()}; ${actionCookie}`).type("form").send({ nonce });
    expect(result.status).toBe(200);
    expect(result.text).not.toContain("synthetic-private-value");
    expect(result.text).toContain("done");
    expect(JSON.stringify(grants)).not.toContain("synthetic-private-value");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("synthetic-private-value");
  });
  it("requires onboarding scope and omits private setup fields from workspace output and audit", async () => {
    const deniedCredentials = await tokens("work_hub:read");
    const message = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_show_workspace", arguments: { view: "onboarding" } } };
    expect((await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${deniedCredentials.access_token}`).send(message)).body.result.isError).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
    const memberCredentials = await tokens("onboarding:read");
    expect((await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${memberCredentials.access_token}`).send(message)).body.result.isError).toBe(true);
    mocks.validate.mockImplementation(async (value) => ({ ...value, membershipRole: "admin", exp: Math.floor(Date.now() / 1000) + 60 }));
    const credentials = await tokens("onboarding:read");
    mocks.run.mockResolvedValue(JSON.stringify({ progress: { orgType: "vendor", currentStep: "branding", completedSteps: [], skippedSteps: [], payload: { taxId: "private-tax-value" } } }));
    const result = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send(message);
    expect(result.body.result.isError).toBe(false);
    expect(result.body.result.structuredContent.availableViews).toContain("onboarding");
    expect(JSON.stringify(result.body)).not.toContain("private-tax-value");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("private-tax-value");
  });
  it("keeps workspace reads within granted scopes and hides unassigned Gate navigation", async () => {
    const credentials = await tokens("work_hub:read");
    mocks.run.mockResolvedValue(JSON.stringify({ tasks: [], shifts: [], meetings: [], announcements: [] }));
    const call = (view: string) => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_show_workspace", arguments: { view } } });
    const workday = await call("my_workday");
    expect(workday.body.result.structuredContent.availableViews).not.toContain("gate_board");
    expect(workday.body.result.isError).toBe(false);
    mocks.run.mockClear();
    expect((await call("gate_board")).body.result.isError).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(["tickets:read", "operations:read"])("advertises workspace for standalone %s access", async scope => {
    const credentials = await tokens(scope);
    const result = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(result.body.result.tools.map((tool: { name: string }) => tool.name)).toContain("v_show_workspace");
  });
  it("requires account authentication even for static workspace resources", async () => {
    const resource = { jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "ui://vndrly/workspace/v1.html" } };
    expect((await request(app).post(`${base}/mcp`).send(resource)).status).toBe(401);
    const credentials = await tokens();
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send(resource);
    expect(response.body.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(response.body.result.contents[0]._meta.ui.csp.connectDomains).toEqual([]);
  });
  it("is disabled until explicitly configured", async () => {
    delete process.env.ASSISTANT_CONNECTION_ENABLED;
    expect((await request(app).get(`${base}/.well-known/oauth-authorization-server`)).status).toBe(503);
  });
  it("publishes discovery and challenges unauthenticated MCP calls", async () => {
    const metadata = await request(app).get(`${base}/.well-known/oauth-authorization-server`);
    expect(metadata.body.code_challenge_methods_supported).toEqual(["S256"]);
    const denied = await request(app).post(`${base}/mcp`).send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).set("Cookie", cookie());
    expect(denied.status).toBe(401);
    expect(denied.headers["www-authenticate"]).toContain("resource_metadata=");
  });
  it("rejects redirect tampering before accessing any account", async () => {
    const result = await request(app).get(`${base}/authorize`).query({ ...auth, redirect_uri: "https://attacker.test" }).set("Cookie", cookie());
    expect(result.status).toBe(400);
    expect(result.headers.location).toBeUndefined();
    expect(mocks.validate).not.toHaveBeenCalled();
  });
  it("requires both origin and bound consent cookie, and prevents consent replay", async () => {
    const form = await consent();
    for (const origin of ["https://attacker.test", undefined]) {
      const attempt = request(app).post(`${base}/authorize`).set("Cookie", form.cookies).type("form");
      if (origin) attempt.set("Origin", origin);
      expect((await attempt.send({ consent: form.consentValue, selected_scope: form.selectedScopes })).status).toBe(400);
    }
    expect((await request(app).post(`${base}/authorize`).set("Origin", "https://vndrly.ai").set("Cookie", cookie()).type("form").send({ consent: form.consentValue, selected_scope: form.selectedScopes })).status).toBe(400);
    const submit = () => request(app).post(`${base}/authorize`).set("Origin", "https://vndrly.ai").set("Cookie", form.cookies).type("form").send({ consent: form.consentValue, selected_scope: form.selectedScopes });
    expect((await submit()).status).toBe(303);
    expect((await submit()).status).toBe(400);
  });
  it("executes a live read under the bound actor and audits it", async () => {
    const credentials = await tokens();
    const result = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "query_gate_stations", arguments: {} } });
    expect(result.body.result.isError).toBe(false);
    expect(mocks.run).toHaveBeenCalledWith("query_gate_stations", {}, expect.objectContaining({ userId: 17, vendorId: 4 }), "");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ provider: "chatgpt_mcp", resultStatus: "success" }));
  });
  it("derives Gate specialist visibility from current site authorization, not merely a grant", async () => {
    const credentials = await tokens();
    const directory = () => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "v_list_specialists", arguments: {} } });
    mocks.run.mockResolvedValueOnce(JSON.stringify({ sites: [] }));
    expect((await directory()).body.result.structuredContent.specialists.some((item: { id: string }) => item.id === "gate")).toBe(false);
    mocks.run.mockResolvedValueOnce(JSON.stringify({ sites: [{ id: 3 }] }));
    expect((await directory()).body.result.structuredContent.specialists.some((item: { id: string }) => item.id === "gate")).toBe(true);
    mocks.run.mockResolvedValueOnce(JSON.stringify({ error: "Access unavailable", sites: [{ id: 3 }] }));
    expect((await directory()).body.result.structuredContent.specialists.some((item: { id: string }) => item.id === "gate")).toBe(false);
  });
  it("blocks writes, arbitrary tools and cross-origin MCP requests", async () => {
    const credentials = await tokens();
    for (const name of ["confirm_visitor_check_out", "arbitrary_sql"]) {
      const result = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name, arguments: { confirmed: true } } });
      expect(result.body.result.isError).toBe(true);
    }
    expect(mocks.run).not.toHaveBeenCalled();
    expect((await request(app).post(`${base}/mcp`).set("Origin", "https://attacker.test").set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 5, method: "tools/list" })).status).toBe(403);
  });
  it("checks revoked account authority and explicit revocation", async () => {
    const credentials = await tokens();
    mocks.validate.mockRejectedValueOnce(new Error("membership removed"));
    expect((await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 5, method: "tools/list" })).status).toBe(401);
    expect((await request(app).post(`${base}/revoke`).type("form").send({ client_id: CHATGPT_CLIENT_ID, token: credentials.refresh_token })).status).toBe(200);
    expect((await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 5, method: "tools/list" })).status).toBe(401);
  });
  it("prepares a write without executing, strips model authority/GPS, and deduplicates retries", async () => {
    const credentials = await tokens("gate:read gate:write work_hub:read work_hub:write");
    const prepare = () => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "v_prepare_action", arguments: { toolName: "assume_gate_shift", arguments: { stationId: "test-station", confirmed: true, idempotencyKey: "model-key", operationId: "model-operation", latitude: 10, longitude: 20 } } } });
    const first = await prepare(), second = await prepare();
    expect(first.body.result.isError).toBe(false);
    const prepared = JSON.parse(first.body.result.content[0].text);
    expect(prepared.status).toBe("pending");
    expect(JSON.parse(second.body.result.content[0].text).approvalUrl).toBe(prepared.approvalUrl);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.bound).not.toHaveBeenCalled();
    expect(grants[0].actions).toHaveLength(1);
    expect(grants[0].actions![0].arguments).toEqual({ stationId: "test-station" });
  });
  it("executes once only after bound staff approval and returns actual action status", async () => {
    const credentials = await tokens("gate:read gate:write");
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "v_prepare_action", arguments: { toolName: "set_gate_coverage_status", arguments: { stationId: "test-station", reason: "Isolated test", status: "paused" } } } });
    const prepared = JSON.parse(response.body.result.content[0].text);
    const actionPath = new URL(prepared.approvalUrl).pathname;
    expect((await request(app).get(actionPath)).status).toBe(400);
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    const submit = (origin: string) => request(app).post(actionPath).set("Cookie", `${cookie()}; ${actionCookie}`).set("Origin", origin).type("form").send({ nonce });
    expect((await submit("https://attacker.test")).status).toBe(400);
    expect(mocks.bound).not.toHaveBeenCalled();
    mocks.run.mockResolvedValueOnce(JSON.stringify({ ok: true, action: "gate_coverage_updated" }));
    expect((await submit("https://vndrly.ai")).status).toBe(200);
    expect((await submit("https://vndrly.ai")).status).toBe(200);
    expect(mocks.bound).toHaveBeenCalledTimes(1);
    expect(mocks.bound.mock.calls[0][0].input.operationId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(mocks.bound).toHaveBeenCalledWith(expect.objectContaining({ phrase: "confirm", session: expect.objectContaining({ userId: 17 }) }));
    const status = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "v_action_status", arguments: { reference: prepared.reference } } });
    expect(JSON.parse(status.body.result.content[0].text)).toMatchObject({ state: "completed", result: { ok: true, action: "gate_coverage_updated" } });
  });
  it("records invitation revocation success and does not repeat it on approval retry", async () => {
    mocks.validate.mockImplementation(async value => ({ ...value, membershipRole: "admin" }));
    const credentials = await tokens("invitations:read invitations:write");
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "v_prepare_action", arguments: { toolName: "confirm_account_invitations_action", arguments: { action: "revoke", resourceId: "synthetic-invitation" } } } });
    const prepared = JSON.parse(response.body.result.content[0].text);
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    mocks.run.mockResolvedValueOnce(JSON.stringify({ ok: true, status: "applied" }));
    const submit = () => request(app).post(actionPath).set("Cookie", `${cookie()}; ${actionCookie}`).set("Origin", "https://vndrly.ai").type("form").send({ nonce });
    expect((await submit()).status).toBe(200);
    expect((await submit()).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const status = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "v_action_status", arguments: { reference: prepared.reference } } });
    expect(JSON.parse(status.body.result.content[0].text)).toMatchObject({ state: "completed", result: { ok: true, status: "applied" } });
  });
  it("uses approval-device location for a trip update and discards model telemetry", async () => {
    const credentials = await tokens("crew:read trips:write");
    const response = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "v_prepare_action", arguments: { toolName: "confirm_field_trips_action", arguments: { action: "location", resourceId: "synthetic-trip", payload: { expectedVersion: 1, latitude: 1, longitude: 2, accuracyMeters: 3, recordedAt: "fake", speedMps: 99, operationId: "fake" } } } } });
    const prepared = JSON.parse(response.body.result.content[0].text);
    expect(grants[0].actions![0].arguments).toMatchObject({ payload: { expectedVersion: 1 } });
    expect(grants[0].actions![0].arguments.payload).not.toHaveProperty("latitude");
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    expect(approval.text).toContain('data-location="required"');
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    mocks.run.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    await request(app).post(actionPath).set("Cookie", `${cookie()}; ${actionCookie}`).set("Origin", "https://vndrly.ai").type("form").send({ nonce, latitude: 31, longitude: -98, accuracyMeters: 5 }).expect(200);
    expect(mocks.run.mock.calls[0][1].payload).toMatchObject({ expectedVersion: 1, latitude: 31, longitude: -98, accuracyMeters: 5, speedMps: null });
    expect(Number.isFinite(Date.parse(mocks.run.mock.calls[0][1].payload.recordedAt))).toBe(true);
    expect(grants[0].actions![0].result).toContain('"trackingCollectorStarted":false');
  });
  it("retains uncertain writes across delayed retries and reconciles durable results without execution", async () => {
    const credentials = await tokens("gate:read gate:write");
    const prepare = () => request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "set_gate_coverage_status", arguments: { stationId: "test-station", reason: "Isolated test", mode: "paused_indefinitely" } } });
    const first = await prepare();
    const prepared = JSON.parse(first.body.result.content[0].text);
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    mocks.bound.mockRejectedValueOnce(new Error("Interrupted after canonical write"));
    expect((await request(app).post(actionPath).set("Cookie", `${cookie()}; ${actionCookie}`).set("Origin", "https://vndrly.ai").type("form").send({ nonce })).status).toBe(503);
    expect(grants[0].actions![0].state).toBe("outcome_unknown");
    const later = Date.now() + 360_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const retried = JSON.parse((await prepare()).body.result.content[0].text);
    expect(retried.reference).toBe(prepared.reference);
    expect(retried.status).toBe("outcome_unknown");
    expect(grants[0].actions).toHaveLength(1);
    expect(mocks.bound).toHaveBeenCalledTimes(1);
    mocks.durableResult.mockResolvedValueOnce(JSON.stringify({ ok: true, action: "gate_coverage_updated" }));
    const status = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "v_action_status", arguments: { reference: prepared.reference } } });
    expect(JSON.parse(status.body.result.content[0].text)).toMatchObject({ state: "completed", result: { ok: true } });
    expect(mocks.bound).toHaveBeenCalledTimes(1);
  });
  it("preserves completed results when the separate audit write fails", async () => {
    const credentials = await tokens("gate:read gate:write");
    const prepare = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "set_gate_coverage_status", arguments: { stationId: "test-station", reason: "Isolated test", mode: "active" } } });
    const prepared = JSON.parse(prepare.body.result.content[0].text);
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    mocks.run.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    mocks.audit.mockRejectedValueOnce(new Error("Audit temporarily unavailable"));
    expect((await request(app).post(actionPath).set("Cookie", `${cookie()}; ${actionCookie}`).set("Origin", "https://vndrly.ai").type("form").send({ nonce })).status).toBe(503);
    expect(grants[0].actions![0]).toMatchObject({ state: "completed", result: JSON.stringify({ ok: true }) });
    expect((await request(app).get(actionPath).set("Cookie", cookie())).text).toContain("Action result");
  });
  it("discards paid-travel tracking assertions and uses the approval browser's coordinates", async () => {
    const credentials = await tokens("gate:read gate:write");
    const prepare = await request(app).post(`${base}/mcp`).set("Authorization", `Bearer ${credentials.access_token}`).send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "start_paid_travel", arguments: { stationId: "test-station", workHubShiftId: "test-shift", startLatitude: 90, startLongitude: 180, locationSharingActive: true } } });
    const prepared = JSON.parse(prepare.body.result.content[0].text);
    expect(grants[0].actions![0].arguments).toEqual({ stationId: "test-station", workHubShiftId: "test-shift" });
    const actionPath = new URL(prepared.approvalUrl).pathname;
    const approval = await request(app).get(actionPath).set("Cookie", cookie());
    expect(approval.text).toContain("Continuous trip tracking must be enabled");
    const nonce = /name="nonce" value="([^"]+)"/.exec(approval.text)![1];
    const actionCookie = approval.headers["set-cookie"][0].split(";")[0];
    const submit = (coordinates = {}) => request(app).post(actionPath).set("Cookie", `${cookie()}; ${actionCookie}`).set("Origin", "https://vndrly.ai").type("form").send({ nonce, ...coordinates });
    expect((await submit()).status).toBe(400);
    expect(mocks.bound).not.toHaveBeenCalled();
    expect((await submit({ latitude: "35.4", longitude: "-97.2", accuracyMeters: "8" })).status).toBe(200);
    expect(mocks.bound).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ startLatitude: 35.4, startLongitude: -97.2, locationSharingActive: false }) }));
  });
});

it("offers explicit account switching without authorizing a connection", async () => {
  const response = await request(app).get(`${base}/authorize`).query(auth).set("Cookie", cookie());
  expect(response.status).toBe(200);
  expect(response.text).toContain('href="/switch-account"');
  expect(response.text).toContain("Switch VNDRLY account");
  expect(grants).toHaveLength(0);
});

it("resumes a coordinated plan only with Work Hub read access and the linked actor", async () => {
 const { createCoordinatedPlan, encodePlanDescription } = await import("../assistant/coordinated-plan");
 const taskId = "11111111-1111-4111-8111-111111111111";
 const plan = createCoordinatedPlan({ userId: 17, organizationKey: "vendor:4" }, [{ id: "brief", specialist: "V", toolNames: ["get_work_hub_briefing"], dependsOn: [] }]);
 mocks.run.mockResolvedValue(JSON.stringify([{ id: taskId, ownerOrgType: "vendor", ownerOrgId: 4, version: 1, status: 'open', description: encodePlanDescription(plan) }]));
 const credentials = await tokens("work_hub:read");
 const call = (access: string) => request(app).post(base + "/mcp").set("Authorization", "Bearer " + access).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "v_resume_work_plan", arguments: { taskId } } });
 const resumed = await call(credentials.access_token);
 expect(resumed.body.result.structuredContent).toMatchObject({ taskId, eligibleStepIds: ["brief"], executionStarted: false, recordedCompletionRequiresReadback: true });
 const limited = await tokens("gate:read");
 mocks.run.mockClear();
 const denied = await call(limited.access_token);
 expect(denied.body.result.isError).toBe(true);
 expect(mocks.run).not.toHaveBeenCalled();
});
it("prepares coordinated task creation through the existing action panel, without executing it",async()=>{
 const credentials=await tokens('work_hub:read work_hub:write');
 const input={planId:'11111111-1111-4111-8111-111111111111',title:'Synthetic recovery',steps:[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing'],dependsOn:[]}]};
 const call=()=>request(app).post(base+'/mcp').set('Authorization','Bearer '+credentials.access_token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'v_prepare_work_plan',arguments:input}});
 const response=await call();
 expect(response.body.result.isError).not.toBe(true);
 const result=JSON.parse(response.body.result.content[0].text);
 expect(result.requiresConfirmation).toBe(true);
 expect(response.body.result.structuredContent).toEqual(result);
 expect(response.body.result.structuredContent).not.toHaveProperty('proof');
 expect(response.body.result.structuredContent).toMatchObject({status:'pending',result:null});
 expect(grants[0].actions?.[0].toolName).toBe('manage_work_hub_task');
 expect(grants[0].actions?.[0].arguments.owner).toEqual({type:'vendor',id:4});
 expect(JSON.parse((grants[0].actions?.[0].arguments.payload as {description:string}).description).identity).toEqual({userId:17,organizationKey:'vendor:4'});
 expect(mocks.run).not.toHaveBeenCalled();
 const retry=await call();expect(JSON.parse(retry.body.result.content[0].text).reference).toBe(result.reference);
 expect(grants[0].actions).toHaveLength(1);
});
it('prepares only a signed observed checkpoint and retains panel authorization', async () => {
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing','get_work_hub_briefing'],dependsOn:[]}]);
 const row={id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:1,status:'open',description:encodePlanDescription(plan)};
 const credentials=await tokens('work_hub:read work_hub:write');
 const call=(name:string,args:unknown,token=credentials.access_token)=>request(app).post(base+'/mcp').set('Authorization','Bearer '+token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
 mocks.run.mockResolvedValueOnce(JSON.stringify([row])).mockResolvedValueOnce(JSON.stringify({tasks:[],events:[]}));
 const response=await call('v_run_work_plan_read',{taskId,stepId:'brief',toolArguments:{get_work_hub_briefing:{}}});
 const receipt=response.body.result.structuredContent.checkpointReceipt;
 expect(typeof receipt).toBe('string');
 expect(response.body.result.structuredContent.results).toHaveLength(1);
 expect(mocks.run).toHaveBeenCalledTimes(2);
 mocks.run.mockResolvedValue(JSON.stringify([row]));
 expect((await call('v_prepare_work_plan_read_checkpoint',{receipt})).body.result.isError).toBe(false);
 const saved=grants[0].actions![0];
 expect(saved.state).toBe('pending');
 expect(JSON.parse((saved.arguments.payload as {description:string}).description).steps[0]).toMatchObject({state:'waiting',resultReferences:[expect.stringContaining('plan-read:')]});
 expect(mocks.bound).not.toHaveBeenCalled();
 const [body,signature]=receipt.split('.');
 const decoded=JSON.parse(Buffer.from(body,'base64url').toString('utf8')); decoded.userId=99;
 expect((await call('v_prepare_work_plan_read_checkpoint',{receipt:Buffer.from(JSON.stringify(decoded)).toString('base64url')+'.'+signature})).body.result.isError).toBe(true);
 const limited=await tokens('work_hub:read'); mocks.run.mockClear();
 expect((await call('v_prepare_work_plan_read_checkpoint',{receipt},limited.access_token)).body.result.isError).toBe(true);
 expect(mocks.run).not.toHaveBeenCalled();
});
it('executes a saved plan read step without claiming a saved checkpoint',async()=>{
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing'],dependsOn:[]}]);
 const credentials=await tokens('work_hub:read');
 mocks.run.mockResolvedValueOnce(JSON.stringify([{id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:1,status:'open',description:encodePlanDescription(plan)}])).mockResolvedValueOnce(JSON.stringify({tasks:[],events:[]}));
 const response=await request(app).post(base+'/mcp').set('Authorization','Bearer '+credentials.access_token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'v_run_work_plan_read',arguments:{taskId,stepId:'brief',toolArguments:{get_work_hub_briefing:{}}}}});
 expect(response.body.result.structuredContent).toMatchObject({stepId:'brief',executionStarted:true,checkpointSaved:false,results:[{toolName:'get_work_hub_briefing',result:{tasks:[],events:[]}}]});
 expect(grants[0].actions??[]).toHaveLength(0);
});
it.each(['exception', 'ok false'])('preserves successful planned reads when another lookup returns %s', async (failure) => {
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing','list_work_hub_tasks'],dependsOn:[]}]);
 const credentials=await tokens('work_hub:read');
 mocks.run.mockResolvedValueOnce(JSON.stringify([{id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:1,status:'open',description:encodePlanDescription(plan)}])).mockResolvedValueOnce(JSON.stringify({tasks:[],events:[]}));
 if(failure==='exception') mocks.run.mockRejectedValueOnce(new Error('private-provider-detail'));
 else mocks.run.mockResolvedValueOnce(JSON.stringify({ok:false,message:'Unavailable'}));
 const response=await request(app).post(base+'/mcp').set('Authorization','Bearer '+credentials.access_token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'v_run_work_plan_read',arguments:{taskId,stepId:'brief',toolArguments:{get_work_hub_briefing:{},list_work_hub_tasks:{}}}}});
 const output=response.body.result.structuredContent;
 expect(output).toMatchObject({executionStarted:true,checkpointSaved:false,results:[{toolName:'get_work_hub_briefing',result:{tasks:[],events:[]}},{toolName:'list_work_hub_tasks',result:{ok:false}}]});
 expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
 expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({toolName:'list_work_hub_tasks',resultStatus:'failure'}));
 expect(grants[0].actions??[]).toHaveLength(0);
});
it('prepares a version-bound plan pause without executing or fabricating completion',async()=>{
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing'],dependsOn:[]}]);
 const row={id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:3,status:'in_progress',description:encodePlanDescription(plan)};
 const credentials=await tokens('work_hub:read work_hub:write');
 const input={taskId,expectedTaskVersion:3,stepId:'brief',state:'waiting',detail:'Waiting for the user to return'};
 const call=(args:unknown,token=credentials.access_token)=>request(app).post(base+'/mcp').set('Authorization','Bearer '+token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'v_prepare_work_plan_control',arguments:args}});
 mocks.run.mockResolvedValue(JSON.stringify([row]));
 const response=await call(input);
 expect(response.body.result.isError).toBe(false);
 expect(JSON.parse(response.body.result.content[0].text)).toMatchObject({requiresConfirmation:true,status:'pending',toolName:'manage_work_hub_task'});
 const saved=grants[0].actions![0];
 expect(saved.arguments).toMatchObject({taskId,expectedVersion:3,action:'update',payload:{status:'in_progress'}});
 expect(JSON.parse((saved.arguments.payload as {description:string}).description).steps[0]).toMatchObject({state:'waiting',resultReferences:[]});
 expect(mocks.run).toHaveBeenCalledTimes(1);
 const retry=await call(input);expect(JSON.parse(retry.body.result.content[0].text).reference).toBe(saved.reference);
 expect((await call({...input,state:'completed',resultReferences:['fabricated']})).body.result.isError).toBe(true);
 expect((await call({...input,expectedTaskVersion:2})).body.result.isError).toBe(true);
 const limited=await tokens('work_hub:read');mocks.run.mockClear();
 expect((await call(input,limited.access_token)).body.result.isError).toBe(true);
 expect(mocks.run).not.toHaveBeenCalled();
 expect(grants[0].actions).toHaveLength(1);
});
it('returns safety draft fields through the scoped read boundary without a client command',async()=>{
 const credentials=await tokens('safety:read');
 const call=(token:string)=>request(app).post(base+'/mcp').set('Authorization','Bearer '+token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'draft_safety_report',arguments:{title:'SYNTHETIC loose railing',eventType:'unsafe_condition',siteLocationId:392}}});
 mocks.run.mockResolvedValue(JSON.stringify({ok:true,draft:{title:'SYNTHETIC loose railing',siteLocationId:392},submitted:false,execution:'client',intent:{name:'prefill_draft'}}));
 const response=await call(credentials.access_token);
 const result=JSON.parse(response.body.result.content[0].text);
 expect(result).toMatchObject({submitted:false,execution:'draft_only',formPopulated:false,siteAccessVerified:false});
 expect(result).not.toHaveProperty('intent');
 expect(grants[0].actions??[]).toHaveLength(0);
 const limited=await tokens('operations:read');mocks.run.mockClear();
 expect((await call(limited.access_token)).body.result.isError).toBe(true);
 expect(mocks.run).not.toHaveBeenCalled();
});

it("Gate checkpoint retrieves own durable receipt and exact scoped visit, then rechecks before approval", async () => {
  const { createCoordinatedPlan, encodePlanDescription } =
    await import("../assistant/coordinated-plan");
  const taskId = "11111111-1111-4111-8111-111111111111";
  const credentials = await tokens(
    "work_hub:read work_hub:write gate:read gate:write",
  );
  const call = (name: string, args: unknown) =>
    request(app)
      .post(base + "/mcp")
      .set("Authorization", "Bearer " + credentials.access_token)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
  const prepared = (await call("confirm_visitor_check_out", { visitId: 7 }))
    .body.result;
  const reference = JSON.parse(prepared.content[0].text).reference;
  const stored = grants[0].actions![0];
  stored.state = "completed";
  stored.executionFingerprint = "canonical-durable-gate-checkout";
  stored.result = JSON.stringify({
    ok: true,
    action: "visitor_checked_out",
    visitId: 7,
  });
  const plan = createCoordinatedPlan(
    { userId: 17, organizationKey: "vendor:4" },
    [
      {
        id: "exit",
        specialist: "Gate",
        toolNames: ["confirm_visitor_check_out"],
        dependsOn: [],
        completion: {
          kind: "canonical_gate_visit_action_saved",
          action: "check_out",
          visitId: 7,
          siteLocationId: 392,
        },
      },
    ],
  );
  const row = {
    id: taskId,
    subjectType: "task",
    ownerOrgType: "vendor",
    ownerOrgId: 4,
    version: 3,
    status: "open",
    description: encodePlanDescription(plan),
  };
  const visit = {
    id: 7,
    siteLocationId: 392,
    firstName: "Synthetic",
    lastName: "Visitor",
    hostType: "vendor",
    hostVendorId: 4,
    hostPartnerId: null,
    checkInTime: "2030-01-01T11:00:00Z",
    checkOutTime: "2030-01-01T12:00:00Z",
    autoCheckedOut: false,
  };
  mocks.taskRead.mockImplementation(async (path) =>
    path === "/visits/7" ? visit : row,
  );
  const checkpoint = (
    await call("v_prepare_work_plan_completion", {
      taskId,
      expectedTaskVersion: 3,
      stepId: "exit",
      actionReference: reference,
    })
  ).body.result;
  expect(checkpoint.isError).toBe(false);
  expect(mocks.taskRead).toHaveBeenCalledWith(
    "/visits/7",
    "GET",
    {},
    expect.objectContaining({ userId: 17 }),
  );
  expect(mocks.bound).not.toHaveBeenCalled();
  mocks.taskRead.mockImplementation(async (path) =>
    path === "/visits/7" ? { error: "Current site permission revoked" } : row,
  );
  expect(
    (await call("v_submit_panel_action", checkpoint._meta.componentApproval))
      .body.result.isError,
  ).toBe(true);
  expect(mocks.bound).not.toHaveBeenCalled();
});

