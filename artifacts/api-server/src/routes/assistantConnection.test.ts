import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createHmac } from "node:crypto";
import { ASSISTANT_RESOURCE, CHATGPT_CLIENT_ID, assistantPkceChallenge, type AssistantOAuthGrant } from "../assistant/chatgpt-oauth";

const mocks = vi.hoisted(() => ({ validate: vi.fn(), store: vi.fn(), run: vi.fn(), audit: vi.fn(), bound: vi.fn(), pending: vi.fn(), durableResult: vi.fn() }));
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
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.pending.mockReset();
  mocks.bound.mockReset().mockImplementation(async (args) => args.execute({ ...args.input, confirmed: true, idempotencyKey: "server-approved-test-key" }));
  mocks.durableResult.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ client_id: CHATGPT_CLIENT_ID, redirect_uris: [redirect], token_endpoint_auth_methods_supported: ["none"] }) }));
});
afterEach(() => { delete process.env.ASSISTANT_CONNECTION_ENABLED; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function consent(scope = auth.scope) {
  const response = await request(app).get(`${base}/authorize`).query({ ...auth, scope }).set("Cookie", cookie());
  expect(response.status).toBe(200);
  expect(response.headers["content-security-policy"]).toContain("form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect");
  const consentValue = /name="consent" value="([^"]+)"/.exec(response.text)![1];
  const nonceCookie = response.headers["set-cookie"][0].split(";")[0];
  return { consentValue, cookies: `${cookie()}; ${nonceCookie}` };
}
async function tokens(scope = auth.scope) {
  const form = await consent(scope);
  const authorized = await request(app).post(`${base}/authorize`).set("Origin", "https://vndrly.ai").set("Cookie", form.cookies).type("form").send({ consent: form.consentValue });
  expect(authorized.status).toBe(303);
  const callback = new URL(authorized.headers.location);
  expect(callback.searchParams.get("state")).toBe(auth.state);
  expect(callback.searchParams.get("iss")).toBe("https://vndrly.ai/api/assistant-connection");
  const response = await request(app).post(`${base}/token`).type("form").send({ grant_type: "authorization_code", client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect, resource: ASSISTANT_RESOURCE, code: callback.searchParams.get("code"), code_verifier: verifier });
  expect(response.status).toBe(200);
  return response.body;
}
describe("ChatGPT account connection boundary", () => {
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
  it.each(["valid", "revoked", "scope removed", "wrong user", "meeting denied"])("checks meeting handoff when %s", async (condition) => {
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
    const opened = await request(app).get(path).set("Cookie", cookie(condition === "wrong user" ? { ...session, userId: 18 } : session));
    expect(opened.status).toBe(condition === "valid" ? 302 : 403);
    if (condition === "valid") expect(opened.headers.location).toBe("/work-hub/meetings?meeting=" + occurrenceId);
    else expect(opened.headers.location).toBeUndefined();
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
    for (const name of ["manage_ticket_record", "v_prepare_action", "v_submit_panel_action"]) {
      expect(descriptors.body.result.tools.find((tool: { name: string }) => tool.name === name).annotations.destructiveHint).toBe(true);
    }
    const ticketTool = descriptors.body.result.tools.find((tool: { name: string }) => tool.name === "manage_ticket_record");
    expect(ticketTool._meta.ui.resourceUri).toBe("ui://vndrly/action/v5.html");
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
      expect((await attempt.send({ consent: form.consentValue })).status).toBe(400);
    }
    expect((await request(app).post(`${base}/authorize`).set("Origin", "https://vndrly.ai").set("Cookie", cookie()).type("form").send({ consent: form.consentValue })).status).toBe(400);
    const submit = () => request(app).post(`${base}/authorize`).set("Origin", "https://vndrly.ai").set("Cookie", form.cookies).type("form").send({ consent: form.consentValue });
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
 mocks.run.mockResolvedValue(JSON.stringify([{ id: taskId, ownerOrgType: "vendor", ownerOrgId: 4, version: 1, description: encodePlanDescription(plan) }]));
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
 mocks.run.mockResolvedValueOnce(JSON.stringify([{id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:1,description:encodePlanDescription(plan)}])).mockResolvedValueOnce(JSON.stringify({tasks:[],events:[]}));
 const response=await request(app).post(base+'/mcp').set('Authorization','Bearer '+credentials.access_token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'v_run_work_plan_read',arguments:{taskId,stepId:'brief',toolArguments:{get_work_hub_briefing:{}}}}});
 expect(response.body.result.structuredContent).toMatchObject({stepId:'brief',executionStarted:true,checkpointSaved:false,results:[{toolName:'get_work_hub_briefing',result:{tasks:[],events:[]}}]});
 expect(grants[0].actions??[]).toHaveLength(0);
});
it.each(['exception', 'ok false'])('preserves successful planned reads when another lookup returns %s', async (failure) => {
 const {createCoordinatedPlan,encodePlanDescription}=await import('../assistant/coordinated-plan');
 const taskId='11111111-1111-4111-8111-111111111111';
 const plan=createCoordinatedPlan({userId:17,organizationKey:'vendor:4'},[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing','list_work_hub_tasks'],dependsOn:[]}]);
 const credentials=await tokens('work_hub:read');
 mocks.run.mockResolvedValueOnce(JSON.stringify([{id:taskId,ownerOrgType:'vendor',ownerOrgId:4,version:1,description:encodePlanDescription(plan)}])).mockResolvedValueOnce(JSON.stringify({tasks:[],events:[]}));
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
