import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), validate: vi.fn(), review: vi.fn(), approve: vi.fn() }));
vi.mock("../lib/session", () => ({ SESSION_SECRET: "s".repeat(32), getSessionFromRequest: mocks.session }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mocks.validate }));
vi.mock("../assistant/chatgpt-oauth", () => ({ ASSISTANT_ISSUER: "https://vndrly.ai/api/assistant-connection" }));
vi.mock("../assistant/plan-execution-consent", () => ({ createPlanExecutionConsentService: () => ({ getPrepared: mocks.review, approve: mocks.approve }) }));
import router from "./assistantPlanExecution";
const app = express(); app.use(cookieParser(), express.urlencoded({ extended: false })); app.use("/executions", router);
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "1");
  mocks.session.mockReturnValue({ userId: 17 }); mocks.validate.mockResolvedValue({ userId: 17, sv: 2 });
  mocks.review.mockResolvedValue({ proposal: { requester: { userId: 17, organizationKey: "vendor:4" }, expiresAt: Date.now() + 60000, maxAttempts: 2, steps: [{ arguments: { title: "<script>" } }] } });
  mocks.approve.mockResolvedValue({ authorization: { id: "saved-run" }, state: "pending" });
});
afterEach(() => vi.unstubAllEnvs());
it("requires current validated sign-in and renders escaped exact review without approving", async () => {
  const result = await request(app).get("/executions/review?token=signed");
  expect(result.status).toBe(200); expect(result.text).toContain("&lt;script&gt;");
  expect(result.headers["cache-control"]).toBe("no-store"); expect(mocks.validate).toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
  mocks.session.mockReturnValue(null);
  expect((await request(app).get("/executions/review?token=signed")).text).toContain("Sign into");
});
it("refuses cross-origin, absent nonce and substituted signed review before approval", async () => {
  const review = await request(app).get("/executions/review?token=signed");
  const cookie = review.headers["set-cookie"][0].split(";")[0];
  const nonce = /name="nonce" value="([^"]+)"/.exec(review.text)![1];
  for (const [origin, token, supplied] of [["https://foreign.invalid", "signed", nonce], ["https://vndrly.ai", "signed", "wrong"], ["https://vndrly.ai", "substituted", nonce]]) {
    expect((await request(app).post(`/executions/review?token=${token}`).set("Origin", origin).set("Cookie", cookie).type("form").send({ nonce: supplied })).status).toBe(403);
  }
  expect(mocks.approve).not.toHaveBeenCalled();
  const saved = await request(app).post("/executions/review?token=signed").set("Origin", "https://vndrly.ai").set("Cookie", cookie).type("form").send({ nonce });
  expect(saved.status).toBe(200); expect(saved.text).toContain("pending"); expect(saved.text).toContain("does not mean");
  expect(mocks.approve).toHaveBeenCalledWith("signed", { userId: 17, sv: 2 });
});
it("keeps disabled and invalid-session requests from creating approval", async () => {
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "0");
  expect((await request(app).get("/executions/review?token=signed")).status).toBe(503);
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "1"); mocks.validate.mockRejectedValue(Error("Revoked"));
  expect((await request(app).get("/executions/review?token=signed")).status).toBe(403);
  expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
});
