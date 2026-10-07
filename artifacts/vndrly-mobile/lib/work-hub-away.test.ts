import { describe, expect, it, vi } from "vitest";
import { makeAwayAttempt, submitAwayAttempt } from "./work-hub-away";
const operationId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const actor = { userId: 17, owner: { type: "vendor" as const, id: 4 } };
const input = {
  action: "configure" as const,
  operationId,
  expectedVersion: 3,
  startsAt: "2026-10-08T10:00:00.000Z",
  endsAt: "2026-10-09T10:00:00.000Z",
  replyText: "I am away. I will reply when available.",
  channelIds: [channelId],
};
const rule = {
  id: operationId,
  version: 4,
  userId: 17,
  owner: actor.owner,
  status: "active",
  startsAt: input.startsAt,
  endsAt: input.endsAt,
  replyText: input.replyText,
  channelIds: [channelId],
  configuredAt: input.startsAt,
  updatedAt: input.startsAt,
};
const receipt = {
  operationId,
  fingerprint: "a".repeat(64),
  status: "configured",
  rule,
  savedAt: input.startsAt,
  providerDeliveryVerified: false,
};
describe("native exact away setting commands", () => {
  it("refuses unselected channels and oversized windows before creating a request", () => {
    expect(() =>
      makeAwayAttempt(input, actor, [], Date.parse("2026-10-07T10:00:00Z")),
    ).toThrow();
    expect(() =>
      makeAwayAttempt(
        { ...input, endsAt: "2026-12-09T10:00:00.000Z" },
        actor,
        [channelId],
        Date.parse("2026-10-07T10:00:00Z"),
      ),
    ).toThrow();
  });
  it("recovers the exact receipt before a retained retry and never resends a saved command", async () => {
    const attempt = makeAwayAttempt(
      input,
      actor,
      [channelId],
      Date.parse("2026-10-07T10:00:00Z"),
    );
    const api = vi.fn(async (_path: string) => ({ receipt }));
    expect(await submitAwayAttempt(attempt, true, api, () => true)).toEqual(
      receipt,
    );
    expect(api).toHaveBeenCalledOnce();
    expect(api.mock.calls[0][0]).toContain(operationId);
  });
  it("retries identical original body only after authorized exact not-found", async () => {
    const attempt = makeAwayAttempt(
      input,
      actor,
      [channelId],
      Date.parse("2026-10-07T10:00:00Z"),
    );
    const api = vi
      .fn()
      .mockResolvedValueOnce({ receipt: null })
      .mockResolvedValueOnce(receipt);
    await submitAwayAttempt(attempt, true, api, () => true);
    expect(api.mock.calls[1][1].body).toBe(attempt.body);
  });
  it("does not resend after denied readback or an account change", async () => {
    const attempt = makeAwayAttempt(
      input,
      actor,
      [channelId],
      Date.parse("2026-10-07T10:00:00Z"),
    );
    const api = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(Error("Denied"), { status: 403 }));
    await expect(
      submitAwayAttempt(attempt, true, api, () => true),
    ).rejects.toThrow();
    expect(api).toHaveBeenCalledOnce();
    api.mockReset().mockResolvedValue({ receipt: null });
    let current = true;
    api.mockImplementation(async () => {
      current = false;
      return { receipt: null };
    });
    await expect(
      submitAwayAttempt(attempt, true, api, () => current),
    ).rejects.toThrow();
    expect(api).toHaveBeenCalledOnce();
  });
  it("rejects a different owner, changed reply or wrong receipt version", async () => {
    const attempt = makeAwayAttempt(
      input,
      actor,
      [channelId],
      Date.parse("2026-10-07T10:00:00Z"),
    );
    for (const altered of [
      { ...rule, owner: { type: "vendor", id: 99 } },
      { ...rule, replyText: "Altered" },
      { ...rule, version: 5 },
    ]) {
      await expect(
        submitAwayAttempt(
          attempt,
          false,
          vi.fn(async () => ({ ...receipt, rule: altered })),
          () => true,
        ),
      ).rejects.toThrow();
    }
  });
});
