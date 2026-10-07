import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  WorkHubAwayReceiptSchema,
  WorkHubAwayChannelsSchema,
  WorkHubAwayReadSchema,
} from "@workspace/api-zod";
import {
  db,
  workHubPreferencesTable,
  workHubClientOperationsTable,
  workHubMessagesTable,
  workHubMessageMetadataTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { resolveChannelAccess } from "../work-hub/queries";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  awayResponderActorSchema,
  awayResponderRuleSchema,
  createWorkHubAwayResponder,
  type AwayResponderActor,
  type AwayResponderState,
  type AwayResponderDependencies,
} from "./work-hub-away-responder";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const KEY = "awayResponder";
const sessionSchema = z
  .object({
    userId: z.number().int().positive(),
    sv: z.number().int().positive(),
    activeMembershipId: z.number().int().positive(),
    role: z.string(),
  })
  .passthrough();

export function awayActor(session: SessionPayload): AwayResponderActor {
  return awayResponderActorSchema.parse({
    userId: session.userId,
    sessionVersion: session.sv,
    membershipId: session.activeMembershipId,
    owner: session.vendorId
      ? { type: "vendor", id: session.vendorId }
      : { type: "partner", id: session.partnerId },
  });
}

async function lockPreferences(tx: Transaction, userId: number) {
  await tx
    .insert(workHubPreferencesTable)
    .values({ userId, preferences: {} })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(workHubPreferencesTable)
    .where(eq(workHubPreferencesTable.userId, userId))
    .for("update");
  if (!row) throw Error("away_responder.current_owner_required");
  return row.preferences;
}

/** Lock the records whose removal revokes this exact conversation. No organization-wide recipient inference. */
export async function authorizeAwayResponderInTransaction(
  tx: Transaction,
  session: SessionPayload,
  actor: AwayResponderActor,
  channelIds: string[],
) {
  await tx.execute(
    sql`SELECT id FROM users WHERE id=${actor.userId} FOR SHARE`,
  );
  await tx.execute(
    sql`SELECT id FROM user_org_memberships WHERE user_id=${actor.userId} FOR SHARE`,
  );
  if (channelIds.length && session.vendorPeopleId) {
    const people = await tx.execute(
      sql`SELECT id FROM vendor_people WHERE id=${session.vendorPeopleId} AND user_id=${actor.userId} AND is_active=true FOR SHARE`,
    );
    if (!people.rows.length)
      throw Error("away_responder.current_authority_required");
  }
  if (session.managedSubcontractor) {
    await tx.execute(
      sql`SELECT id FROM managed_subcontractor_worker_sponsorships WHERE worker_user_id=${actor.userId} FOR SHARE`,
    );
    await tx.execute(
      sql`SELECT grant_row.id FROM managed_subcontractor_role_grants grant_row JOIN managed_subcontractor_worker_sponsorships sponsorship ON sponsorship.id=grant_row.sponsorship_id WHERE sponsorship.worker_user_id=${actor.userId} FOR SHARE OF grant_row`,
    );
    await tx.execute(
      sql`SELECT assignment.id FROM site_work_assignments assignment JOIN managed_subcontractor_worker_sponsorships sponsorship ON sponsorship.sponsor_vendor_id=assignment.vendor_id WHERE sponsorship.worker_user_id=${actor.userId} FOR SHARE OF assignment`,
    );
  }
  const current = await validateAssistantSession(session, tx);
  if (JSON.stringify(awayActor(current)) !== JSON.stringify(actor))
    throw Error("away_responder.current_authority_required");
  for (const id of [...channelIds].sort()) {
    await tx.execute(
      sql`SELECT id FROM work_hub_channels WHERE id=${id}::uuid FOR SHARE`,
    );
    const membership = await tx.execute(
      sql`SELECT id FROM work_hub_channel_members WHERE channel_id=${id}::uuid AND user_id=${actor.userId} FOR SHARE`,
    );
    if (!membership.rows.length)
      throw Error("away_responder.current_authority_required");
    await tx.execute(
      sql`SELECT channel_id FROM work_hub_collaboration_channels WHERE channel_id=${id}::uuid FOR SHARE`,
    );
    await tx.execute(
      sql`SELECT cm.id FROM work_hub_crew_members cm JOIN work_hub_collaboration_channels cc ON cc.crew_id=cm.crew_id WHERE cc.channel_id=${id}::uuid AND cm.user_id=${actor.userId} FOR SHARE OF cm`,
    );
    const { channel } = await resolveChannelAccess(
      { ...current, userId: actor.userId },
      id,
      "channel.write",
      tx,
    );
    if (
      channel.ownerOrgType !== actor.owner.type ||
      channel.ownerOrgId !== actor.owner.id
    )
      throw Error("away_responder.current_authority_required");
  }
  return true;
}

async function prior(
  tx: Transaction,
  userId: number,
  kind: string,
  operationId: string,
) {
  const [row] = await tx
    .select()
    .from(workHubClientOperationsTable)
    .where(
      and(
        eq(workHubClientOperationsTable.userId, userId),
        eq(workHubClientOperationsTable.commandKind, kind),
        eq(workHubClientOperationsTable.operationId, operationId),
      ),
    )
    .limit(1);
  if (row && !row.appliedAt) throw Error("away_responder.operation_conflict");
  return row?.resultJson ?? null;
}

