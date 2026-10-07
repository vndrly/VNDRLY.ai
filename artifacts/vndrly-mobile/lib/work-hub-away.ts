import {
  WorkHubAwayCommandSchema,
  WorkHubAwayReceiptSchema,
  WorkHubAwayReadbackSchema,
  type WorkHubAwayCommand,
} from "@workspace/api-zod";
type Actor = {
  userId: number;
  owner: { type: "vendor" | "partner"; id: number };
};
export type AwayAttempt = Readonly<{
  command: WorkHubAwayCommand;
  body: string;
  actor: Actor;
}>;
export function makeAwayAttempt(
  raw: unknown,
  actor: Actor,
  channels: readonly string[],
  now: number,
): AwayAttempt {
  const command = WorkHubAwayCommandSchema.parse(raw);
  if (command.action === "configure") {
    const start = Date.parse(command.startsAt),
      end = Date.parse(command.endsAt);
    if (
      end <= start ||
      end <= now ||
      end - start > 31 * 86400000 ||
      new Set(command.channelIds).size !== command.channelIds.length ||
      command.channelIds.some((id) => !channels.includes(id))
    )
      throw Error("Invalid away window or channel");
  }
  return Object.freeze({
    command,
    body: JSON.stringify(command),
    actor: { userId: actor.userId, owner: { ...actor.owner } },
  });
}
export async function submitAwayAttempt(
  attempt: AwayAttempt,
  retry: boolean,
  api: (
    path: string,
    init?: { method: string; body: string },
  ) => Promise<unknown>,
  current: () => boolean,
) {
  const assertCurrent = () => {
    if (!current()) throw Error("Account changed");
  };
  const verify = (raw: unknown) => {
    const receipt = WorkHubAwayReceiptSchema.parse(raw),
      rule = receipt.rule,
      c = attempt.command;
    if (
      receipt.operationId !== c.operationId ||
      rule.userId !== attempt.actor.userId ||
      rule.owner.type !== attempt.actor.owner.type ||
      rule.owner.id !== attempt.actor.owner.id ||
      rule.version !== c.expectedVersion + 1 ||
      receipt.status !==
        (c.action === "configure"
          ? "configured"
          : c.action === "pause"
            ? "paused"
            : "revoked")
    )
      throw Error("Receipt mismatch");
    if (
      c.action === "configure" &&
      (rule.status !== "active" ||
        rule.startsAt !== c.startsAt ||
        rule.endsAt !== c.endsAt ||
        rule.replyText !== c.replyText ||
        JSON.stringify(rule.channelIds) !== JSON.stringify(c.channelIds))
    )
      throw Error("Saved setting mismatch");
    if (
      c.action !== "configure" &&
      (rule.id !== c.ruleId ||
        rule.status !== (c.action === "pause" ? "paused" : "revoked"))
    )
      throw Error("Saved control mismatch");
    return receipt;
  };
  assertCurrent();
  if (retry) {
    const found = WorkHubAwayReadbackSchema.parse(
      await api(
        `/api/work-hub/away-responder/operations/${attempt.command.operationId}`,
      ),
    );
    assertCurrent();
    if (found.receipt) return verify(found.receipt);
  }
  assertCurrent();
  const response = await api("/api/work-hub/away-responder", {
    method: "POST",
    body: attempt.body,
  });
  assertCurrent();
  return verify(response);
}
