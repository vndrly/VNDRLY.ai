import { describe, it, expect } from "vitest";
import { db, pool, usersTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { validateAssistantSession, withAssistantGrants } from "./chatgpt-grant-store";
import { ASSISTANT_RESOURCE, CHATGPT_CLIENT_ID, assistantPkceChallenge, assistantTokenHash, issueAssistantCode, exchangeAssistantCode, refreshAssistantTokens } from "./chatgpt-oauth";

// This test never provisions or alters a shared development/production database.
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("durable assistant grant concurrency", () => {
  it("validates authority with a one-connection pool, serializes codes and persists replay revocation", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_oauth_grants jsonb");
    const [user] = await db.insert(usersTable).values({ username: `assistant-test-${randomUUID()}`, passwordHash: "unused-fixture-hash", displayName: "Isolated assistant fixture", role: "admin" }).returning();
    const session = { userId: user.id, role: "admin", sv: user.sessionVersion };
    const verifier = "v".repeat(43);
    const authorization = { clientId: CHATGPT_CLIENT_ID, redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect", resource: ASSISTANT_RESOURCE, challenge: assistantPkceChallenge(verifier), scopes: ["gate:read"] };
    const issued = issueAssistantCode(authorization, session);
    await withAssistantGrants(user.id, async (grants) => { grants.push(issued.grant); });
    const oneConnection = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => withAssistantGrants(user.id, async (grants, database) => {
        await validateAssistantSession(session, database);
        return exchangeAssistantCode(grants[0], { client_id: CHATGPT_CLIENT_ID, redirect_uri: authorization.redirectUri, resource: ASSISTANT_RESOURCE, code: issued.code, code_verifier: verifier });
      }, oneConnection)));
      const successful = results.filter((result) => result.status === "fulfilled");
      expect(successful).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(11);
      const first = successful[0];
      if (first.status !== "fulfilled") throw new Error("Missing successful exchange");
      const args = { client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: first.value.refresh_token };
      await withAssistantGrants(user.id, async (grants) => refreshAssistantTokens(grants[0], args));
      await expect(withAssistantGrants(user.id, async (grants) => refreshAssistantTokens(grants[0], args))).rejects.toThrow();
      await withAssistantGrants(user.id, async (grants) => {
        expect(grants[0].revoked).toBe(true);
        expect(grants[0].previousRefreshHashes).toContain(assistantTokenHash(first.value.refresh_token));
      });
    } finally { await oneConnection.end(); }
  });
});
