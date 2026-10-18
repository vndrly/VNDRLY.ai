import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "./app";
import { buildSessionCookie, resolveContext } from "./routes/auth";
import { decodeSession } from "./lib/session";
import { buildTestCookie } from "./test-utils/session";
import { withAssistantGrants } from "./assistant/chatgpt-grant-store";
import { ASSISTANT_RESOURCE, CHATGPT_CLIENT_ID, assistantPkceChallenge, issueAssistantCode, exchangeAssistantCode } from "./assistant/chatgpt-oauth";

describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("device logout and independent ChatGPT authorization", () => {
  beforeAll(() => {
    vi.stubEnv("ASSISTANT_CONNECTION_ENABLED", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ client_id: CHATGPT_CLIENT_ID, redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_methods_supported: ["none"] }) }));
  });
  afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("revokes only the signed-out device, including consent replay, until explicit global logout", async () => {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_oauth_grants jsonb");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS revoked_staff_sessions jsonb");
    const [user] = await db.insert(usersTable).values({ username: `logout-${randomUUID()}`, passwordHash: "unused-test-hash", displayName: "Isolated logout fixture", role: "admin" }).returning();
    const context = await resolveContext(user);
    const first = buildSessionCookie(user, context);
    const second = buildSessionCookie(user, context);
    expect(first).not.toBe(second);
    const session = decodeSession(first)!;
    const verifier = "v".repeat(43);
    const authorization = { clientId: CHATGPT_CLIENT_ID, redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect", resource: ASSISTANT_RESOURCE, challenge: assistantPkceChallenge(verifier), scopes: ["gate:read"] };
    const issued = issueAssistantCode(authorization, session);
    const tokens = await withAssistantGrants(user.id, async (grants) => {
      grants.push(issued.grant);
      return exchangeAssistantCode(issued.grant, { client_id: CHATGPT_CLIENT_ID, redirect_uri: authorization.redirectUri, resource: ASSISTANT_RESOURCE, code: issued.code, code_verifier: verifier });
    });
    const me = (token: string) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect((await me(first)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${first}`)).status).toBe(200);
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
    const [unchanged] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(unchanged.sessionVersion).toBe(user.sessionVersion);
    const stored = await pool.query("SELECT revoked_staff_sessions FROM users WHERE id=$1", [user.id]);
    expect(JSON.stringify(stored.rows[0])).not.toContain(first);
    expect(stored.rows[0].revoked_staff_sessions).toHaveLength(1);
    const consent = await request(app).get("/api/assistant-connection/authorize").query({ client_id: CHATGPT_CLIENT_ID, redirect_uri: authorization.redirectUri, resource: ASSISTANT_RESOURCE, response_type: "code", code_challenge: authorization.challenge, code_challenge_method: "S256", scope: "gate:read", state: "isolated-test" }).set("Cookie", `vndrly_session=${first}`);
    expect(consent.status).toBe(400);
    const refreshed = await request(app).post("/api/assistant-connection/token").type("form").send({ grant_type: "refresh_token", client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: tokens.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.scope).toBe("gate:read");
    const tools = await request(app).post("/api/assistant-connection/mcp").set("Authorization", `Bearer ${refreshed.body.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(tools.status).toBe(200);
    expect(tools.body.result.tools.length).toBeGreaterThan(0);
    expect((await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${first}`)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${second}`)).status).toBe(200);
    expect((await me(second)).status).toBe(401);
    const revoked = await request(app).post("/api/assistant-connection/token").type("form").send({ grant_type: "refresh_token", client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: refreshed.body.refresh_token });
    expect(revoked.status).toBe(400);
  });

  it("retains concurrent device revocations and still globally invalidates password changes", async () => {
    const password = "synthetic-original-password";
    const [user] = await db.insert(usersTable).values({ username: `logout-security-${randomUUID()}`, passwordHash: await bcrypt.hash(password, 4), displayName: "Isolated security fixture", role: "admin" }).returning();
    const context = await resolveContext(user);
    const tokens = Array.from({ length: 3 }, () => buildSessionCookie(user, context));
    const results = await Promise.all(tokens.slice(0, 2).map(token => request(app).post("/api/auth/logout").set("Cookie", `vndrly_session=${token}`)));
    expect(results.map(result => result.status)).toEqual([200, 200]);
    for (const token of tokens.slice(0, 2)) expect((await request(app).get("/api/auth/me").set("Cookie", `vndrly_session=${token}`)).status).toBe(401);
    const changed = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${tokens[2]}`).send({ currentPassword: password, newPassword: "synthetic-new-password" });
    expect(changed.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tokens[2]}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${changed.body.token}`)).status).toBe(200);
    const legacy = buildTestCookie({ ...decodeSession(changed.body.token)!, sid: undefined });
    expect((await request(app).post("/api/auth/logout").set("Cookie", legacy)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", legacy)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${changed.body.token}`)).status).toBe(200);
    const unavailable = vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("Synthetic database unavailable"); });
    try {
      expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${changed.body.token}`)).status).toBe(503);
    } finally { unavailable.mockRestore(); }
  });
});
