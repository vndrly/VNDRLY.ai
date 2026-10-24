import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), access: vi.fn(), actor: { userId: 7 } as { userId: number } | null }));
vi.mock("@workspace/db", async () => ({ ...await import("@workspace/db/schema"), db: { select: mocks.select, insert: mocks.insert } }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.actor }));
vi.mock("../work-hub/queries", () => ({ resolveChannelAccess: mocks.access }));
import router, { unreadFor } from "./workHubUnread";
import { WorkHubAccessError } from "../work-hub/context-access";
const channel = "11111111-1111-4111-8111-111111111111";
const message = "22222222-2222-4222-8222-222222222222";
const app = express().use(express.json()).use(router);
function result(rows: unknown[]) {
  const chain: any = { then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  for (const method of ["from", "where", "leftJoin", "orderBy", "limit", "offset"]) chain[method] = vi.fn(() => chain);
  return chain;
}
beforeEach(() => { vi.clearAllMocks(); mocks.actor = { userId: 7 }; mocks.access.mockResolvedValue({}); });
it("requires authentication and channel access before reading", async () => {
  mocks.actor = null;
  expect((await request(app).get(`/work-hub/channels/${channel}/unread`)).status).toBe(401);
  mocks.actor = { userId: 7 };
  mocks.access.mockRejectedValue(new WorkHubAccessError("forbidden"));
  expect((await request(app).get(`/work-hub/channels/${channel}/unread`)).status).toBe(403);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("returns a ten-message page without any write and clamps an exhausted page", async () => {
  const rows = result([{ id: message, body: "Mock" }]);
  mocks.select.mockReturnValueOnce(result([{ total: 11 }])).mockReturnValueOnce(rows);
  const response = await request(app).get(`/work-hub/channels/${channel}/unread?page=9`);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ page: 1, total: 11, hasNext: false });
  expect(rows.limit).toHaveBeenCalledWith(10);
  expect(rows.offset).toHaveBeenCalledWith(10);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("rejects invalid pagination and foreign or missing messages", async () => {
  expect((await request(app).get(`/work-hub/channels/${channel}/unread?page=-1`)).status).toBe(400);
  mocks.select.mockReturnValue(result([]));
  expect((await request(app).put(`/work-hub/channels/${channel}/messages/${message}/read`).send({})).status).toBe(404);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("stores only the selected message and authenticated reader without advancing the cursor", async () => {
  mocks.select.mockReturnValue(result([{ id: message }]));
  const update = vi.fn().mockResolvedValue(undefined), values = vi.fn(() => ({ onConflictDoUpdate: update }));
  mocks.insert.mockReturnValue({ values });
  const response = await request(app).put(`/work-hub/channels/${channel}/messages/${message}/read`).send({ userId: 99 });
  expect(response.status).toBe(200);
  expect(values).toHaveBeenCalledWith({ messageId: message, metadata: { previewReadBy: { "7": true } } });
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  const merge = new PgDialect().sqlToQuery(update.mock.calls[0][0].set.metadata);
  expect(merge.sql).toContain("jsonb_set");
  expect(merge.params).toContain('{"7":true}');
});
it("counts only messages after the cursor and excludes individual reads, own messages, and deletions", () => {
  const query = new PgDialect().sqlToQuery(unreadFor(channel, 7));
  expect(query.sql).toContain("previewReadBy");
  expect(query.sql).toContain("seen_at >=");
  expect(query.sql).toContain('"deleted_at" IS NULL');
  expect(query.sql).toContain('"author_user_id" <>');
  expect(query.params).toContain("7");
});
