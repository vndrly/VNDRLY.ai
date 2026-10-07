import { describe, expect, it } from "vitest";
import { assertMessageMutationReceipt, assertMessageMutationTarget, type MessageMutationIntent } from "./message-mutation";

const intent: MessageMutationIntent = { action: "update", actorUserId: 7, channelId: "channel", messageId: "message", expectedVersion: 1, body: "Reviewed edit" };
const saved = { id: "message", channelId: "channel", authorUserId: 7, version: 2, body: "Reviewed edit", deletedAt: null };
describe("exact message mutation receipts", () => {
  it("permits exact saved edit and delete replay only", () => {
    expect(() => assertMessageMutationReceipt(intent, saved)).not.toThrow();
    expect(() => assertMessageMutationReceipt({ ...intent, action: "delete", body: undefined }, { ...saved, body: "", deletedAt: "2026-10-07T00:00:00Z" })).not.toThrow();
  });
  it.each([{ body: "Different edit" }, { messageId: "other" }, { channelId: "foreign" }, { actorUserId: 8 }, { expectedVersion: 2 }])("refuses reused operation with changed intent %j", change => {
    expect(() => assertMessageMutationReceipt({ ...intent, ...change }, saved)).toThrow();
  });
  it("requires current exact target and author even for historical receipt", () => {
    expect(() => assertMessageMutationTarget(intent, undefined)).toThrow();
    expect(() => assertMessageMutationTarget(intent, { ...saved, authorUserId: 8 })).toThrow();
    expect(() => assertMessageMutationTarget(intent, saved)).not.toThrow();
  });
});
