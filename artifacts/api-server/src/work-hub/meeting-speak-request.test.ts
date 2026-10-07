import { expect, it, vi } from "vitest";
import { applyMeetingSpeakRequest } from "./meeting-speak-request";
const occurrenceId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const actor = {
  actorUserId: 9,
  actorMembershipId: 3,
  actorSessionVersion: 1,
  ownerOrgType: "vendor" as const,
  ownerOrgId: 4,
};
it("saved replay returns original request/time and performs no new effect after lost response", async () => {
  let saved: unknown = null;
  const deps = {
    authorize: vi.fn(),
    prior: async () => saved,
    create: vi
      .fn()
      .mockResolvedValue({
        requestId: operationId,
        requestedAt: new Date("2026-10-07T10:00:00Z"),
      }),
    save: vi.fn(async (r) => {
      saved = r;
    }),
  };
  const first = await applyMeetingSpeakRequest(
    occurrenceId,
    actor,
    operationId,
    deps,
  );
  expect(
    await applyMeetingSpeakRequest(occurrenceId, actor, operationId, deps),
  ).toEqual(first);
  expect(deps.create).toHaveBeenCalledTimes(1);
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(deps.authorize).toHaveBeenCalledTimes(2);
  for (const changed of [
    { ...actor, actorSessionVersion: 2 },
    { ...actor, actorMembershipId: 4 },
    { ...actor, ownerOrgId: 5 },
  ])
    await expect(
      applyMeetingSpeakRequest(occurrenceId, changed, operationId, deps),
    ).rejects.toThrow();
  await expect(
    applyMeetingSpeakRequest(operationId, actor, operationId, deps),
  ).rejects.toThrow();
  deps.authorize.mockRejectedValueOnce(Error("revoked"));
  await expect(
    applyMeetingSpeakRequest(occurrenceId, actor, operationId, deps, true),
  ).rejects.toThrow("revoked");
  expect(deps.create).toHaveBeenCalledTimes(1);
});
it("absence readback has no effects and malformed saved receipts fail closed", async () => {
  const deps = {
    authorize: vi.fn(),
    prior: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    save: vi.fn(),
  };
  expect(
    await applyMeetingSpeakRequest(
      occurrenceId,
      actor,
      operationId,
      deps,
      true,
    ),
  ).toBeNull();
  deps.prior.mockResolvedValue({});
  await expect(
    applyMeetingSpeakRequest(occurrenceId, actor, operationId, deps),
  ).rejects.toThrow();
  expect(deps.create).not.toHaveBeenCalled();
});
