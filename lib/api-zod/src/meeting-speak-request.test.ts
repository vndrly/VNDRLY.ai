import { expect, it, vi } from "vitest";
import { saveMeetingSpeakRequest } from "./meeting-speak-request";
const occurrenceId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const receipt = {
  occurrenceId,
  operationId,
  actorUserId: 9,
  actorMembershipId: 3,
  actorSessionVersion: 1,
  ownerOrgType: "vendor",
  ownerOrgId: 4,
  requestId: operationId,
  requestedAt: "2026-10-07T10:00:00Z",
  status: "saved",
  microphoneOpened: false,
  consentAccepted: false,
};
it("recovers a dropped saved response before exact retry without another POST", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ receipt: null })
    .mockRejectedValueOnce(Error("lost response"));
  await expect(
    saveMeetingSpeakRequest(occurrenceId, 9, operationId, request),
  ).rejects.toThrow();
  request.mockResolvedValueOnce({ receipt });
  expect(
    await saveMeetingSpeakRequest(occurrenceId, 9, operationId, request),
  ).toEqual(receipt);
  expect(request.mock.calls.map((c) => c[1].method)).toEqual([
    "GET",
    "POST",
    "GET",
  ]);
  expect(JSON.parse(request.mock.calls[1][1].body!)).toEqual({ operationId });
});
it("denied, malformed and foreign readback never authorize a resend", async () => {
  for (const result of [
    { receipt: { ...receipt, actorUserId: 10 } },
    { receipt: { ...receipt, occurrenceId: operationId } },
    {},
  ]) {
    const request = vi.fn().mockResolvedValue(result);
    await expect(
      saveMeetingSpeakRequest(occurrenceId, 9, operationId, request),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  }
  const denied = vi.fn().mockRejectedValue(Error("403"));
  await expect(
    saveMeetingSpeakRequest(occurrenceId, 9, operationId, denied),
  ).rejects.toThrow();
  expect(denied).toHaveBeenCalledTimes(1);
});
it("read-only recovery after mute release never sends when the original outcome is absent", async () => {
  const request = vi.fn().mockResolvedValue({ receipt: null });
  await expect(saveMeetingSpeakRequest(occurrenceId, 9, operationId, request, false)).rejects.toThrow("unresolved");
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce({ receipt });
  expect(await saveMeetingSpeakRequest(occurrenceId, 9, operationId, request, false)).toEqual(receipt);
  expect(request.mock.calls.every(c => c[1].method === "GET")).toBe(true);
});
