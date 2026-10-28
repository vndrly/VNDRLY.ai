import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), validate: vi.fn(), enabled: vi.fn(), status: vi.fn(), withToken: vi.fn(), assertGeneration: vi.fn(), deliver: vi.fn(), callback: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: mocks.session }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mocks.validate }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: mocks.enabled }));
vi.mock("../lib/rate-limit-factory", () => ({ createRateLimiter: () => ({ enforce: async () => true }) }));
vi.mock("../work-hub/teams-connection-service", () => ({ status: mocks.status, connectStart: vi.fn(), finishConnect: mocks.callback, disconnect: vi.fn(), withTeamsToken: mocks.withToken, assertTeamsGeneration: mocks.assertGeneration }));
vi.mock("../work-hub/teams-chat-send", () => ({ deliverTeamsChat: mocks.deliver }));
vi.mock("../work-hub/teams-meeting-sync", () => ({ listMeetings: vi.fn(), publishMeeting: vi.fn(), syncMeetings: vi.fn() }));
import router from "./workHubTeams";
import { TeamsProviderError } from "../work-hub/teams-graph";
const app = express().use(express.json()).use(router);
const session = { userId: 10, vendorId: 20, activeMembershipId: 30, sv: 1 };
const payload = { operationId: "cc7c024e-bbce-4c39-861e-bfb916087fd8", text: "hello", confirmSend: true, expectedGeneration: "a".repeat(64) };
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockReturnValue(session); mocks.validate.mockResolvedValue(session); mocks.enabled.mockResolvedValue(true); mocks.status.mockResolvedValue({ configured: true, connected: false }); mocks.withToken.mockImplementation((_session, callback) => callback("token", { id: "connection" })); });
describe("Teams authenticated HTTP boundary", () => {
  it("revalidates membership and rejects an expired or changed session", async () => {
    mocks.validate.mockRejectedValue(new Error("membership changed"));
    expect((await request(app).get("/work-hub/teams/status")).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("does not expose private reads without login", async () => {
    mocks.session.mockReturnValue(null);
    expect((await request(app).get("/work-hub/teams/chats")).status).toBe(401);
    expect(mocks.withToken).not.toHaveBeenCalled();
  });
  it("rejects cross-site writes before using Microsoft credentials", async () => {
    expect((await request(app).post("/work-hub/teams/chats/chat/messages").set("Origin", "https://evil.example").send(payload)).status).toBe(403);
    expect(mocks.withToken).not.toHaveBeenCalled();
  });
  it("requires explicit send confirmation and exact account generation", async () => {
    expect((await request(app).post("/work-hub/teams/chats/chat/messages").send({ ...payload, confirmSend: false })).status).toBe(400);
    mocks.assertGeneration.mockImplementation(() => { throw new TeamsProviderError("teams_account_changed", 409); });
    expect((await request(app).post("/work-hub/teams/chats/chat/messages").send(payload)).status).toBe(409);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("returns canonical send result and forbids private response caching", async () => {
    mocks.deliver.mockResolvedValue({ messageId: "message", status: "sent", replayed: false });
    const result = await request(app).post("/work-hub/teams/chats/chat/messages").send(payload);
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.messageId).toBe("message");
    expect(mocks.assertGeneration).toHaveBeenCalledWith(session, { id: "connection" }, payload.expectedGeneration);
  });
  it("keeps OAuth denial safe without reflecting provider error descriptions", async () => {
    const result = await request(app).get("/work-hub/teams/callback?error=access_denied&error_description=private-detail");
    expect(result.status).toBe(303); expect(result.headers.location).toContain("microsoft_consent_not_completed");
    expect(result.headers.location).not.toContain("private-detail"); expect(mocks.callback).not.toHaveBeenCalled();
  });
  it("maps an app-registration AADSTS at authorization to teams_app_misconfigured, never the description", async () => {
    for (const q of ["error=invalid_request&error_description=AADSTS50194%3A+Application+is+not+configured+as+a+multi-tenant+application.+private-detail", "error=invalid_request&error_description=AADSTS700016%3A+app+not+found", "error=unauthorized_client"]) {
      const result = await request(app).get(`/work-hub/teams/callback?${q}`);
      expect(result.headers.location).toBe("/work-hub/settings?teams_error=teams_app_misconfigured");
    }
    expect(mocks.callback).not.toHaveBeenCalled();
  });
  it("surfaces reconnect-required status and distinct reconnect / misconfiguration error codes", async () => {
    mocks.status.mockResolvedValue({ configured: true, connected: false, reconnectRequired: true, errorCode: "teams_reconnect_required", account: { username: "v@x" } });
    expect((await request(app).get("/work-hub/teams/status")).body).toMatchObject({ reconnectRequired: true, errorCode: "teams_reconnect_required" });
    mocks.withToken.mockRejectedValueOnce(new TeamsProviderError("teams_reconnect_required", 401));
    const revoked = await request(app).get("/work-hub/teams/chats");
    expect(revoked.status).toBe(401); expect(revoked.body.code).toBe("teams_reconnect_required");
    mocks.withToken.mockRejectedValueOnce(new TeamsProviderError("teams_app_misconfigured", 503));
    const misconfigured = await request(app).get("/work-hub/teams/chats");
    expect(misconfigured.status).toBe(503); expect(misconfigured.body.code).toBe("teams_app_misconfigured");
  });
  it("opts only idempotent reads into a token-refresh retry after Graph 401", async () => {
    mocks.withToken.mockResolvedValue({ chats: [], hasMore: false });
    await request(app).get("/work-hub/teams/chats");
    expect(mocks.withToken.mock.calls[0][2]).toEqual({ retryReadOnUnauthorized: true });
    mocks.deliver.mockResolvedValue({ messageId: "m", status: "sent", replayed: false }); mocks.withToken.mockImplementation((_s, cb) => cb("token", { id: "connection" }));
    await request(app).post("/work-hub/teams/chats/chat/messages").send(payload);
    expect(mocks.withToken.mock.calls[1][2]).toBeUndefined();
  });
});
