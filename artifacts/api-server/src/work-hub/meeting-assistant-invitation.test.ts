import { expect, it, vi } from "vitest";
import {
  applyMeetingInvitation,
  meetingInvitationVersion,
} from "./meeting-assistant-invitation";
const occurrence = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const actor = {
  userId: 9,
  ownerOrgType: "vendor" as const,
  ownerOrgId: 4,
  actorMembershipId: 5,
  actorSessionVersion: 1,
};
function fixture() {
  let saved: any = null,
    state = {
      invited: false,
      runtime: {
        presence: { 9: { seenAt: 1 } },
        sequence: 8,
        askvInvitationRevision: 0,
      } as Record<string, unknown>,
    };
  const authorize = vi.fn(async () => {}),
    save = vi.fn(async (r: any, runtime: any) => {
      saved = r;
      state = { invited: r.invited, runtime };
    });
  return {
    authorize,
    save,
    deps: {
      authorize,
      prior: async () => saved,
      state: () => state,
      save,
      now: () => new Date("2026-10-07T10:00:00Z"),
    },
    state: () => state,
  };
}
it("saves exact revision and preserves unrelated runtime; replay does not repeat notices/effects", async () => {
  const f = fixture(),
    input = { operationId, expectedVersion: 0, invited: true };
  const first = await applyMeetingInvitation(occurrence, actor, input, f.deps);
  expect(first).toMatchObject({
    version: 1,
    invited: true,
    changed: true,
    consentAccepted: false,
    deviceCaptureStarted: false,
  });
  expect(f.state().runtime).toEqual({
    presence: { 9: { seenAt: 1 } },
    sequence: 8,
    askvInvitationRevision: 1,
  });
  expect(
    await applyMeetingInvitation(occurrence, actor, input, f.deps),
  ).toEqual(first);
  expect(f.save).toHaveBeenCalledOnce();
  expect(f.authorize).toHaveBeenCalledTimes(2);
});
it.each(["invited", "version", "occurrence", "actor", "owner", "session"])(
  "rejects changed %s on a saved UUID",
  async (key) => {
    const f = fixture(),
      input = { operationId, expectedVersion: 0, invited: true };
    await applyMeetingInvitation(occurrence, actor, input, f.deps);
    await expect(
      applyMeetingInvitation(
        key === "occurrence"
          ? "33333333-3333-4333-8333-333333333333"
          : occurrence,
        {
          ...actor,
          ...(key === "actor"
            ? { userId: 10 }
            : key === "owner"
              ? { ownerOrgId: 6 }
              : key === "session"
                ? { actorSessionVersion: 2 }
                : {}),
        },
        {
          ...input,
          ...(key === "invited"
            ? { invited: false }
            : key === "version"
              ? { expectedVersion: 1 }
              : {}),
        },
        f.deps,
      ),
    ).rejects.toThrow();
    expect(f.save).toHaveBeenCalledOnce();
  },
);
it("rechecks current permission before replay and before receipt readback", async () => {
  const f = fixture(),
    input = { operationId, expectedVersion: 0, invited: true };
  await applyMeetingInvitation(occurrence, actor, input, f.deps);
  f.authorize.mockRejectedValue(Error("host removed"));
  await expect(
    applyMeetingInvitation(occurrence, actor, input, f.deps, true),
  ).rejects.toThrow("host removed");
  expect(f.save).toHaveBeenCalledOnce();
});
it("no-op desired state has a receipt and revision but no notice marker", async () => {
  const f = fixture();
  expect(
    await applyMeetingInvitation(
      occurrence,
      actor,
      { operationId, expectedVersion: 0, invited: false },
      f.deps,
    ),
  ).toMatchObject({ changed: false, version: 1 });
});
it("readback absence has no effect and stale distinct operation refuses", async () => {
  const f = fixture(),
    input = { operationId, expectedVersion: 1, invited: true };
  expect(
    await applyMeetingInvitation(occurrence, actor, input, f.deps, true),
  ).toBeNull();
  await expect(
    applyMeetingInvitation(occurrence, actor, input, f.deps),
  ).rejects.toThrow("Refresh");
  expect(f.save).not.toHaveBeenCalled();
});
it("strictly rejects legacy invited-only and unexpected consent fields", async () => {
  const f = fixture();
  for (const input of [
    { invited: true },
    { operationId, expectedVersion: 0, invited: true, consentAccepted: true },
  ])
    await expect(
      applyMeetingInvitation(occurrence, actor, input, f.deps),
    ).rejects.toThrow();
  expect(f.authorize).not.toHaveBeenCalled();
  expect(() =>
    meetingInvitationVersion({ askvInvitationRevision: "1" }),
  ).toThrow();
});
