import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ results: [] as unknown[][], added: [] as unknown[], deleted: vi.fn(), audit: vi.fn(), access: vi.fn(), validate: vi.fn() }));
vi.mock("@workspace/db", async () => {
  const tx = {
    select: () => { const chain: any = {}; for (const method of ["from", "where", "orderBy", "for"]) chain[method] = () => chain; chain.limit = async () => mock.results.shift() ?? []; chain.then = (resolve: any) => Promise.resolve(mock.results.shift() ?? []).then(resolve); return chain; },
    insert: () => ({ values: (rows: unknown) => { mock.added.push(rows); return { onConflictDoNothing: async () => undefined }; } }),
    delete: () => ({ where: mock.deleted }),
  };
  return { ...await import("@workspace/db/schema"), db: { transaction: (fn: any) => fn(tx) } };
});
vi.mock("./queries", () => ({ resolveChannelAccess: mock.access }));
vi.mock("./audit", () => ({ appendWorkHubAudit: mock.audit }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mock.validate }));
import { changeChatParticipants, chatParticipantChange } from "./chat-participants";
const actor = { userId: 7, role: "vendor", vendorId: 4 } as const;
beforeEach(() => { vi.clearAllMocks(); mock.added = []; mock.results = []; mock.access.mockResolvedValue({ channel: { id: "chat", createdById: 7, contextKind: "chat", ownerOrgType: "vendor", ownerOrgId: 4 } }); mock.validate.mockResolvedValue(undefined); });
it("lets the creator add several company participants and remove selected members", async () => {
  mock.results = [[], [], [{ userId: 8 }, { userId: 9 }]];
  expect(await changeChatParticipants(actor, "chat", { addUserIds: [8,9], removeUserIds: [10] })).toEqual({ saved: true });
  expect(mock.added[0]).toEqual([{ channelId: "chat", userId: 8, mode: "member" }, { channelId: "chat", userId: 9, mode: "member" }]);
  expect(mock.deleted).toHaveBeenCalledTimes(1);
  expect(mock.audit).toHaveBeenCalledTimes(1);
});
it("allows a company admin who is not the creator", async () => {
  mock.results = [[], [{ id: 55 }]];
  await changeChatParticipants({ ...actor, userId: 20 }, "chat", { removeUserIds: [8] });
  expect(mock.deleted).toHaveBeenCalledTimes(1);
});
it.each(["ordinary member", "foreign company", "creator removal", "channel rather than chat", "revoked session"])("rejects %s without writes", async reason => {
  mock.results = [[], []];
  let who = actor as { userId: number; role: "vendor"; vendorId: number };
  let change = { addUserIds: [8], removeUserIds: [] as number[] };
  if (reason === "ordinary member") who = { ...actor, userId: 20 };
  if (reason === "foreign company") mock.results.push([]);
  if (reason === "creator removal") change = { addUserIds: [], removeUserIds: [7] };
  if (reason === "channel rather than chat") mock.access.mockResolvedValue({ channel: { createdById: 7, contextKind: "site" } });
  if (reason === "revoked session") mock.validate.mockRejectedValue(new Error("revoked"));
  await expect(changeChatParticipants(who, "chat", change)).rejects.toThrow();
  expect(mock.added).toEqual([]); expect(mock.deleted).not.toHaveBeenCalled(); expect(mock.audit).not.toHaveBeenCalled();
});
it("rejects conflicting changes and caller-supplied authority", () => {
  expect(chatParticipantChange.safeParse({ addUserIds: [8], removeUserIds: [8] }).success).toBe(false);
  expect(chatParticipantChange.safeParse({ addUserIds: [8], admin: true }).success).toBe(false);
});
