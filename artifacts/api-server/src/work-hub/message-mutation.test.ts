import { describe, expect, it } from "vitest";
import { assertMessageMutationReceipt, assertMessageMutationTarget, canDeleteWorkHubMessage, canManageWorkHubOwner, canModerateWorkHubOwner, type MessageMutationIntent } from "./message-mutation";

const intent: MessageMutationIntent = { action: "update", actorUserId: 7, channelId: "channel", messageId: "message", expectedVersion: 1, body: "Reviewed edit" };
const saved = { id: "message", channelId: "channel", authorUserId: 7, version: 2, body: "Reviewed edit", deletedAt: null };
describe("exact message mutation receipts", () => {
  it("permits exact saved edit and delete replay only", () => {
    expect(() => assertMessageMutationReceipt(intent, saved)).not.toThrow();
    expect(() => assertMessageMutationReceipt({ ...intent, action: "delete", body: undefined }, { ...saved, body: "", deletedAt: "2026-10-07T00:00:00Z", deletedById: 7 })).not.toThrow();
  });
  it.each([{ body: "Different edit" }, { messageId: "other" }, { channelId: "foreign" }, { actorUserId: 8 }, { expectedVersion: 2 }])("refuses reused operation with changed intent %j", change => {
    expect(() => assertMessageMutationReceipt({ ...intent, ...change }, saved)).toThrow();
  });
  it("requires current exact target and author even for historical receipt", () => {
    expect(() => assertMessageMutationTarget(intent, undefined)).toThrow();
    expect(() => assertMessageMutationTarget(intent, { ...saved, authorUserId: 8 })).toThrow();
    expect(() => assertMessageMutationTarget(intent, saved)).not.toThrow();
  });
  it("allows a moderator to delete another author's message without allowing an edit", () => {
    const moderatedDelete: MessageMutationIntent = { ...intent, action: "delete", body: undefined, canDeleteOtherMessages: true };
    const otherAuthor = { ...saved, authorUserId: 8 };
    expect(canDeleteWorkHubMessage({ actorUserId: 7, messageAuthorUserId: 8, canModerate: true })).toBe(true);
    expect(canDeleteWorkHubMessage({ actorUserId: 7, messageAuthorUserId: 8, canModerate: false })).toBe(false);
    expect(() => assertMessageMutationTarget(moderatedDelete, otherAuthor)).not.toThrow();
    expect(() => assertMessageMutationTarget({ ...moderatedDelete, action: "update" }, otherAuthor)).toThrow();
    expect(() => assertMessageMutationReceipt(moderatedDelete, { ...otherAuthor, body: "", version: 2, deletedAt: "2026-10-07T00:00:00Z", deletedById: 7 })).not.toThrow();
  });
  it("requires the deletion receipt to identify the actor who removed the message", () => {
    expect(() => assertMessageMutationReceipt({ ...intent, action: "delete", body: undefined }, { ...saved, body: "", deletedAt: "2026-10-07T00:00:00Z", deletedById: 8 })).toThrow();
  });
  it("grants channel management to admins and vendor office roles, but message moderation only to admins", () => {
    const owner = { type: "vendor" as const, id: 22 };
    expect(canManageWorkHubOwner({ role: "admin" }, owner)).toBe(true);
    expect(canManageWorkHubOwner({ role: "vendor", vendorId: 22, membershipRole: "admin" }, owner)).toBe(true);
    expect(canManageWorkHubOwner({ role: "field_employee", vendorId: 22, vendorRole: "office" }, owner)).toBe(true);
    expect(canManageWorkHubOwner({ role: "field_employee", vendorId: 22, vendorRole: "both" }, owner)).toBe(true);
    expect(canManageWorkHubOwner({ role: "field_employee", vendorId: 23, vendorRole: "office" }, owner)).toBe(false);
    expect(canManageWorkHubOwner({ role: "field_employee", vendorId: 22, vendorRole: "field" }, owner)).toBe(false);
    expect(canModerateWorkHubOwner({ role: "admin" }, owner)).toBe(true);
    expect(canModerateWorkHubOwner({ role: "vendor", vendorId: 22, membershipRole: "admin" }, owner)).toBe(true);
    expect(canModerateWorkHubOwner({ role: "field_employee", vendorId: 22, vendorRole: "office" }, owner)).toBe(false);
  });
});
