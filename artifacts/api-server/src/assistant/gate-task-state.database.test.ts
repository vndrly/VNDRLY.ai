import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { accessGateTask, executeWithGateTask } from "./gate-task-state";
import type { SessionPayload } from "../lib/session";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1")("Gate task PostgreSQL locking and persistence", () => {
  let database: typeof import("@workspace/db");
  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    database = await import("@workspace/db");
  });
  async function fixture() {
    const tag = randomUUID();
    const [vendor] = await database.db.insert(database.vendorsTable).values({ name: `AskV draft ${tag}`, contactName: "Synthetic", contactEmail: `${tag}@example.invalid` }).returning();
    const [user] = await database.db.insert(database.usersTable).values({ username: `draft-${tag}`, passwordHash: "unused-fixture", role: "vendor" }).returning();
    const [conversation] = await database.db.insert(database.assistantConversationsTable).values({ userId: user.id }).returning();
    const session: SessionPayload = { userId: user.id, vendorId: vendor.id, role: "vendor" };
    const fields = { firstName: "Synthetic", lastName: "Driver", siteLocationId: 42, plateState: "TX" };
    await accessGateTask(session, conversation.id, { action: "start", expectedVersion: 0, taskType: "check_in", fields });
    return { session, conversationId: conversation.id, fields };
  }
  it("allows only one correction for the same saved version", async () => {
    const { session, conversationId } = await fixture();
    const results = await Promise.allSettled(["OK", "NM"].map(plateState => accessGateTask(session, conversationId, { action: "correct", expectedVersion: 1, fields: { plateState } })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const restored = await accessGateTask(session, conversationId);
    expect(restored).toMatchObject({ version: 2, fields: { firstName: "Synthetic", lastName: "Driver", siteLocationId: 42 } });
    expect(["OK", "NM"]).toContain(restored?.fields.plateState);
  });
  it("commits reservation before execution and prevents a concurrent second write", async () => {
    const { session, conversationId, fields } = await fixture();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const begun = new Promise<void>(resolve => { started = resolve; });
    let writes = 0;
    const first = executeWithGateTask(session, conversationId, "confirm_visitor_check_in", fields, async () => {
      writes++; started(); await pending;
      return JSON.stringify({ ok: true, visitId: 123 });
    });
    await begun;
    try {
      expect(await accessGateTask(session, conversationId)).toMatchObject({ state: "outcome_unknown" });
      const second = await executeWithGateTask(session, conversationId, "confirm_visitor_check_in", fields, async () => { writes++; return "duplicate"; });
      expect(JSON.parse(second)).toMatchObject({ status: "outcome_unknown" });
    } finally { release(); await first; }
    expect(writes).toBe(1);
    expect(await accessGateTask(session, conversationId)).toMatchObject({ state: "saved", version: 3 });
  });
  it("keeps drafts private to the actor and company", async () => {
    const first = await fixture(), other = await fixture();
    expect(await accessGateTask({ ...first.session, vendorId: other.session.vendorId }, first.conversationId)).toBeNull();
    await expect(accessGateTask(other.session, first.conversationId)).rejects.toThrow("Conversation unavailable");
  });
});
