import { expect, it, vi } from "vitest";
import {
  createWorkHubAwayResponder,
  type AwayResponderDependencies,
} from "./work-hub-away-responder";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = {
  userId: 17,
  owner: { type: "vendor" as const, id: 4 },
  membershipId: 12,
  sessionVersion: 1,
};
const command = {
  operationId: uuid(1),
  action: "configure" as const,
  expectedVersion: 0,
  startsAt: "2026-10-07T12:00:00Z",
  endsAt: "2026-10-08T12:00:00Z",
  replyText:
    "I am away until tomorrow. I will review your message when I return.",
  channelIds: [uuid(2)],
};
function fixture() {
  let state: unknown = null,
    priorReply: unknown = null,
    now = new Date("2026-10-07T12:00:00Z");
  const receipts = new Map<string, unknown>();
  const authorize = vi.fn(async () => true),
    save = vi.fn(async (next: unknown, value: unknown) => {
      state = next;
      receipts.set((value as { operationId: string }).operationId, value);
    }),
    send = vi.fn(async (value: unknown) => {
      priorReply = { ...(value as object), messageId: uuid(5) };
      return { messageId: uuid(5) };
    });
  const incoming = {
    id: uuid(3),
    channelId: uuid(2),
    authorUserId: 18,
    kind: "text",
    createdAt: "2026-10-07T12:01:00Z",
    deletedAt: null,
    automatic: false,
  };
  const deps: AwayResponderDependencies = {
    now: () => now,
    withConfiguration: async (_actor, op, run) =>
      run({
        state: () => state,
        prior: () => receipts.get(op) ?? null,
        authorize,
        save,
      }),
    withReply: async (_userId, _messageId, run) =>
      run({
        state: () => state,
        incoming: () => incoming,
        authorize,
        prior: () => priorReply,
        send,
      }),
  };
  return {
    service: createWorkHubAwayResponder(deps),
    authorize,
    save,
    send,
    incoming,
    setNow: (value: string) => {
      now = new Date(value);
    },
    setState: (value: unknown) => {
      state = value;
    },
    get state() {
      return state;
    },
  };
}
it("saves only explicit approved window/text/channels with exact CAS and immutable retry", async () => {
  const f = fixture();
  const first = await f.service.configure(command, actor);
  expect(first).toMatchObject({
    status: "configured",
    rule: { replyText: command.replyText, channelIds: command.channelIds },
    providerDeliveryVerified: false,
  });
  expect(await f.service.configure(command, actor)).toEqual(first);
  expect(f.save).toHaveBeenCalledOnce();
  await expect(
    f.service.configure({ ...command, replyText: "different" }, actor),
  ).rejects.toThrow("operation_conflict");
  await expect(
    f.service.configure(
      { ...command, operationId: uuid(9), expectedVersion: 0 },
      actor,
    ),
  ).rejects.toThrow("version_conflict");
});
it("rechecks current authority even when the exact configuration receipt already exists", async () => {
  const f = fixture();
  await f.service.configure(command, actor);
  f.authorize.mockResolvedValue(false);
  await expect(f.service.configure(command, actor)).rejects.toThrow(
    "current_authority_required",
  );
  expect(f.save).toHaveBeenCalledOnce();
});
it("editing approved text within the same window does not create a second reply", async () => {
  const f = fixture();
  await f.service.configure(command, actor);
  f.setNow("2026-10-07T12:01:01Z");
  await f.service.respond(actor.userId, f.incoming.id);
  await f.service.configure(
    {
      ...command,
      operationId: uuid(12),
      expectedVersion: 1,
      replyText: "I will follow up when I return.",
    },
    actor,
  );
  f.incoming.createdAt = "2026-10-07T12:02:00Z";
  f.setNow("2026-10-07T12:02:01Z");
  expect(await f.service.respond(actor.userId, f.incoming.id)).toMatchObject({
    status: "already_replied",
  });
  expect(f.send).toHaveBeenCalledOnce();
});
it("fails closed for stored actor/rule ownership disagreement", async () => {
  const f = fixture();
  const saved = await f.service.configure(command, actor);
  f.setState({
    rule: saved.rule,
    actor: { ...actor, owner: { type: "vendor", id: 99 } },
  });
  await expect(f.service.respond(actor.userId, f.incoming.id)).rejects.toThrow(
    "owner mismatch",
  );
  expect(f.send).not.toHaveBeenCalled();
});
it("posts one exact neutral reply per conversation/window with deterministic operation and no provider claim", async () => {
  const f = fixture();
  await f.service.configure(command, actor);
  f.setNow("2026-10-07T12:01:01Z");
  expect(await f.service.respond(17, uuid(3))).toMatchObject({
    status: "saved",
    messageId: uuid(5),
    providerDeliveryVerified: false,
  });
  expect(await f.service.respond(17, uuid(3))).toMatchObject({
    status: "already_replied",
  });
  expect(f.send).toHaveBeenCalledOnce();
  expect(f.send.mock.calls[0][0]).toMatchObject({
    replyText: command.replyText,
    channelId: uuid(2),
    parentMessageId: uuid(3),
  });
});
it("does not reply to self, automatic/system/deleted/historical messages or outside approved scope/window", async () => {
  for (const patch of [
    { authorUserId: 17 },
    { automatic: true },
    { kind: "system" },
    { deletedAt: "2026-10-07T12:01:00Z" },
    { channelId: uuid(99) },
    { createdAt: "2026-10-07T11:59:00Z" },
  ]) {
    const f = fixture();
    await f.service.configure(command, actor);
    f.setNow("2026-10-07T12:01:01Z");
    Object.assign(f.incoming, patch);
    expect(await f.service.respond(17, uuid(3))).toMatchObject({
      status: "skipped",
    });
    expect(f.send).not.toHaveBeenCalled();
  }
  const f = fixture();
  await f.service.configure(command, actor);
  f.setNow("2026-10-08T12:00:00Z");
  expect(await f.service.respond(17, uuid(3))).toMatchObject({
    status: "skipped",
  });
});
it("rechecks current recipient authority and pause/revoke before every effect", async () => {
  const f = fixture();
  const configured = await f.service.configure(command, actor);
  f.setNow("2026-10-07T12:01:01Z");
  f.authorize.mockResolvedValueOnce(false);
  expect(await f.service.respond(17, uuid(3))).toMatchObject({
    status: "skipped",
  });
  expect(f.send).not.toHaveBeenCalled();
  await f.service.configure(
    {
      operationId: uuid(7),
      action: "pause",
      expectedVersion: configured.rule.version,
      ruleId: configured.rule.id,
    },
    actor,
  );
  expect(await f.service.respond(17, uuid(3))).toMatchObject({
    status: "skipped",
  });
  expect(f.send).not.toHaveBeenCalled();
});
it("rejects injected broad recipients and expiry during async validation", async () => {
  const f = fixture();
  await expect(
    f.service.configure({ ...command, allChannels: true }, actor),
  ).rejects.toThrow();
  expect(f.save).not.toHaveBeenCalled();
  await f.service.configure(command, actor);
  f.setNow("2026-10-08T11:59:59Z");
  f.authorize.mockImplementationOnce(async () => {
    f.setNow("2026-10-08T12:00:01Z");
    return true;
  });
  expect(await f.service.respond(17, uuid(3))).toMatchObject({
    status: "skipped",
  });
  expect(f.send).not.toHaveBeenCalled();
});
