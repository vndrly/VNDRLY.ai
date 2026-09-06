import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import router from "./assistantRealtime";
import { runTool } from "./assistant";
type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  session: { userId: 10, role: "vendor", vendorId: 22 } as Row,
  rows: {
    conversations: [],
    messages: [],
    audits: [],
    users: [],
    onboarding: [],
  } as Record<string, Row[]>,
  tail: Promise.resolve() as Promise<unknown>,
}));
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => state.session,
}));
vi.mock("./assistant", () => ({
  runTool: vi.fn(async () => JSON.stringify({ ok: true })),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ column, value }),
  ne: (column: string, value: unknown) => ({ column, value, ne: true }),
  isNull: (column: string) => ({ column, value: null }),
  and: (...conditions: unknown[]) => ({ conditions }),
  or: (...conditions: unknown[]) => ({ conditions, or: true }),
  desc: (column: string) => ({ column, descending: true }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  }),
}));
vi.mock("@workspace/db", () => {
  const tables: Record<string, Row> = {};
  for (const name of [
    "conversations",
    "messages",
    "audits",
    "users",
    "onboarding",
  ]) {
    tables[name] = new Proxy(
      { tableName: name },
      {
        get: (target, key) =>
          key === "tableName" ? target.tableName : String(key),
      },
    );
  }
  function matches(row: Row, condition: Row): boolean {
    if (!condition) return true;
    if (condition.conditions)
      return condition.or
        ? condition.conditions.some((c: Row) => matches(row, c))
        : condition.conditions.every((c: Row) => matches(row, c));
    if (condition.sql)
      return condition.sql.includes("voiceSessionId")
        ? row.toolCalls?.voiceSessionId === condition.values[1]
        : row.toolCalls?.voiceEventKey === condition.values[1];
    return condition.ne
      ? row[condition.column] !== condition.value
      : (row[condition.column] ?? null) === condition.value;
  }
  const db: Row = {
    execute: async () => undefined,
    select: () => ({
      from: (table: Row) => {
        let condition: Row;
        let descending = false;
        const rows = () =>
          state.rows[table.tableName]
            .filter((row) => matches(row, condition))
            .sort((a, b) => (descending ? b.id - a.id : a.id - b.id));
        const query = {
          where: (c: Row) => {
            condition = c;
            return query;
          },
          limit: async (n: number) => rows().slice(0, n),
          orderBy: (...order: Row[]) => {
            descending = order.some((o) => o?.descending);
            return query;
          },
          then: (
            resolve: (rows: Row[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve(rows()).then(resolve, reject),
        };
        return query;
      },
    }),
    insert: (table: Row) => ({
      values: (value: Row) => {
        const row = { ...value, id: state.rows[table.tableName].length + 1 };
        state.rows[table.tableName].push(row);
        return { returning: async () => [row] };
      },
    }),
    update: (table: Row) => ({
      set: (value: Row) => ({
        where: (condition: Row) => {
          const rows = state.rows[table.tableName].filter((row) =>
            matches(row, condition),
          );
          rows.forEach((row) => Object.assign(row, value));
          return { returning: async () => rows };
        },
      }),
    }),
  };
  db.transaction = (operation: (tx: Row) => Promise<unknown>) => {
    const result = state.tail.then(() => operation(db));
    state.tail = result.catch(() => undefined);
    return result;
  };
  return {
    db,
    usersTable: tables.users,
    onboardingProgressTable: tables.onboarding,
    assistantConversationsTable: tables.conversations,
    assistantMessagesTable: tables.messages,
    assistantActionAuditTable: tables.audits,
  };
});
function app() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
beforeEach(() => {
  vi.mocked(runTool).mockClear();
  state.session = { userId: 10, role: "vendor", vendorId: 22 };
  for (const key of Object.keys(state.rows)) state.rows[key] = [];
  state.rows.users.push({
    id: 10,
    displayName: "Brian",
    askvLastFullGreetingOn: null,
  });
  state.tail = Promise.resolve();
});
describe("voice approval from authenticated persisted user turns", () => {
  it("rejects model phrases, old or foreign-session events, then approves and deduplicates a later exact user confirmation", async () => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const created = await request(app())
        .post("/assistant/voice/conversation")
        .send({});
      const conversationId = created.body.conversationId;
      const sessionId = "transcript-confirmation";
      const save = (eventId: string, content: string, sid = sessionId) =>
        request(app())
          .post("/assistant/voice/transcript")
          .send({
            conversationId,
            sessionId: sid,
            eventId,
            role: "user",
            content,
          })
          .expect(200);
      const action = {
        sessionId,
        callId: "exact-1",
        name: "confirm_visitor_check_out",
        arguments: { visitId: 44 },
      };
      await save("old-yes", "yes");
      now++;
      await request(app())
        .post("/assistant/realtime/tool-call")
        .send(action)
        .expect(200);
      const modelOnly = await request(app())
        .post("/assistant/realtime/tool-call")
        .send({ ...action, confirmed: true, confirmationPhrase: "yes" });
      expect(modelOnly.body.requiresConfirmation).toBe(true);
      const old = await request(app())
        .post("/assistant/realtime/tool-call")
        .send({ ...action, confirmationEventId: "old-yes" });
      expect(old.body.requiresConfirmation).toBe(true);
      now++;
      await save("foreign-yes", "yes", "different-voice-session");
      const foreign = await request(app())
        .post("/assistant/realtime/tool-call")
        .send({ ...action, confirmationEventId: "foreign-yes" });
      expect(foreign.body.requiresConfirmation).toBe(true);
      now++;
      await save("new-yes", "yes");
      now++;
      await save("correction", "Wait, use the other visitor");
      const superseded = await request(app())
        .post("/assistant/realtime/tool-call")
        .send({
          ...action,
          confirmationEventId: "new-yes",
          confirmationPhrase: "yes",
        });
      expect(superseded.body.requiresConfirmation).toBe(true);
      const fabricated = await request(app())
        .post("/assistant/realtime/tool-call")
        .send({
          ...action,
          confirmationEventId: "correction",
          confirmationPhrase: "yes",
        });
      expect(fabricated.body.requiresConfirmation).toBe(true);
      expect(runTool).not.toHaveBeenCalled();
      now++;
      await save("actual-yes", "Yes.");
      const accepted = await request(app())
        .post("/assistant/realtime/tool-call")
        .send({ ...action, confirmationEventId: "actual-yes" })
        .expect(200);
      expect(accepted.body.ok).toBe(true);
      const retry = await request(app())
        .post("/assistant/realtime/tool-call")
        .send(action)
        .expect(200);
      expect(retry.body.replayed).toBe(true);
      expect(runTool).toHaveBeenCalledOnce();
    } finally {
      clock.mockRestore();
    }
  });
  it("cannot rebind a voice session to another permitted conversation", async () => {
    const first = await request(app())
      .post("/assistant/voice/conversation")
      .send({});
    const second = await request(app())
      .post("/assistant/voice/conversation")
      .send({});
    const transcript = {
      sessionId: "immutable-conversation",
      eventId: "event1",
      role: "user",
      content: "hello",
    };
    await request(app())
      .post("/assistant/voice/transcript")
      .send({ ...transcript, conversationId: first.body.conversationId })
      .expect(200);
    await request(app())
      .post("/assistant/voice/transcript")
      .send({ ...transcript, conversationId: second.body.conversationId })
      .expect(409);
  });
});
describe("AskV voice conversation persistence", () => {
  it("stores numeric-only voice metrics once and refuses another organization's conversation", async () => {
    const created = await request(app())
      .post("/assistant/voice/conversation")
      .send({});
    const metric = {
      conversationId: created.body.conversationId,
      sessionId: "metrics-session",
      eventId: "response-1",
      event: "turn",
      clientSurface: "ios",
      durationMs: 500,
      usage: {
        inputTextTokens: 100,
        inputAudioTokens: 200,
        cachedTextTokens: 0,
        cachedAudioTokens: 0,
        outputTextTokens: 10,
        outputAudioTokens: 20,
      },
    };
    const first = await request(app())
      .post("/assistant/voice/metrics")
      .send(metric)
      .expect(200);
    expect(first.body.duplicate).toBe(false);
    const repeated = await request(app())
      .post("/assistant/voice/metrics")
      .send(metric)
      .expect(200);
    expect(repeated.body.duplicate).toBe(true);
    const rows = state.rows.audits.filter(
      (row) => row.toolName === "askv_voice_metric",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].parsedIntent).toMatchObject({
      event: "turn",
      durationMs: 500,
    });
    expect(rows[0]).not.toHaveProperty("transcriptText");
    await request(app())
      .post("/assistant/voice/metrics")
      .send({ ...metric, eventId: "bad", transcript: "private words" })
      .expect(400);
    state.session.vendorId = 99;
    await request(app())
      .post("/assistant/voice/metrics")
      .send({ ...metric, eventId: "other-org" })
      .expect(404);
  });
  it("hydrates typed and voice turns together and deduplicates repeated transcript events", async () => {
    const created = await request(app())
      .post("/assistant/voice/conversation")
      .send({})
      .expect(200);
    const id = created.body.conversationId;
    state.rows.messages.push({
      id: 1,
      conversationId: id,
      role: "user",
      content: "Typed first",
    });
    const event = {
      conversationId: id,
      sessionId: "s1",
      eventId: "e1",
      role: "assistant",
      content: "Spoken reply",
    };
    const responses = await Promise.all([
      request(app()).post("/assistant/voice/transcript").send(event),
      request(app()).post("/assistant/voice/transcript").send(event),
    ]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(responses[0].body.messageId).toBe(responses[1].body.messageId);
    expect(state.rows.messages).toHaveLength(2);
    const history = await request(app())
      .post("/assistant/voice/conversation")
      .send({ conversationId: id });
    expect(
      history.body.messages.map((message: Row) => message.content),
    ).toEqual(["Typed first", "Spoken reply"]);
  });
  it("cannot hydrate or append another user or organization conversation", async () => {
    const created = await request(app())
      .post("/assistant/voice/conversation")
      .send({});
    const id = created.body.conversationId;
    state.session.vendorId = 23;
    await request(app())
      .post("/assistant/voice/conversation")
      .send({ conversationId: id })
      .expect(404);
    await request(app())
      .post("/assistant/voice/transcript")
      .send({
        conversationId: id,
        sessionId: "s1",
        eventId: "e1",
        role: "user",
        content: "hello",
      })
      .expect(404);
    state.session = { userId: 11, role: "vendor", vendorId: 22 };
    await request(app())
      .post("/assistant/voice/conversation")
      .send({ conversationId: id })
      .expect(404);
    expect(state.rows.messages).toHaveLength(0);
  });
  it("atomically claims the full daily greeting across web and iOS opens", async () => {
    const responses = await Promise.all([
      request(app())
        .post("/assistant/voice/greeting")
        .send({ timeZone: "America/Chicago" }),
      request(app())
        .post("/assistant/voice/greeting")
        .send({ timeZone: "America/Chicago" }),
    ]);
    expect(responses.map((res) => res.body.style).sort()).toEqual([
      "full",
      "short",
    ]);
    expect(state.rows.users[0].askvLastFullGreetingOn).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
