import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as { userId: number; vendorId: number; partnerId: null; role: string } | null,
  results: [] as unknown[][],
  predicates: [] as SQL[],
  mutations: [] as Array<{ type: string; value?: unknown }>,
  audit: vi.fn(),
  getObject: vi.fn(),
  failCommit: false,
}));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: mocks.audit }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => ({ getObject: mocks.getObject }) }));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  function chain(type: string) {
    const mutation = type === "select" ? undefined : { type, value: undefined as unknown };
    if (mutation) mocks.mutations.push(mutation);
    const query: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "set", "values", "returning", "onConflictDoNothing", "onConflictDoUpdate", "orderBy"]) {
      query[method] = (value: unknown) => {
        if (method === "where") mocks.predicates.push(value as SQL);
        if (mutation && ["set", "values"].includes(method)) mutation.value = value;
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve);
    return query;
  }
  const tx = { select: () => chain("select"), insert: () => chain("insert"), update: () => chain("update") };
  return { ...schema, db: { ...tx, transaction: async (fn: (tx: unknown) => Promise<unknown>) => { const value = await fn(tx); if (mocks.failCommit) throw new Error("commit failed"); return value; } } };
});
import router from "./workHubMeetings";

const meetingId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const messageId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02";
const host = { id: "host", userId: 1, role: "host", removedAt: null, muted: true };
const guest = { id: "guest", userId: 2, role: "participant", removedAt: null, muted: true };
function seed(options: { removed?: boolean; ended?: boolean; invited?: boolean } = {}) {
  mocks.results.push(
    [{ id: meetingId, meetingId, status: options.ended ? "ended" : "live", askvInvitedAt: options.invited ? new Date() : null, runtime: { presence: { 1: { seenAt: Date.now(), joinedAt: Date.now(), speaking: false } } } }],
    [{ id: meetingId, ownerOrgType: "vendor", ownerOrgId: 22, policyVersion: 1 }],
    [{ ...host, removedAt: options.removed ? new Date() : null }, guest],
  );
}
function app() {
  const app = express(); app.use(express.json()); app.use("/meetings", router);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "Transaction failed" }); });
  return app;
}
beforeEach(() => {
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = []; mocks.predicates = []; mocks.mutations = []; mocks.failCommit = false;
  mocks.audit.mockReset(); mocks.getObject.mockReset();
});

describe("meeting lifecycle HTTP boundaries", () => {
  it("requires authentication", async () => {
    mocks.session = null;
    expect((await request(app()).get(`/meetings/${meetingId}/catch-up`)).status).toBe(401);
    expect(mocks.mutations).toEqual([]);
  });
  it.each(["join", "signal", "presence", "transcript", "chat"])("denies removed attendees at %s before any mutation", async (path) => {
    seed({ removed: true });
    expect((await request(app()).post(`/meetings/${meetingId}/${path}`).send({})).status).toBe(403);
    expect(mocks.mutations).toEqual([]);
  });
  it("denies cross-organization access even when an invitation row exists", async () => {
    seed(); mocks.session!.vendorId = 77;
    expect((await request(app()).get(`/meetings/${meetingId}/catch-up`)).status).toBe(403);
  });
  it("rejects transcription until Ask V is invited and consent is accepted", async () => {
    seed(); mocks.results.push([]);
    expect((await request(app()).post(`/meetings/${meetingId}/transcript`).send({ text: "private words", startsAtMs: 0, endsAtMs: 100 })).status).toBe(409);
    expect(mocks.mutations).toEqual([]);
  });
  it("refuses expired policy versions", async () => {
    seed();
    expect((await request(app()).post(`/meetings/${meetingId}/consent`).send({ policyVersion: 2, response: "accepted" })).status).toBe(409);
    expect(mocks.mutations).toEqual([]);
  });
  it("rejects private messages addressed to a person outside the meeting", async () => {
    seed();
    expect((await request(app()).post(`/meetings/${meetingId}/chat`).send({ body: "hello", recipientUserId: 99 })).status).toBe(404);
    expect(mocks.mutations).toEqual([]);
  });
  it("persists a private recipient without changing it into a shared message", async () => {
    seed(); mocks.results.push([{ id: messageId }]);
    expect((await request(app()).post(`/meetings/${meetingId}/chat`).send({ id: messageId, body: "hello", recipientUserId: 2 })).status).toBe(200);
    expect(mocks.mutations[0].value).toMatchObject({ occurrenceId: meetingId, userId: 1, recipientUserId: 2, body: "hello" });
  });
  it("does not acknowledge success when the transaction fails to commit", async () => {
    seed(); mocks.results.push([{ id: messageId }]); mocks.failCommit = true;
    expect((await request(app()).post(`/meetings/${meetingId}/chat`).send({ body: "hello" })).status).toBe(500);
  });
  it("does not allow the host to remove themself", async () => {
    seed();
    expect((await request(app()).post(`/meetings/${meetingId}/participants/1/remove`).send({})).status).toBe(403);
    expect(mocks.mutations).toEqual([]);
  });
  it("annotates removal, preserves records, and records the removal audit", async () => {
    seed(); mocks.results.push([], [], [], [{ name: "Bob" }], []);
    expect((await request(app()).post(`/meetings/${meetingId}/participants/2/remove`).send({})).status).toBe(200);
    expect(mocks.mutations[0].value).toMatchObject({ removedById: 1, muted: true });
    expect(mocks.mutations.at(-1)?.value).toMatchObject({ messageType: "system", body: "Bob was removed by the host." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.participant_removed", metadata: { removedUserId: 2 } }), expect.anything());
  });
  it("denies another pair's private file even to the meeting host", async () => {
    seed(); mocks.results.push([{ id: messageId, userId: 2, recipientUserId: 3, attachment: { storageKey: "private" } }]);
    expect((await request(app()).get(`/meetings/${meetingId}/files/${messageId}`)).status).toBe(404);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });
  it("filters private messages inside the database query and omits raw signalling state", async () => {
    seed(); mocks.results.push([{ id: 1, displayName: "Host" }], [], [], [], [], []);
    const response = await request(app()).get(`/meetings/${meetingId}/catch-up`);
    expect(response.status).toBe(200);
    expect(response.body.occurrence.runtime).toBeUndefined();
    const queries = mocks.predicates.map((value) => new PgDialect().sqlToQuery(value));
    const visibility = queries.find((q) => q.sql.includes('"work_hub_meeting_chat"."recipient_user_id"'));
    expect(visibility?.sql).toContain('"recipient_user_id" is null');
    expect(visibility?.params).toEqual([meetingId, 1, 1]);
  });
});
