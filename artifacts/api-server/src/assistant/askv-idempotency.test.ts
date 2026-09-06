import { describe, expect, it } from "vitest";
import {
  AskVIdempotencyStore,
  mutationIdempotencyKey,
} from "./askv-idempotency";
describe("AskV mutation idempotency", () => {
  it("joins concurrent retries before either can perform the write", async () => {
    const store = new AskVIdempotencyStore();
    let writes = 0;
    const write = async () => {
      writes++;
      await Promise.resolve();
      return { visitId: 44 };
    };
    const scope = {
      userId: 10,
      organizationKey: "vendor:22",
      sessionId: "s1",
      key: "c1",
      fingerprint: "args",
    };
    const results = await Promise.all([
      store.run(scope, write),
      store.run(scope, write),
    ]);
    expect(writes).toBe(1);
    expect(results.map((result) => result.value)).toEqual([
      { visitId: 44 },
      { visitId: 44 },
    ]);
    await expect(
      store.run({ ...scope, fingerprint: "changed" }, write),
    ).rejects.toThrow(/different/);
    await store.run({ ...scope, key: "c2" }, write);
    expect(writes).toBe(2);
  });
  it("canonicalizes argument order", () => {
    expect(mutationIdempotencyKey(10, "tool", { a: 1, b: 2 })).toBe(
      mutationIdempotencyKey(10, "tool", { b: 2, a: 1 }),
    );
  });
  it("does not share results across users", () => {
    const store = new AskVIdempotencyStore();
    store.remember(10, "same-key", { visitId: 1 });
    expect(store.peek(11, "same-key")).toBeUndefined();
    expect(store.remember(10, "same-key", { visitId: 99 }).value).toEqual({
      visitId: 1,
    });
  });
});
