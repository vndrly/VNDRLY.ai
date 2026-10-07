import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  WorkHubAwayCommandSchema,
  WorkHubAwayRuleSchema,
  WorkHubAwayReceiptSchema,
} from "@workspace/api-zod";

export const awayResponderActorSchema = z
  .object({
    userId: z.number().int().positive(),
    owner: z
      .object({
        type: z.enum(["vendor", "partner"]),
        id: z.number().int().positive(),
      })
      .strict(),
    membershipId: z.number().int().positive(),
    sessionVersion: z.number().int().positive(),
  })
  .strict();
export const awayResponderCommandSchema = WorkHubAwayCommandSchema;
export const awayResponderRuleSchema = WorkHubAwayRuleSchema;
const stateSchema = z
  .object({ rule: awayResponderRuleSchema, actor: awayResponderActorSchema })
  .passthrough()
  .refine(
    ({ rule, actor }) =>
      rule.userId === actor.userId &&
      rule.owner.type === actor.owner.type &&
      rule.owner.id === actor.owner.id,
    "Away setting owner mismatch",
  );
const receiptSchema = WorkHubAwayReceiptSchema;
const incomingSchema = z
  .object({
    id: z.uuid(),
    channelId: z.uuid(),
    authorUserId: z.number().int().positive(),
    kind: z.string(),
    createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
    automatic: z.boolean(),
  })
  .strict();
