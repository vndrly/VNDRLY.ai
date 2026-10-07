import { z } from "zod/v4";
import { WorkHubAccessError } from "./context-access";

export const messageReactionPayload = z.object({
  emoji: z.string().trim().min(1).max(16),
  action: z.enum(["add", "remove"]).optional(),
}).strict();

export type ReactionIntent = {
  actorUserId: number;
  channelId: string;
  messageId: string;
  emoji: string;
  action: "add" | "remove" | "toggle";
  expectedVersion: number | null;
};

export function reactionActive(action: ReactionIntent["action"], existing: boolean): boolean {
  return action === "add" || (action === "toggle" && !existing);
}

/** A saved result belongs only to this exact reviewed target and requested state. */
export function assertReactionReceipt(intent: ReactionIntent, saved: Record<string, unknown>): void {
  if (saved.actorUserId !== intent.actorUserId || saved.channelId !== intent.channelId ||
      saved.messageId !== intent.messageId || saved.emoji !== intent.emoji ||
      saved.action !== intent.action || saved.expectedVersion !== intent.expectedVersion ||
      typeof saved.active !== "boolean" || (intent.action !== "toggle" && saved.active !== (intent.action === "add"))) {
    throw new WorkHubAccessError("forbidden");
  }
}
