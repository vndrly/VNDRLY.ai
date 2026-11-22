import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  validate: vi.fn(),
  list: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  withAccount: vi.fn(),
  once: vi.fn(),
}));
vi.mock("../lib/session", () => ({ getSessionFromRequest: m.session }));
vi.mock("../assistant/chatgpt-grant-store", () => ({
  validateAssistantSession: m.validate,
}));
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
vi.mock("../lib/rate-limit-factory", () => ({
  createRateLimiter: () => ({ enforce: async () => true }),
}));
vi.mock("../work-hub/teams-connection-service", () => ({
  teamsConnectionIdentity: () => ({ binding: {} }),
}));
vi.mock("../work-hub/connectors/accounts", () => ({
  listAccounts: m.list,
  configurations: () => ({}),
  start: m.start,
  finish: m.finish,
  withAccount: m.withAccount,
  once: m.once,
}));
import router from "./workHubConnectors";
const app = express().use(express.json()).use(router);
const session = { userId: 10, vendorId: 20, activeMembershipId: 30, sv: 1 };
it.each([true, false])("returns callback to Communications without exposing credentials (success=%s)", async (success) => {
  if (success) m.finish.mockResolvedValue(undefined);
  else m.finish.mockRejectedValue(new Error("private failure details"));
  const result = await request(app).get("/work-hub/connectors/gmail/callback?state=test-state&code=private-code");
  expect(result.status).toBe(303);
  expect(result.headers.location).toBe("/work-hub/chat");
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.headers["referrer-policy"]).toBe("no-referrer");
  expect(result.text).not.toMatch(/private-code|private failure|test-state/);
});
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockReturnValue(session);
  m.validate.mockResolvedValue(session);
  m.list.mockResolvedValue([]);
});
it("does not read accounts without authentication", async () => {
  m.session.mockReturnValue(null);
  expect((await request(app).get("/work-hub/connectors/accounts")).status).toBe(
    401,
  );
  expect(m.list).not.toHaveBeenCalled();
});
it("revalidates membership before reading private mail", async () => {
  m.validate.mockRejectedValue(new Error("revoked"));
  expect((await request(app).get("/work-hub/connectors/accounts")).status).toBe(
    401,
  );
  expect(m.list).not.toHaveBeenCalled();
});
it("rejects cross-site connection attempts", async () => {
  expect(
    (
      await request(app)
        .post("/work-hub/connectors/gmail/connect")
        .set("Origin", "https://attacker.example")
        .send({})
    ).status,
  ).toBe(403);
  expect(m.start).not.toHaveBeenCalled();
});
it("uses authenticated membership for independent account lists", async () => {
  const r = await request(app).get("/work-hub/connectors/accounts");
  expect(r.status).toBe(200);
  expect(m.list).toHaveBeenCalledWith(session);
  expect(r.headers["cache-control"]).toBe("no-store");
});
it("rejects malformed recipients before obtaining provider tokens", async () => {
  const r = await request(app)
    .post(
      "/work-hub/connectors/accounts/123e4567-e89b-42d3-a456-426614174000/mail",
    )
    .send({
      operationId: "123e4567-e89b-42d3-a456-426614174001",
      draft: false,
      mail: { to: ["not-an-email"], subject: "test", text: "test" },
    });
  expect(r.status).toBe(400);
  expect(m.withAccount).not.toHaveBeenCalled();
  expect(m.once).not.toHaveBeenCalled();
});
