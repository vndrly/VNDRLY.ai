import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { expectedWorkforceContext } from "./workforce-context";
import { buildTestCookie } from "../test-utils/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { AssistantOAuthError } from "../assistant/chatgpt-oauth";

vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: vi.fn() }));
const effect = vi.fn();
const app = express().use(cookieParser()).use(expectedWorkforceContext).all("/bound", (_req, res) => { effect(); res.json({ saved: true }); });
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
const headers = { "X-VNDRLY-Actor-User": "17", "X-VNDRLY-Vendor": "4", "X-VNDRLY-Membership": "8" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(validateAssistantSession).mockImplementation(async session => session); });
it("preserves headerless clients without extra current-context validation", async () => {
  expect((await request(app).get("/bound")).status).toBe(200);
  expect(validateAssistantSession).not.toHaveBeenCalled();
});
it("permits only a complete matching DB-validated actor/company/membership", async () => {
  expect((await request(app).post("/bound").set("Cookie", buildTestCookie(session)).set(headers)).status).toBe(200);
  expect(validateAssistantSession).toHaveBeenCalledWith(expect.objectContaining(session)); expect(effect).toHaveBeenCalledOnce();
});
it.each([
  { userId: 19 }, { vendorId: 5 }, { activeMembershipId: 9 },
])("blocks a tab whose cookie changed its expected context: %j", async changed => {
  const response = await request(app).post("/bound").set("Cookie", buildTestCookie({ ...session, ...changed })).set(headers);
  expect(response.status).toBe(409); expect(response.body).toMatchObject({ code: "workforce.context_changed" });
  expect(effect).not.toHaveBeenCalled();
});
it("compares expected context with fresh validation rather than trusting cookie identity alone", async () => {
  vi.mocked(validateAssistantSession).mockResolvedValue({ ...session, activeMembershipId: 99 });
  expect((await request(app).get("/bound").set("Cookie", buildTestCookie(session)).set(headers)).status).toBe(409);
  expect(effect).not.toHaveBeenCalled();
});
it.each([
  { "X-VNDRLY-Actor-User": "17" },
  { ...headers, "X-VNDRLY-Membership": "08" },
  { ...headers, "X-VNDRLY-Vendor": "4, 5" },
])("rejects incomplete or malformed preconditions: %j", async supplied => {
  expect((await request(app).post("/bound").set("Cookie", buildTestCookie(session)).set(supplied)).status).toBe(409);
  expect(effect).not.toHaveBeenCalled();
});
it("rejects revoked membership before applying the route action", async () => {
  vi.mocked(validateAssistantSession).mockRejectedValue(new AssistantOAuthError("access_denied"));
  expect((await request(app).post("/bound").set("Cookie", buildTestCookie(session)).set(headers)).status).toBe(403);
  expect(effect).not.toHaveBeenCalled();
});