export function createDatabaseAwayResponder(
  session: SessionPayload,
  existingTransaction?: Transaction,
) {
  const transact = <T>(run: (tx: Transaction) => Promise<T>) =>
    existingTransaction ? run(existingTransaction) : db.transaction(run);
  const dependencies: AwayResponderDependencies = {
    now: () => new Date(),
    withConfiguration: async (actor, operationId, run) =>
      transact(async (tx) => {
        const preferences = await lockPreferences(tx, actor.userId);
        const saved = await prior(
          tx,
          actor.userId,
          "away.configure",
          operationId,
        );
        return run({
          state: () => preferences[KEY],
          prior: () => saved,
          authorize: async (a, channels, mode) => {
            // Stopping a setting needs current owner identity, not the old setting's expired context.
            try {
              return await authorizeAwayResponderInTransaction(
                tx,
                session,
                a,
                mode === "configure" ? channels : [],
              );
            } catch {
              return false;
            }
          },
          save: async (state, receipt) => {
            const next = {
              ...state,
              approvedSession:
                state.rule.status === "active"
                  ? session
                  : (preferences[KEY] as Record<string, unknown>)
                      ?.approvedSession,
            };
            await tx
              .update(workHubPreferencesTable)
              .set({ preferences: { ...preferences, [KEY]: next } })
              .where(eq(workHubPreferencesTable.userId, actor.userId));
            await tx.insert(workHubClientOperationsTable).values({
              userId: actor.userId,
              commandKind: "away.configure",
              operationId,
              ownerOrgType: actor.owner.type,
              ownerOrgId: actor.owner.id,
              resultJson: receipt,
              appliedAt: new Date(receipt.savedAt),
            });
            await appendWorkHubAudit(
              {
                actorUserId: actor.userId,
                owner: actor.owner,
                action: `away.${receipt.status}`,
                subjectType: "away_rule",
                subjectId: state.rule.id,
                newVersion: state.rule.version,
                operationId,
                source: "web",
                metadata: {
                  channelCount: state.rule.channelIds.length,
                  startsAt: state.rule.startsAt,
                  endsAt: state.rule.endsAt,
                  providerDeliveryVerified: false,
                },
              },
              tx,
            );
          },
        });
      }),
    withReply: async (userId, messageId, run) =>
      transact(async (tx) => {
        const preferences = await lockPreferences(tx, userId);
        const [message] = await tx
          .select()
          .from(workHubMessagesTable)
          .where(eq(workHubMessagesTable.id, messageId))
          .for("share");
        const [metadata] = message
          ? await tx
              .select()
              .from(workHubMessageMetadataTable)
              .where(eq(workHubMessageMetadataTable.messageId, messageId))
          : [];
        // The prefs owner lock serializes pause/revoke and all replies from this owner.
        return run({
          state: () => preferences[KEY],
          incoming: () =>
            message
              ? {
                  id: message.id,
                  channelId: message.channelId,
                  authorUserId: message.authorUserId,
                  kind: message.kind,
                  createdAt: message.createdAt.toISOString(),
                  deletedAt: message.deletedAt?.toISOString() ?? null,
                  automatic: metadata?.metadata.automaticReply === true,
                }
              : null,
          authorize: async (state, incoming) => {
            try {
              const stored = sessionSchema.parse(
                state.approvedSession,
              ) as unknown as SessionPayload;
              return await authorizeAwayResponderInTransaction(
                tx,
                stored,
                state.actor,
                [incoming.channelId],
              );
            } catch {
              return false;
            }
          },
          prior: (op) => prior(tx, userId, "away.reply", op),
          send: async (command) => {
            const [saved] = await tx
              .insert(workHubMessagesTable)
              .values({
                channelId: command.channelId,
                authorUserId: userId,
                kind: "text",
                body: command.replyText,
                parentMessageId: command.parentMessageId,
                clientOperationId: command.operationId,
                createdAt: new Date(command.recordedAt),
              })
              .returning();
            if (!saved) throw Error("away_responder.operation_conflict");
            await tx.insert(workHubMessageMetadataTable).values({
              messageId: saved.id,
              metadata: {
                automaticReply: true,
                ruleId: command.ruleId,
                ruleVersion: command.ruleVersion,
                windowKey: command.windowKey,
                sourceMessageId: command.parentMessageId,
                providerDeliveryVerified: false,
              },
            });
            const receipt = {
              operationId: command.operationId,
              windowKey: command.windowKey,
              authorUserId: userId,
              channelId: command.channelId,
              messageId: saved.id,
              providerDeliveryVerified: false,
            };
            await tx.insert(workHubClientOperationsTable).values({
              userId,
              commandKind: "away.reply",
              operationId: command.operationId,
              ownerOrgType: (preferences[KEY] as AwayResponderState).actor.owner
                .type,
              ownerOrgId: (preferences[KEY] as AwayResponderState).actor.owner
                .id,
              resultJson: receipt,
              appliedAt: new Date(command.recordedAt),
            });
            await appendWorkHubAudit(
              {
                actorUserId: userId,
                owner: (preferences[KEY] as AwayResponderState).actor.owner,
                action: "away.reply_saved",
                subjectType: "message",
                subjectId: saved.id,
                newVersion: 1,
                source: "worker",
                operationId: command.operationId,
                metadata: {
                  ruleId: command.ruleId,
                  ruleVersion: command.ruleVersion,
                  sourceMessageId: command.parentMessageId,
                  providerDeliveryVerified: false,
                },
              },
              tx,
            );
            return { messageId: saved.id };
          },
        });
      }),
  };
  return createWorkHubAwayResponder(dependencies);
}

