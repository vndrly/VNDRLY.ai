import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { assertIsolatedTestDatabaseEnvironment } from "../../../../scripts/e2e-isolation.mjs";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware } from "../test-utils/route-app";

// Only the final domain action is replaced: authentication, SQL transactions,
// advisory locks, greeting claims, transcripts and reservations are real.
const execute = vi.hoisted(() =>
  vi.fn(async () => JSON.stringify({ ok: true, visitId: 44 })),
);
vi.mock("./assistant", () => ({ runTool: execute }));

const isolated = process.env.VNDRLY_ISOLATED_TEST_DB === "1";
describe.runIf(isolated)("AskV authenticated PostgreSQL persistence", () => {
  let app: express.Express;
  let database: typeof import("@workspace/db");
  let userId: number;
  let otherId: number;
  let cookie: string;
  const tag = randomUUID();

  beforeAll(async () => {
    assertIsolatedTestDatabaseEnvironment(process.env);
    database = await import("@workspace/db");
    const users = await database.db
      .insert(database.usersTable)
      .values([
        {
          username: `askv-db-${tag}`,
          passwordHash: bcrypt.hashSync("synthetic-askv-fixture", 4),
          role: "vendor",
          displayName: "Brian",
        },
        {
          username: `askv-other-${tag}`,
          passwordHash: bcrypt.hashSync("synthetic-askv-fixture", 4),
          role: "vendor",
          displayName: "Other user",
        },
      ])
      .returning({ id: database.usersTable.id });
    userId = users[0].id;
    otherId = users[1].id;
    cookie = buildTestCookie({ userId, role: "vendor", vendorId: 22001 });
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use((await import("./assistantRealtime")).default);
    attachTestErrorMiddleware(app);
    // All fixtures remain in the newly provisioned test database for inspection.
  });

  const post = (path: string, body: object, auth = cookie) =>
    request(app).post(path).set("Cookie", auth).send(body);
  const create = async () =>
    (await post("/assistant/voice/conversation", {}).expect(200)).body
      .conversationId as number;

  it("rejects missing, forged and expired session cookies before creating a conversation", async () => {
    await request(app)
      .post("/assistant/voice/conversation")
      .send({})
      .expect(401);
    await post(
      "/assistant/voice/conversation",
      {},
      buildTestCookie(
        { userId, role: "vendor" },
        { secret: "incorrect-test-secret" },
      ),
    ).expect(401);
    await post(
      "/assistant/voice/conversation",
      {},
      buildTestCookie({ userId, role: "vendor" }, { exp: 1 }),
    ).expect(401);
    const rows = await database.db
      .select()
      .from(database.assistantConversationsTable)
      .where(eq(database.assistantConversationsTable.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("claims a single daily full greeting across simultaneous web and iOS opens", async () => {
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        post("/assistant/voice/greeting", {
          timeZone: "America/Chicago",
        }).expect(200),
      ),
    );
    expect(replies.map((res) => res.body.style).sort()).toEqual([
      "full",
      "short",
      "short",
      "short",
    ]);
    const [user] = await database.db
      .select()
      .from(database.usersTable)
      .where(eq(database.usersTable.id, userId));
    expect(user.askvLastFullGreetingOn).toBe(replies[0].body.localDate);
    expect(
      replies.find((res) => res.body.style === "full")!.body.text,
    ).toContain("Brian");
  });

  it("deduplicates concurrent transcript delivery and hydrates typed and voice history within the original account and organization", async () => {
    const conversationId = await create();
    await database.db
      .insert(database.assistantMessagesTable)
      .values({ conversationId, role: "user", content: "Typed first" });
    const event = {
      conversationId,
      sessionId: `history-${tag}`,
      eventId: "response-1",
      role: "assistant",
      content: "Spoken reply",
    };
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        post("/assistant/voice/transcript", event).expect(200),
      ),
    );
    expect(new Set(replies.map((res) => res.body.messageId)).size).toBe(1);
    const rows = await database.db
      .select()
      .from(database.assistantMessagesTable)
      .where(
        eq(database.assistantMessagesTable.conversationId, conversationId),
      );
    expect(rows).toHaveLength(2);
    const history = await post("/assistant/voice/conversation", {
      conversationId,
    }).expect(200);
    expect(
      history.body.messages.map((row: { content: string }) => row.content),
    ).toEqual(["Typed first", "Spoken reply"]);
    for (const foreign of [
      buildTestCookie({ userId, role: "vendor", vendorId: 22002 }),
      buildTestCookie({ userId: otherId, role: "vendor", vendorId: 22001 }),
    ]) {
      await post(
        "/assistant/voice/conversation",
        { conversationId },
        foreign,
      ).expect(404);
      await post(
        "/assistant/voice/transcript",
        { ...event, eventId: "foreign" },
        foreign,
      ).expect(404);
    }
    await post("/assistant/voice/transcript", {
      ...event,
      eventId: "raw",
      audio: "forbidden",
    }).expect(400);
  });

  it("requires a later persisted user confirmation and executes an approved retry once", async () => {
    execute.mockClear();
    const conversationId = await create();
    const sessionId = `confirm-${tag}`;
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const save = (eventId: string, content: string, sid = sessionId) =>
        post("/assistant/voice/transcript", {
          conversationId,
          sessionId: sid,
          eventId,
          role: "user",
          content,
        }).expect(200);
      const action = {
        sessionId,
        callId: "checkout-1",
        name: "confirm_visitor_check_out",
        arguments: { visitId: 44 },
      };
      await save("old-yes", "yes");
      now++;
      expect(
        (await post("/assistant/realtime/tool-call", action).expect(200)).body
          .requiresConfirmation,
      ).toBe(true);
      expect(
        (
          await post("/assistant/realtime/tool-call", {
            ...action,
            confirmed: true,
            confirmationPhrase: "yes",
          }).expect(200)
        ).body.requiresConfirmation,
      ).toBe(true);
      expect(
        (
          await post("/assistant/realtime/tool-call", {
            ...action,
            confirmationEventId: "old-yes",
          }).expect(200)
        ).body.requiresConfirmation,
      ).toBe(true);
      now++;
      await save("foreign-yes", "yes", `other-${sessionId}`);
      expect(
        (
          await post("/assistant/realtime/tool-call", {
            ...action,
            confirmationEventId: "foreign-yes",
          }).expect(200)
        ).body.requiresConfirmation,
      ).toBe(true);
      now++;
      await save("actual-yes", "Yes.");
      const approved = await post("/assistant/realtime/tool-call", {
        ...action,
        confirmationEventId: "actual-yes",
      }).expect(200);
      expect(approved.body.ok).toBe(true);
      const repeated = await post(
        "/assistant/realtime/tool-call",
        action,
      ).expect(200);
      expect(repeated.body.replayed).toBe(true);
      expect(execute).toHaveBeenCalledOnce();
      const audit = await database.db
        .select()
        .from(database.assistantActionAuditTable)
        .where(eq(database.assistantActionAuditTable.userId, userId));
      expect(
        audit.some(
          (row) =>
            row.confirmationPhrase === "Yes." && row.resultStatus === "success",
        ),
      ).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("replays the PostgreSQL reservation after process-local module state is discarded", async () => {
    const scope = {
      userId,
      organizationKey: "vendor:22001",
      sessionId: `restart-${tag}`,
      key: "operation",
      fingerprint: "visit:44",
    };
    const operation = vi.fn(async () =>
      JSON.stringify({ ok: true, visitId: 44 }),
    );
    const first = await import("../assistant/askv-idempotency");
    const initial = await first.runPersistentAskVMutation(scope, operation);
    expect(initial.hit).toBe(false);
    vi.resetModules();
    const reloaded = await import("../assistant/askv-idempotency");
    const replay = await reloaded.runPersistentAskVMutation(scope, operation);
    expect(replay).toEqual({ hit: true, value: initial.value });
    expect(operation).toHaveBeenCalledOnce();
    await expect(
      reloaded.runPersistentAskVMutation(
        { ...scope, fingerprint: "visit:99" },
        operation,
      ),
    ).rejects.toThrow(/different arguments/);
    expect(operation).toHaveBeenCalledOnce();
  });
});
