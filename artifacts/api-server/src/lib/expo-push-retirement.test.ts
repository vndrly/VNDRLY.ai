import { afterEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const io = vi.hoisted(() => ({ where: vi.fn() }));
vi.mock("@workspace/db", async () => ({
  ...await import("../../../../lib/db/src/schema/index"),
  db: { select: () => ({ from: () => ({ where: io.where }) }) },
}));
import { sendPushToUser } from "./expo-push";
afterEach(() => vi.unstubAllGlobals());
it("filters retirement-pending registrations in the actual legacy sender query", async () => {
  io.where.mockImplementation(async condition => {
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"retirement_pending" =');
    expect(query.params).toEqual([7, false]);
    return [];
  });
  vi.stubGlobal("fetch", vi.fn());
  expect(await sendPushToUser(7, { title: "private", body: "private" })).toEqual({ delivered: false, recipientCount: 0 });
  expect(fetch).not.toHaveBeenCalled();
});
it("still sends to active registrations", async () => {
  io.where.mockResolvedValue([{ token: "ExponentPushToken[active]" }]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok" }] }))));
  expect(await sendPushToUser(7, { title: "private", body: "private" })).toEqual({ delivered: true, recipientCount: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
