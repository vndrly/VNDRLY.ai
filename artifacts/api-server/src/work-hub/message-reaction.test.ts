import { expect, it } from "vitest";
import { messageReactionPayload, reactionActive, assertReactionReceipt, type ReactionIntent } from "./message-reaction";

const intent: ReactionIntent = { actorUserId: 17, channelId: "channel", messageId: "message", emoji: "👍", action: "add", expectedVersion: 2 };
it("uses desired state without toggling an already applied add or remove", () => {
  expect(reactionActive("add", false)).toBe(true);
  expect(reactionActive("add", true)).toBe(true);
  expect(reactionActive("remove", true)).toBe(false);
  expect(reactionActive("remove", false)).toBe(false);
  expect(reactionActive("toggle", true)).toBe(false);
  expect(reactionActive("toggle", false)).toBe(true);
});
it("accepts legacy toggle and rejects unknown action or extra fields", () => {
  expect(messageReactionPayload.parse({ emoji: " 👍 " })).toEqual({ emoji: "👍" });
  expect(() => messageReactionPayload.parse({ emoji: "👍", action: "toggle" })).toThrow();
  expect(() => messageReactionPayload.parse({ emoji: "👍", action: "add", userId: 18 })).toThrow();
});
it("binds the complete receipt to actor, channel, target, emoji, reviewed version and desired state", () => {
  const receipt = { ...intent, active: true };
  expect(() => assertReactionReceipt(intent, receipt)).not.toThrow();
  for (const changed of [{ actorUserId: 18 }, { channelId: "other" }, { messageId: "other" }, { emoji: "✅" }, { action: "remove" }, { expectedVersion: 3 }, { active: false }]) {
    expect(() => assertReactionReceipt(intent, { ...receipt, ...changed })).toThrow("forbidden");
  }
  expect(() => assertReactionReceipt(intent, { active: true, emoji: "👍" })).toThrow();
});
