import { expect, it } from "vitest";
import {
  matchAwayReceipt,
  storeAwayAttempt,
  loadAwayAttempt,
} from "./work-hub-away-client";
const id = "00000000-0000-4000-8000-000000000001";
const command = {
  operationId: id,
  action: "configure" as const,
  expectedVersion: 0,
  startsAt: "2026-10-07T12:00:00Z",
  endsAt: "2026-10-08T12:00:00Z",
  replyText: "I will review your message when I return.",
  channelIds: [id],
};
const attempt = {
  identity: "17:vendor:4:12",
  actorId: 17,
  owner: { type: "vendor" as const, id: 4 },
  command,
};
const receipt = {
  operationId: id,
  fingerprint: "a".repeat(64),
  status: "configured",
  rule: {
    id,
    version: 1,
    userId: 17,
    owner: attempt.owner,
    status: "active",
    startsAt: command.startsAt,
    endsAt: command.endsAt,
    replyText: command.replyText,
    channelIds: command.channelIds,
    configuredAt: command.startsAt,
    updatedAt: command.startsAt,
  },
  savedAt: command.startsAt,
  providerDeliveryVerified: false,
};
it("accepts only the exact operation, current identity and reviewed literal command receipt", () => {
  expect(matchAwayReceipt(receipt, attempt)).toEqual(receipt);
  for (const patch of [
    { operationId: "00000000-0000-4000-8000-000000000002" },
    { providerDeliveryVerified: true },
    { rule: { ...receipt.rule, version: 2 } },
    { rule: { ...receipt.rule, userId: 99 } },
    { rule: { ...receipt.rule, replyText: "different" } },
    { rule: { ...receipt.rule, owner: { type: "vendor", id: 99 } } },
  ])
    expect(() => matchAwayReceipt({ ...receipt, ...patch }, attempt)).toThrow();
});
it("retains the immutable request under its original identity and refuses another account's pending body", () => {
  const entries = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => entries.set(key, value),
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => entries.delete(key),
  };
  const localAttempt = structuredClone(attempt);
  storeAwayAttempt(storage, localAttempt);
  localAttempt.command.replyText = "later edited local value";
  expect(loadAwayAttempt(storage, attempt.identity)?.command).toMatchObject({
    operationId: id,
    expectedVersion: 0,
    replyText: receipt.rule.replyText,
  });
  expect(loadAwayAttempt(storage, "99:vendor:4:12")).toBeNull();
});