export type AwayResponderActor = z.infer<typeof awayResponderActorSchema>;
export type AwayResponderState = z.infer<typeof stateSchema>;
export type AwayResponderIncoming = z.infer<typeof incomingSchema>;
export type AwayReplyCommand = {
  operationId: string;
  windowKey: string;
  ruleId: string;
  ruleVersion: number;
  authorUserId: number;
  channelId: string;
  replyText: string;
  parentMessageId: string;
  recordedAt: string;
  providerDeliveryVerified: false;
};
export interface AwayResponderDependencies {
  now(): Date;
  withConfiguration<T>(
    actor: AwayResponderActor,
    operationId: string,
    run: (locked: {
      state(): unknown;
      prior(): unknown;
      authorize(
        actor: AwayResponderActor,
        channelIds: string[],
        mode: "configure" | "control",
      ): Promise<boolean>;
      save(
        state: AwayResponderState,
        receipt: z.infer<typeof receiptSchema>,
      ): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
  withReply<T>(
    userId: number,
    messageId: string,
    run: (locked: {
      state(): unknown;
      incoming(): unknown;
      authorize(
        state: AwayResponderState,
        incoming: AwayResponderIncoming,
      ): Promise<boolean>;
      prior(operationId: string): unknown;
      send(command: AwayReplyCommand): Promise<{ messageId: string }>;
    }) => Promise<T>,
  ): Promise<T>;
}
function hash(value: unknown): string {
  const ordered = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, ordered(child)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
}
function operation(value: unknown): string {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function createWorkHubAwayResponder(deps: AwayResponderDependencies) {
  async function configure(raw: unknown, supplied: AwayResponderActor) {
    const command = awayResponderCommandSchema.parse(raw),
      actor = awayResponderActorSchema.parse(supplied),
      fingerprint = awayResponderCommandFingerprint(command, actor);
    return deps.withConfiguration(
      actor,
      command.operationId,
      async (locked) => {
        const stored =
          locked.state() == null ? null : stateSchema.parse(locked.state());
        if (stored && stored.actor.userId !== actor.userId)
          throw Error("away_responder.current_owner_required");
        if (
          stored &&
          command.action !== "configure" &&
          (stored.actor.owner.type !== actor.owner.type ||
            stored.actor.owner.id !== actor.owner.id)
        )
          throw Error("away_responder.current_owner_required");
        const channels =
          command.action === "configure" ? command.channelIds : [];
        if (
          !(await locked.authorize(
            actor,
            channels,
            command.action === "configure" ? "configure" : "control",
          ))
        )
          throw Error("away_responder.current_authority_required");
        if (locked.prior() != null) {
          const prior = receiptSchema.parse(locked.prior());
          if (
            prior.operationId !== command.operationId ||
            prior.fingerprint !== fingerprint ||
            prior.rule.userId !== actor.userId
          )
            throw Error("away_responder.operation_conflict");
          return prior;
        }
        if (command.expectedVersion !== (stored?.rule.version ?? 0))
          throw Error("away_responder.version_conflict");
        const now = deps.now();
        let rule: z.infer<typeof awayResponderRuleSchema>;
        if (command.action === "configure") {
          const start = Date.parse(command.startsAt),
            end = Date.parse(command.endsAt);
          if (
            end <= now.getTime() ||
            end <= start ||
            end - start > 31 * 86400000 ||
            new Set(command.channelIds).size !== command.channelIds.length
          )
            throw Error("away_responder.invalid_window");
          rule = awayResponderRuleSchema.parse({
            id: stored?.rule.id ?? command.operationId,
            version: (stored?.rule.version ?? 0) + 1,
            userId: actor.userId,
            owner: actor.owner,
            status: "active",
            startsAt: command.startsAt,
            endsAt: command.endsAt,
            replyText: command.replyText,
            channelIds: command.channelIds,
            configuredAt: now.toISOString(),
            updatedAt: now.toISOString(),
          });
        } else {
          if (!stored || stored.rule.id !== command.ruleId)
            throw Error("away_responder.rule_not_found");
          rule = {
            ...stored.rule,
            version: stored.rule.version + 1,
            status: command.action === "pause" ? "paused" : "revoked",
            updatedAt: now.toISOString(),
          };
        }
        const receipt = receiptSchema.parse({
          operationId: command.operationId,
          fingerprint,
          status:
            command.action === "configure"
              ? "configured"
              : command.action === "pause"
                ? "paused"
                : "revoked",
          rule,
          savedAt: now.toISOString(),
          providerDeliveryVerified: false,
        });
        await locked.save(
          {
            ...stored,
            rule,
            actor: command.action === "configure" ? actor : stored!.actor,
          },
          receipt,
        );
        return receipt;
      },
    );
  }
  async function respond(userId: number, messageId: string) {
    z.number().int().positive().parse(userId);
    z.uuid().parse(messageId);
    return deps.withReply(userId, messageId, async (locked) => {
      const skipped = {
        status: "skipped" as const,
        providerDeliveryVerified: false as const,
      };
      if (locked.state() == null || locked.incoming() == null) return skipped;
      const state = stateSchema.parse(locked.state()),
        incoming = incomingSchema.parse(locked.incoming());
      const rule = state.rule;
      if (
        state.actor.userId !== userId ||
        rule.userId !== userId ||
        incoming.id !== messageId ||
        rule.status !== "active" ||
        !rule.channelIds.includes(incoming.channelId) ||
        incoming.authorUserId === userId ||
        incoming.automatic ||
        incoming.kind !== "text" ||
        incoming.deletedAt !== null ||
        Date.parse(incoming.createdAt) <
          Math.max(Date.parse(rule.startsAt), Date.parse(rule.configuredAt))
      )
        return skipped;
      if (!(await locked.authorize(state, incoming))) return skipped;
      const now = deps.now();
      if (
        now.getTime() < Date.parse(rule.startsAt) ||
        now.getTime() >= Date.parse(rule.endsAt) ||
        Date.parse(incoming.createdAt) >= Date.parse(rule.endsAt) ||
        Date.parse(incoming.createdAt) > now.getTime() + 30000
      )
        return skipped;
      const windowKey = hash([
        "work-hub-away-window",
        userId,
        rule.owner,
        rule.startsAt,
        rule.endsAt,
      ]);
      const operationId = operation([
        "work-hub-away-reply",
        windowKey,
        incoming.channelId,
      ]);
      const prior = await locked.prior(operationId);
      if (prior != null) {
        const saved = z
          .object({
            operationId: z.literal(operationId),
            authorUserId: z.literal(userId),
            channelId: z.literal(incoming.channelId),
            windowKey: z.literal(windowKey),
            messageId: z.uuid(),
          })
          .passthrough()
          .parse(prior);
        return {
          status: "already_replied" as const,
          messageId: saved.messageId,
          providerDeliveryVerified: false as const,
        };
      }
      const sent = await locked.send({
        operationId,
        windowKey,
        ruleId: rule.id,
        ruleVersion: rule.version,
        authorUserId: userId,
        channelId: incoming.channelId,
        replyText: rule.replyText,
        parentMessageId: incoming.id,
        recordedAt: now.toISOString(),
        providerDeliveryVerified: false,
      });
      return {
        status: "saved" as const,
        messageId: z.uuid().parse(sent.messageId),
        operationId,
        providerDeliveryVerified: false as const,
      };
    });
  }
  return { configure, respond };
}

/** Shared exact receipt binding for readonly recovery; never supplies authority. */
export function awayResponderCommandFingerprint(
  raw: unknown,
  supplied: AwayResponderActor,
): string {
  return hash({
    command: awayResponderCommandSchema.parse(raw),
    actor: awayResponderActorSchema.parse(supplied),
  });
}
