import { it, expect, vi } from "vitest";
import { addWorkHubChannelMember } from "./work-hub-channel-member";
const channelId = "11111111-1111-4111-8111-111111111111",
  member = {
    id: "22222222-2222-4222-8222-222222222222",
    userId: 7,
    email: "Synthetic@example.invalid",
    displayName: "Synthetic",
    mode: "owner",
  },
  attempt = { channelId, email: "synthetic@example.invalid" };
it("reconciles dropped POST from fresh membership without reposting or downgrading owner", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ canManage: true })
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(Error("dropped"))
    .mockResolvedValueOnce({ canManage: true })
    .mockResolvedValueOnce([member]);
  await expect(
    addWorkHubChannelMember(attempt, { request, assertCurrent: () => {} }),
  ).rejects.toThrow("dropped");
  expect(
    await addWorkHubChannelMember(attempt, {
      request,
      assertCurrent: () => {},
    }),
  ).toEqual({ member, evidence: "current_membership" });
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});
it("denied lookup or lost account cannot send a member mutation", async () => {
  const request = vi.fn().mockRejectedValueOnce(Error("403"));
  await expect(
    addWorkHubChannelMember(attempt, { request, assertCurrent: () => {} }),
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
  let current = true;
  request.mockReset().mockImplementation(async () => {
    current = false;
    return { canManage: true };
  });
  await expect(
    addWorkHubChannelMember(attempt, {
      request,
      assertCurrent: () => {
        if (!current) throw Error("account");
      },
    }),
  ).rejects.toThrow("account");
  expect(request).toHaveBeenCalledOnce();
});
it("only posts exact reviewed email after fresh access and absence, then verifies same channel/member", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ canManage: true })
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce({ ...member, channelId })
    .mockResolvedValueOnce([member]);
  await addWorkHubChannelMember(attempt, { request, assertCurrent: () => {} });
  expect(request.mock.calls[2]).toEqual([
    "/api/work-hub/channels/" + channelId + "/members",
    { method: "POST", body: JSON.stringify({ email: attempt.email }) },
  ]);
  const bad = vi
    .fn()
    .mockResolvedValueOnce({ canManage: true })
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce({
      ...member,
      channelId: "33333333-3333-4333-8333-333333333333",
    });
  await expect(
    addWorkHubChannelMember(attempt, { request: bad, assertCurrent: () => {} }),
  ).rejects.toThrow("unverified_member");
});
it("canonical manage denial prevents adding even a visible member", async () => {
  const request = vi.fn().mockResolvedValue({ canManage: false });
  await expect(
    addWorkHubChannelMember(attempt, { request, assertCurrent: () => {} }),
  ).rejects.toThrow("channel_management_unavailable");
  expect(request).toHaveBeenCalledOnce();
});

it("refuses a post-response membership with substituted email or mode", async () => {
  for (const replacement of [
    { ...member, email: "different@example.invalid" },
    { ...member, mode: "member" },
  ]) {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ canManage: true })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ ...member, channelId })
      .mockResolvedValueOnce([replacement]);
    await expect(
      addWorkHubChannelMember(attempt, { request, assertCurrent: () => {} }),
    ).rejects.toThrow("unverified_member");
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  }
});