export async function readAwayResponder(session: SessionPayload) {
  const actor = awayActor(session);
  return db.transaction(async (tx) => {
    await authorizeAwayResponderInTransaction(tx, session, actor, []);
    const [row] = await tx
      .select()
      .from(workHubPreferencesTable)
      .where(eq(workHubPreferencesTable.userId, actor.userId))
      .limit(1);
    const state = row?.preferences[KEY];
    if (state == null)
      return WorkHubAwayReadSchema.parse({
        rule: null,
        version: 0,
        providerDeliveryVerified: false,
      });
    const rule = awayResponderRuleSchema.parse(
      (state as AwayResponderState).rule,
    );
    if (rule.userId !== actor.userId)
      throw Error("away_responder.current_owner_required");
    const sameOwner =
      rule.owner.type === actor.owner.type && rule.owner.id === actor.owner.id;
    return WorkHubAwayReadSchema.parse({
      rule: sameOwner ? rule : null,
      version: rule.version,
      providerDeliveryVerified: false,
    });
  });
}

export async function readAwayResponderOperation(
  session: SessionPayload,
  operationId: string,
) {
  z.uuid().parse(operationId);
  const actor = awayActor(session);
  return db.transaction(async (tx) => {
    await authorizeAwayResponderInTransaction(tx, session, actor, []);
    const value = await prior(tx, actor.userId, "away.configure", operationId);
    if (value == null) return { receipt: null };
    const receipt = WorkHubAwayReceiptSchema.parse(value);
    if (
      receipt.operationId !== operationId ||
      receipt.rule.userId !== actor.userId ||
      receipt.rule.owner.type !== actor.owner.type ||
      receipt.rule.owner.id !== actor.owner.id
    )
      throw Error("away_responder.current_owner_required");
    await authorizeAwayResponderInTransaction(
      tx,
      session,
      actor,
      receipt.status === "configured" ? receipt.rule.channelIds : [],
    );
    return { receipt };
  });
}

export async function listAwayResponderChannels(session: SessionPayload) {
  const actor = awayActor(session);
  return db.transaction(async (tx) => {
    await authorizeAwayResponderInTransaction(tx, session, actor, []);
    const result = await tx.execute(
      sql`SELECT channel.id,channel.name FROM work_hub_channels channel JOIN work_hub_channel_members member ON member.channel_id=channel.id WHERE member.user_id=${actor.userId} AND channel.owner_org_type=${actor.owner.type} AND channel.owner_org_id=${actor.owner.id} AND channel.status='active' ORDER BY channel.updated_at DESC,channel.id DESC LIMIT 101`,
    );
    const channels: { id: string; name: string }[] = [];
    for (const raw of result.rows.slice(0, 100)) {
      const row = z
        .object({ id: z.uuid(), name: z.string() })
        .strict()
        .parse(raw);
      try {
        await authorizeAwayResponderInTransaction(tx, session, actor, [row.id]);
        channels.push(row);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "away_responder.current_authority_required" ||
            error.name === "WorkHubAccessError")
        )
          continue;
        throw error;
      }
    }
    return WorkHubAwayChannelsSchema.parse({
      channels,
      truncated: result.rows.length > 100,
      source: "joined_writable_channels",
    });
  });
}

/** Runs inside the incoming-message transaction. A bad/stale rule cannot block a person's message. */
export async function applyAwayRepliesForIncoming(
  tx: Transaction,
  session: SessionPayload,
  messageId: string,
  channelId: string,
) {
  const candidates = await tx.execute(sql`
    SELECT member.user_id FROM work_hub_channel_members member
    JOIN work_hub_preferences pref ON pref.user_id=member.user_id
    WHERE member.channel_id=${channelId}::uuid
      AND pref.preferences->'awayResponder'->'rule'->>'status'='active'
      AND pref.preferences->'awayResponder'->'rule'->'channelIds' ? ${channelId}
    ORDER BY member.user_id
  `);
  const saved: { userId: number; messageId: string }[] = [];
  for (const row of candidates.rows) {
    const userId = z.number().int().positive().parse(row.user_id);
    await tx
      .transaction(async (nested) => {
        const result = await createDatabaseAwayResponder(
          session,
          nested,
        ).respond(userId, messageId);
        if (result.status === "saved")
          saved.push({ userId, messageId: result.messageId });
      })
      .catch(() => {
        /* Savepoint preserves the incoming message; no reply success is reported. */
      });
  }
  return saved;
}
