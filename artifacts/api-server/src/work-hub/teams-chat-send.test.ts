import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), select: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: mocks, workHubClientOperationsTable: { id: "id", userId: "userId", commandKind: "command", operationId: "operation", appliedAt: "applied" }, workHubAuditLogTable: {} }));
vi.mock("./teams-graph", async importOriginal => ({ ...await importOriginal<typeof import("./teams-graph")>(), sendTeamsMessage: mocks.send }));
import { chatFingerprint, deliverTeamsChat, replayChatOperation } from "./teams-chat-send";
const session = { userId: 10, vendorId: 20 };
const operationId = "cc7c024e-bbce-4c39-861e-bfb916087fd8";
beforeEach(() => vi.resetAllMocks());
function select(value: unknown[]) { mocks.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => value }) }) }); }
describe("Teams chat durable delivery", () => {
  it("replays a completed send without contacting Microsoft again", async () => {
    const resultJson = { fingerprint: chatFingerprint("connection", "chat", "hello"), state: "sent", messageId: "message" };
    mocks.insert.mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) });
    select([{ ownerOrgType: "vendor", ownerOrgId: 20, resultJson }]);
    expect(await deliverTeamsChat(session, "connection", "token", "chat", "hello", operationId)).toEqual({ messageId: "message", status: "sent", replayed: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps an interrupted claimed send uncertain instead of sending twice", async () => {
    const resultJson = { fingerprint: chatFingerprint("connection", "chat", "hello"), state: "sending" };
    mocks.insert.mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) });
    select([{ ownerOrgType: "vendor", ownerOrgId: 20, resultJson }]);
    expect((await deliverTeamsChat(session, "connection", "token", "chat", "hello", operationId)).status).toBe("uncertain");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects operation reuse for another organization or payload", async () => {
    mocks.insert.mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) });
    select([{ ownerOrgType: "vendor", ownerOrgId: 99, resultJson: {} }]);
    await expect(deliverTeamsChat(session, "connection", "token", "chat", "hello", operationId)).rejects.toMatchObject({ code: "operation_conflict" });
    expect(() => replayChatOperation({ fingerprint: chatFingerprint("other", "chat", "hello"), state: "sent" }, chatFingerprint("connection", "chat", "hello"))).toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
