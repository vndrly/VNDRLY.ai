import { z } from "zod/v4";
import {
  WorkHubAwayCommandSchema,
  WorkHubAwayReceiptSchema,
} from "@workspace/api-zod";
import { withRequestDeadline } from "./request-deadline";
const attemptSchema = z
  .object({
    identity: z.string().min(1),
    actorId: z.number().int().positive(),
    owner: z
      .object({
        type: z.enum(["vendor", "partner"]),
        id: z.number().int().positive(),
      })
      .strict(),
    command: WorkHubAwayCommandSchema,
  })
  .strict();
export type AwayAttempt = z.infer<typeof attemptSchema>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const key = (identity: string) => `vndrly:work-hub-away:${identity}`;
export function storeAwayAttempt(storage: Storage, attempt: AwayAttempt) {
  storage.setItem(
    key(attempt.identity),
    JSON.stringify(attemptSchema.parse(attempt)),
  );
}
export function loadAwayAttempt(
  storage: Storage,
  identity: string,
): AwayAttempt | null {
  try {
    const raw = storage.getItem(key(identity));
    if (!raw) return null;
    const parsed = attemptSchema.parse(JSON.parse(raw));
    return parsed.identity === identity ? parsed : null;
  } catch {
    return null;
  }
}
export function clearAwayAttempt(storage: Storage, identity: string) {
  storage.removeItem(key(identity));
}
export function matchAwayReceipt(raw: unknown, attempt: AwayAttempt) {
  const receipt = WorkHubAwayReceiptSchema.parse(raw),
    command = attempt.command,
    rule = receipt.rule;
  if (
    receipt.operationId !== command.operationId ||
    rule.userId !== attempt.actorId ||
    rule.owner.type !== attempt.owner.type ||
    rule.owner.id !== attempt.owner.id ||
    rule.version !== command.expectedVersion + 1
  )
    throw Error("Away receipt does not match the reviewed request");
  const status =
    command.action === "configure"
      ? "configured"
      : command.action === "pause"
        ? "paused"
        : "revoked";
  if (
    receipt.status !== status ||
    rule.status !== (command.action === "configure" ? "active" : status)
  )
    throw Error("Away receipt status mismatch");
  if (command.action === "configure") {
    if (
      rule.startsAt !== command.startsAt ||
      rule.endsAt !== command.endsAt ||
      rule.replyText !== command.replyText ||
      JSON.stringify(rule.channelIds) !== JSON.stringify(command.channelIds)
    )
      throw Error("Away receipt configuration mismatch");
  } else if (rule.id !== command.ruleId)
    throw Error("Away receipt rule mismatch");
  return receipt;
}
export class AwayRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function awayRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  return withRequestDeadline(
    async (signal) => {
      const response = await fetch(`/api/work-hub${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...init?.headers },
        signal,
      });
      if (!response.ok)
        throw new AwayRequestError(response.status, "Away setting unavailable");
      return response.json();
    },
    {
      signal: init?.signal,
      timeoutMs: 30000,
      timeoutMessage:
        "VNDRLY did not confirm this request. Check the saved request before retrying.",
    },
  );
}
