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

const app = express();
app.use(cookieParser(), express.json(), express.urlencoded({ extended: false }));
app.use("/api/assistant-connection", router);
const base = "/api/assistant-connection";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "q".repeat(43);
const auth = { client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect, response_type: "code", resource: ASSISTANT_RESOURCE, code_challenge_method: "S256", code_challenge: assistantPkceChallenge(verifier), scope: "gate:read work_hub:read", state: "opaque-state" };
const session = { userId: 17, role: "vendor", membershipRole: "member", vendorId: 4, sv: 1, exp: Math.floor(Date.now() / 1000) + 600 };
function cookie() {
  const body = Buffer.from(JSON.stringify(session)).toString("base64");
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
