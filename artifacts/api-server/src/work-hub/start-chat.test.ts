import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ results: [] as any[], inserts: [] as any[], validate: vi.fn() }));
vi.mock("@workspace/db", async () => {
  const tx = {
    execute: vi.fn(),
    select: () => { const chain: any = {}; for (const method of ["from", "where", "for"]) chain[method] = () => chain; chain.limit = async () => mock.results.shift() ?? []; chain.then = (resolve: any) => Promise.resolve(mock.results.shift() ?? []).then(resolve); return chain; },
    insert: () => ({ values: (value: any) => { mock.inserts.push(value); return { returning: async () => [{ id: "new" }] }; } }),
  };
  return { ...await import("@workspace/db/schema"), db: { transaction: (fn: any) => fn(tx) } };
});
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mock.validate }));
import { startChat } from "./start-chat";
const actor = { userId: 7, role: "vendor", vendorId: 4 } as const;
const operationId = "370d6c0c-0800-4d94-91c7-b88cb8810371";
beforeEach(() => { mock.inserts = []; mock.results = []; mock.validate.mockReset().mockResolvedValue(actor); });
it.each([{ ids: [8] }, { ids: [8,9] }])("atomically creates the exact members $ids and creator without messages", async ({ ids }) => {
  mock.results = [[{ userId: 7 }, { userId: 8 }, { userId: 9 }], [], [{ id: 8, displayName: "Isaac" }]];
  await startChat(actor, { participantUserIds: ids, name: "Watch", operationId });
  expect(mock.inserts[0]).toMatchObject({ name: "Watch", contextKind: "chat", visibility: "private" });
  expect(mock.inserts[2].map((m: any) => m.userId)).toEqual([7, ...ids]);
  expect(mock.inserts).toHaveLength(3);
});
it("reuses a retried operation without adding anyone", async () => {
  mock.results = [[{ userId: 7 }, { userId: 8 }], [{ id: "existing" }]];
  expect(await startChat(actor, { participantUserIds: [8], operationId })).toEqual({ channel: { id: "existing" } });
  expect(mock.inserts).toHaveLength(0);
});
it("rejects non-company participants before writes", async () => {
  mock.results = [[{ userId: 7 }]];
  await expect(startChat(actor, { participantUserIds: [8], operationId })).rejects.toThrow();
  expect(mock.inserts).toHaveLength(0);
});
