import { expect, it, vi } from "vitest";
import { saveMeetingAssistantInvitation } from "./meeting-assistant-invitation";
const id = "11111111-1111-4111-8111-111111111111",
  body = {
    operationId: "22222222-2222-4222-8222-222222222222",
    expectedVersion: 0,
    invited: true,
  };
const receipt = {
  ...body,
  occurrenceId: id,
  actorUserId: 9,
  actorMembershipId: 5,
  actorSessionVersion: 1,
  ownerOrgType: "vendor",
  ownerOrgId: 4,
  fingerprint: "a".repeat(64),
  version: 1,
  status: "applied",
  changed: true,
  recordedAt: "2026-10-07T10:00:00Z",
  consentAccepted: false,
  deviceCaptureStarted: false,
};
it("readbacks exact saved operation before attempting same body; never repeats saved POST", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ receipt: null })
    .mockRejectedValueOnce(Error("dropped"));
  await expect(
    saveMeetingAssistantInvitation(id, body, request),
  ).rejects.toThrow("dropped");
  request.mockResolvedValueOnce({ receipt });
  expect(await saveMeetingAssistantInvitation(id, body, request)).toEqual(
    receipt,
  );
  expect(request.mock.calls.filter(([, i]) => i.method === "POST")).toEqual([
    [
      "/meetings/" + id + "/askv",
      { method: "POST", body: JSON.stringify(body) },
    ],
  ]);
});
it.each([401, 403, 404])(
  "denied readback %s cannot authorize a resend",
  async (status) => {
    const request = vi
      .fn()
      .mockRejectedValue(Object.assign(Error("denied"), { status }));
    await expect(
      saveMeetingAssistantInvitation(id, body, request),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  },
);
it("rejects wrong exact response target/version/state", async () => {
  for (const changed of [
    { occurrenceId: "33333333-3333-4333-8333-333333333333" },
    { invited: false },
    { version: 2 },
  ]) {
    const request = vi
      .fn()
      .mockResolvedValue({ receipt: { ...receipt, ...changed } });
    await expect(
      saveMeetingAssistantInvitation(id, body, request),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  }
});
