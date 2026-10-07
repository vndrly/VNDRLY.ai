import { WorkHubAccessError } from "./context-access";

export type MessageMutationIntent = {
  action: "update" | "delete";
  actorUserId: number;
  channelId: string;
  messageId: string;
  expectedVersion: number | null;
  body?: string;
};

/** Historical receipts prove only their exact target, reviewed version and mutation. */
export function assertMessageMutationReceipt(intent: MessageMutationIntent, saved: Record<string, unknown>): void {
  if (saved.id !== intent.messageId || saved.channelId !== intent.channelId ||
      saved.authorUserId !== intent.actorUserId || !Number.isInteger(intent.expectedVersion) ||
      Number(intent.expectedVersion) < 1 || saved.version !== Number(intent.expectedVersion) + 1 ||
      (intent.action === "update" ? saved.body !== intent.body || saved.deletedAt != null : saved.body !== "" || saved.deletedAt == null)) {
    throw new WorkHubAccessError("forbidden");
  }
}

export function assertMessageMutationTarget(intent: MessageMutationIntent, current: { id: string; channelId: string; authorUserId: number } | undefined): void {
  if (!current || current.id !== intent.messageId || current.channelId !== intent.channelId) throw new WorkHubAccessError("not_found");
  if (current.authorUserId !== intent.actorUserId) throw new WorkHubAccessError("forbidden");
}
