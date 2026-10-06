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

it("sends a Work Hub message with sound to every active device registration", async () => {
  io.where.mockImplementation(async condition => {
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.params).toEqual([7, false]);
    return [{ token: "ExponentPushToken[phone]" }, { token: "ExponentPushToken[tablet]" }];
  });
  const sender = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "ok" }] })));
  vi.stubGlobal("fetch", sender);
  expect(await sendPushToUser(7, { title: "New Work Hub message", body: "Synthetic message", data: { type: "work_hub_message" } }))
    .toEqual({ delivered: true, recipientCount: 2 });
  const sent = JSON.parse(String(sender.mock.calls[0]?.[1]?.body));
  expect(sent).toEqual([
    expect.objectContaining({ to: "ExponentPushToken[phone]", sound: "vndrly_bell_ring.wav", data: { type: "work_hub_message" } }),
    expect.objectContaining({ to: "ExponentPushToken[tablet]", sound: "vndrly_bell_ring.wav", data: { type: "work_hub_message" } }),
  ]);
});
it("does not claim all-device acceptance when one notification is rejected", async () => {
  io.where.mockResolvedValue([{ token: "ExponentPushToken[phone]" }, { token: "ExponentPushToken[tablet]" }]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "error" }] }))));
  expect(await sendPushToUser(7, { title: "New Work Hub message", body: "Synthetic message", data: { type: "work_hub_message" } }))
    .toEqual({ delivered: false, recipientCount: 2 });
});
