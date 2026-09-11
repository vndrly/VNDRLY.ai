import { assertCollaborationInvite } from "../work-hub/collaboration-access";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, lt, ne, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  workHubChannelMembersTable,
  workHubChannelsTable,
  workHubMessagesTable,
  workHubMessageVersionsTable,
  workHubMentionsTable,
  workHubReactionsTable,
  workHubReadCursorsTable,
  workHubNotesTable,
  workHubNoteVersionsTable,
} from "@workspace/db";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  createWorkHubAccess,
  requireWorkHubCapability,
  WorkHubAccessError,
} from "../work-hub/context-access";
import {
  listOwnedWorkHubChannels,
  resolveChannelAccess,
} from "../work-hub/queries";
import { publishWorkHubEvent } from "../work-hub/events";
import { isWorkHubEnabled } from "../work-hub/feature-access";

const router: IRouter = Router();
const uuid = z.string().uuid();
const createChannelPayload = z.object({
  name: z.string().trim().min(1).max(120),
  visibility: z
    .enum(["organization", "private", "group"])
    .default("organization"),
});
const createMessagePayload = z.object({
  body: z.string().trim().min(1).max(20_000),
  kind: z.enum(["text", "voice_note", "system"]).default("text"),
  rootMessageId: uuid.nullable().optional(),
  parentMessageId: uuid.nullable().optional(),
  mentionUserIds: z.array(z.number().int().positive()).max(100).default([]),
});
const updateMessagePayload = z.object({
  body: z.string().trim().min(1).max(20_000),
});

function session(req: Request): (SessionPayload & { userId: number }) | null {
  const value = getSessionFromRequest(req);
  return value?.userId ? (value as SessionPayload & { userId: number }) : null;
}
function source(req: Request): "web" | "ios" {
  return req.header("x-vndrly-client") === "ios" ? "ios" : "web";
}
function fail(res: Response, error: unknown): void {
  if (error instanceof WorkHubAccessError) {
    sendApiError(res, error.status, error.code, error.message);
    return;
  }
  if (error instanceof z.ZodError) {
    sendApiError(
      res,
      400,
      "work_hub.invalid_operation",
      "Invalid Work Hub request",
      { issues: error.issues },
    );
    return;
  }
  if (error instanceof Error && error.message === "work_hub.version_conflict") {
    sendApiError(
      res,
      409,
      "work_hub.version_conflict",
      "The item changed on another device",
    );
    return;
  }
  throw error;
}

router.use("/work-hub", async (_req, res, next) => {
  if (!(await isWorkHubEnabled())) {
    sendApiError(res, 404, "work_hub.not_found", "Not found");
    return;
  }
  next();
});

router.get("/work-hub/channels", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const before =
    typeof req.query.before === "string"
      ? new Date(req.query.before)
      : undefined;
  const channels = await listOwnedWorkHubChannels(
    actor,
    before && !Number.isNaN(before.getTime()) ? before : undefined,
    Number(req.query.limit) || 50,
  );
  const enriched = await Promise.all(
    channels.map(async (channel) => {
      const [cursor] = await db
        .select({ seenAt: workHubReadCursorsTable.seenAt })
        .from(workHubReadCursorsTable)
        .where(
          and(
            eq(workHubReadCursorsTable.channelId, channel.id),
            eq(workHubReadCursorsTable.userId, actor.userId),
          ),
        )
        .limit(1);
      const [row] = await db
        .select({ unreadCount: sql<number>`count(*)::int` })
        .from(workHubMessagesTable)
        .where(
          and(
            eq(workHubMessagesTable.channelId, channel.id),
            ne(workHubMessagesTable.authorUserId, actor.userId),
            cursor?.seenAt
              ? gt(workHubMessagesTable.createdAt, cursor.seenAt)
              : undefined,
          ),
        );
      return { ...channel, unreadCount: row?.unreadCount ?? 0 };
    }),
  );
  return res.json(enriched);
});

router.post("/work-hub/channels", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = createChannelPayload.parse(envelope.payload);
    const access = createWorkHubAccess({
      session: actor,
      owner: envelope.owner,
      context: envelope.context,
      participant: true,
    });
    requireWorkHubCapability(access, "channel.manage");
    const result = await executeWorkHubCommand(
      { userId: actor.userId, source: source(req) },
      "channel.create",
      envelope,
      async (tx) => {
        const contextId =
          envelope.context.kind === "organization"
            ? `${envelope.owner.id}:${envelope.operationId}`
            : String(envelope.context.id);
        const [channel] = await tx
          .insert(workHubChannelsTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            contextKind: envelope.context.kind,
            contextId,
            name: payload.name,
            visibility: payload.visibility,
            createdById: actor.userId,
          })
          .returning();
        await tx
          .insert(workHubChannelMembersTable)
          .values({
            channelId: channel.id,
            userId: actor.userId,
            mode: "owner",
          })
          .onConflictDoNothing();
        await appendWorkHubAudit(
          {
            actorUserId: actor.userId,
            owner: envelope.owner,
            action: "channel.created",
            subjectType: "channel",
            subjectId: channel.id,
            newVersion: 1,
            source: source(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return channel;
      },
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return fail(res, error);
  }
});

router.delete("/work-hub/channels/:channelId", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const result = await executeWorkHubCommand(
      { userId: actor.userId, source: source(req) },
      "channel.delete",
      envelope,
      async (tx) => {
        const { channel } = await resolveChannelAccess(
          actor,
          req.params.channelId,
          "channel.manage",
        );
        if (
          envelope.owner.type !== channel.ownerOrgType ||
          envelope.owner.id !== channel.ownerOrgId
        )
          throw new WorkHubAccessError("forbidden");
        const [deleted] = await tx
          .update(workHubChannelsTable)
          .set({ status: "deleted", updatedAt: new Date() })
          .where(
            and(
              eq(workHubChannelsTable.id, channel.id),
              eq(workHubChannelsTable.status, "active"),
            ),
          )
          .returning();
        if (!deleted) throw new WorkHubAccessError("not_found");
        await appendWorkHubAudit(
          {
            actorUserId: actor.userId,
            owner: envelope.owner,
            action: "channel.deleted",
            subjectType: "channel",
            subjectId: channel.id,
            source: source(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return { id: channel.id, deleted: true };
      },
    );
    return res.json(result);
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/work-hub/channels/:channelId/members", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    await resolveChannelAccess(actor, req.params.channelId, "channel.read");
    const rows = await db
      .select({
        id: workHubChannelMembersTable.id,
        userId: usersTable.id,
        displayName: usersTable.displayName,
        email: usersTable.email,
        mode: workHubChannelMembersTable.mode,
      })
      .from(workHubChannelMembersTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, workHubChannelMembersTable.userId),
      )
      .where(eq(workHubChannelMembersTable.channelId, req.params.channelId));
    return res.json(rows);
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/work-hub/channels/:channelId/members", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const { channel } = await resolveChannelAccess(actor, req.params.channelId, "channel.manage");
    const email = z.string().trim().email().parse(req.body?.email).toLowerCase();
    const [invitee] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = ${email}`).limit(1);
    if (!invitee) return sendApiError(res, 404, "work_hub.invitee_not_found", "No VNDRLY user was found for that email");
    await assertCollaborationInvite(channel, invitee.id);
    const [member] = await db.insert(workHubChannelMembersTable).values({ channelId: channel.id, userId: invitee.id, mode: "member" })
      .onConflictDoUpdate({ target: [workHubChannelMembersTable.channelId, workHubChannelMembersTable.userId], set: { mode: "member" } }).returning();
    await appendWorkHubAudit({ actorUserId: actor.userId, owner: { type: channel.ownerOrgType as "vendor" | "partner", id: channel.ownerOrgId }, action: "channel.member_added", subjectType: "channel", subjectId: channel.id, source: source(req), metadata: { invitedUserId: invitee.id } });
    return res.status(201).json(member);
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/work-hub/channels/:channelId/messages", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    await resolveChannelAccess(actor, req.params.channelId, "channel.read");
    const before = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
    const rows = await db.select().from(workHubMessagesTable).where(and(eq(workHubMessagesTable.channelId, req.params.channelId), before && !Number.isNaN(before.getTime()) ? lt(workHubMessagesTable.createdAt, before) : undefined)).orderBy(desc(workHubMessagesTable.createdAt), desc(workHubMessagesTable.id)).limit(Math.min(100, Number(req.query.limit) || 50));
    const reactions = rows.length ? await db.select().from(workHubReactionsTable).where(inArray(workHubReactionsTable.messageId, rows.map(r => r.id))) : [];
    const authors = rows.length ? await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, [...new Set(rows.map(r => r.authorUserId))])) : [];
    return res.json(rows.map(row => ({ ...row, body: row.deletedAt ? "" : row.body, authorName: authors.find(a => a.id === row.authorUserId)?.displayName ?? "", reactions: row.deletedAt ? [] : reactions.filter(r => r.messageId === row.id) })));
  } catch (error) { return fail(res, error); }
});

router.post("/work-hub/channels/:channelId/messages", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const { channel } = await resolveChannelAccess(actor, req.params.channelId, "channel.write");
    const envelope = workHubCommandEnvelopeSchema.parse(req.body); const payload = createMessagePayload.parse(envelope.payload);
    if (envelope.owner.type !== channel.ownerOrgType || envelope.owner.id !== channel.ownerOrgId) throw new WorkHubAccessError("forbidden");
    const result = await executeWorkHubCommand({ userId: actor.userId, source: source(req) }, "message.create", envelope, async (tx) => {
      for (const referenceId of [payload.rootMessageId, payload.parentMessageId].filter(Boolean)) {
        const [reference] = await tx.select().from(workHubMessagesTable).where(and(eq(workHubMessagesTable.id, referenceId!), eq(workHubMessagesTable.channelId, channel.id))).limit(1);
        if (!reference) throw new WorkHubAccessError("not_found");
      }
      const [message] = await tx.insert(workHubMessagesTable).values({ channelId: channel.id, authorUserId: actor.userId, body: payload.body, kind: payload.kind, rootMessageId: payload.rootMessageId ?? null, parentMessageId: payload.parentMessageId ?? null, clientOperationId: envelope.operationId }).returning();
      if (payload.mentionUserIds.length) await tx.insert(workHubMentionsTable).values([...new Set(payload.mentionUserIds)].map((mentionedUserId) => ({ messageId: message.id, mentionedUserId }))).onConflictDoNothing();
      await appendWorkHubAudit({ actorUserId: actor.userId, owner: envelope.owner, action: "message.created", subjectType: "message", subjectId: message.id, newVersion: 1, source: source(req), operationId: envelope.operationId }, tx);
      return message;
    });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return fail(res, error);
  }
});

router.patch("/work-hub/channels/:channelId/messages/:messageId", async (req, res) => {
  const actor = session(req); if (!actor) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  try {
    const { channel } = await resolveChannelAccess(actor, req.params.channelId, "channel.write");
    const envelope = workHubCommandEnvelopeSchema.parse(req.body); const payload = updateMessagePayload.parse(envelope.payload);
    const result = await executeWorkHubCommand({ userId: actor.userId, source: source(req) }, "message.update", envelope, async (tx) => {
      const [current] = await tx.select().from(workHubMessagesTable).where(and(eq(workHubMessagesTable.id, req.params.messageId), eq(workHubMessagesTable.channelId, channel.id))).limit(1);
      if (!current) throw new WorkHubAccessError("not_found");
      if (current.authorUserId !== actor.userId) throw new WorkHubAccessError("forbidden");
      if (current.deletedAt) throw new WorkHubAccessError("forbidden");
      if (envelope.expectedVersion !== current.version) throw new Error("work_hub.version_conflict");
      await tx.insert(workHubMessageVersionsTable).values({ messageId: current.id, version: current.version, body: current.body, editorUserId: actor.userId });
      const [updated] = await tx.update(workHubMessagesTable).set({ body: payload.body, version: current.version + 1, editedAt: new Date() }).where(eq(workHubMessagesTable.id, current.id)).returning();
      await appendWorkHubAudit({ actorUserId: actor.userId, owner: envelope.owner, action: "message.updated", subjectType: "message", subjectId: current.id, priorVersion: current.version, newVersion: updated.version, source: source(req), operationId: envelope.operationId }, tx);
      return updated;
    });
    return res.json(result);
  } catch (error) { return fail(res, error); }
});

router.delete("/work-hub/channels/:channelId/messages/:messageId", async (req, res) => {
  const actor = session(req); if (!actor) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  try {
    const { channel } = await resolveChannelAccess(actor, req.params.channelId, "channel.write");
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    if (envelope.owner.type !== channel.ownerOrgType || envelope.owner.id !== channel.ownerOrgId) throw new WorkHubAccessError("forbidden");
    const result = await executeWorkHubCommand({ userId: actor.userId, source: source(req) }, "message.delete", envelope, async tx => {
      const [current] = await tx.select().from(workHubMessagesTable).where(and(eq(workHubMessagesTable.id, req.params.messageId), eq(workHubMessagesTable.channelId, channel.id))).for("update").limit(1);
      if (!current) throw new WorkHubAccessError("not_found");
      if (current.authorUserId !== actor.userId) throw new WorkHubAccessError("forbidden");
      if (current.deletedAt) return { ...current, body: "" };
      if (envelope.expectedVersion !== current.version) throw new Error("work_hub.version_conflict");
      await tx.insert(workHubMessageVersionsTable).values({ messageId: current.id, version: current.version, body: current.body, editorUserId: actor.userId });
      const [updated] = await tx.update(workHubMessagesTable).set({ body: "", deletedAt: new Date(), deletedById: actor.userId, version: current.version + 1 }).where(eq(workHubMessagesTable.id, current.id)).returning();
      await appendWorkHubAudit({ actorUserId: actor.userId, owner: envelope.owner, action: "message.deleted", subjectType: "message", subjectId: current.id, source: source(req), operationId: envelope.operationId }, tx);
      return updated;
    });
    return res.json(result);
  } catch (error) { return fail(res, error); }
});
router.post("/work-hub/channels/:channelId/messages/:messageId/reactions", async (req, res) => {
  const actor = session(req); if (!actor) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  try {
    const { channel } = await resolveChannelAccess(actor, req.params.channelId, "channel.write");
    const envelope = workHubCommandEnvelopeSchema.parse(req.body); const payload = z.object({ emoji: z.string().trim().min(1).max(16) }).parse(envelope.payload);
    const result = await executeWorkHubCommand({ userId: actor.userId, source: source(req) }, "reaction.toggle", envelope, async (tx) => {
      const [message] = await tx.select().from(workHubMessagesTable).where(and(eq(workHubMessagesTable.id, req.params.messageId), eq(workHubMessagesTable.channelId, channel.id))).limit(1);
      if (!message || message.deletedAt) throw new WorkHubAccessError("not_found");
      const where = and(eq(workHubReactionsTable.messageId, req.params.messageId), eq(workHubReactionsTable.userId, actor.userId), eq(workHubReactionsTable.emoji, payload.emoji));
      const [existing] = await tx.select().from(workHubReactionsTable).where(where).limit(1);
      if (existing) { await tx.delete(workHubReactionsTable).where(eq(workHubReactionsTable.id, existing.id)); return { active: false, emoji: payload.emoji }; }
      await tx.insert(workHubReactionsTable).values({ messageId: req.params.messageId, userId: actor.userId, emoji: payload.emoji });
      return { active: true, emoji: payload.emoji, channelId: channel.id };
    });
    return res.json(result);
  } catch (error) { return fail(res, error); }
});

router.put("/work-hub/channels/:channelId/read-cursor", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    await resolveChannelAccess(actor, req.params.channelId, "channel.read");
    const lastMessageId = uuid.nullable().parse(req.body?.lastMessageId ?? null);
    if (lastMessageId) {
      const [message] = await db.select().from(workHubMessagesTable).where(and(eq(workHubMessagesTable.id, lastMessageId), eq(workHubMessagesTable.channelId, req.params.channelId))).limit(1);
      if (!message) throw new WorkHubAccessError("not_found");
    }
    const [cursor] = await db.insert(workHubReadCursorsTable).values({ channelId: req.params.channelId, userId: actor.userId, lastMessageId }).onConflictDoUpdate({ target: [workHubReadCursorsTable.channelId, workHubReadCursorsTable.userId], set: { lastMessageId, seenAt: new Date() } }).returning();
    return res.json(cursor);
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/work-hub/channels/:channelId/notes", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    await resolveChannelAccess(actor, req.params.channelId, "channel.read");
    return res.json(
      await db
        .select()
        .from(workHubNotesTable)
        .where(eq(workHubNotesTable.channelId, req.params.channelId))
        .orderBy(desc(workHubNotesTable.updatedAt)),
    );
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/work-hub/channels/:channelId/notes", async (req, res) => {
  const actor = session(req);
  if (!actor)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const { channel } = await resolveChannelAccess(
      actor,
      req.params.channelId,
      "channel.write",
    );
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = z
      .object({
        title: z.string().trim().min(1).max(180),
        body: z.string().max(100_000).default(""),
      })
      .parse(envelope.payload);
    const result = await executeWorkHubCommand(
      { userId: actor.userId, source: source(req) },
      "note.create",
      envelope,
      async (tx) => {
        const [note] = await tx
          .insert(workHubNotesTable)
          .values({
            channelId: channel.id,
            title: payload.title,
            body: payload.body,
            createdById: actor.userId,
            updatedById: actor.userId,
          })
          .returning();
        return note;
      },
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return fail(res, error);
  }
});

router.patch(
  "/work-hub/channels/:channelId/notes/:noteId",
  async (req, res) => {
    const actor = session(req);
    if (!actor)
      return sendApiError(
        res,
        401,
        "auth.unauthenticated",
        "Authentication required",
      );
    try {
      await resolveChannelAccess(actor, req.params.channelId, "channel.write");
      const envelope = workHubCommandEnvelopeSchema.parse(req.body);
      const payload = z
        .object({
          title: z.string().trim().min(1).max(180),
          body: z.string().max(100_000),
        })
        .parse(envelope.payload);
      const result = await executeWorkHubCommand(
        { userId: actor.userId, source: source(req) },
        "note.update",
        envelope,
        async (tx) => {
          const [current] = await tx
            .select()
            .from(workHubNotesTable)
            .where(
              and(
                eq(workHubNotesTable.id, req.params.noteId),
                eq(workHubNotesTable.channelId, req.params.channelId),
              ),
            )
            .limit(1);
          if (!current) throw new WorkHubAccessError("not_found");
          if (current.version !== envelope.expectedVersion)
            throw new Error("work_hub.version_conflict");
          await tx
            .insert(workHubNoteVersionsTable)
            .values({
              noteId: current.id,
              version: current.version,
              title: current.title,
              body: current.body,
              editorUserId: actor.userId,
            });
          const [updated] = await tx
            .update(workHubNotesTable)
            .set({
              ...payload,
              version: current.version + 1,
              updatedById: actor.userId,
              updatedAt: new Date(),
            })
            .where(eq(workHubNotesTable.id, current.id))
            .returning();
          return updated;
        },
      );
      return res.json(result);
    } catch (error) {
      return fail(res, error);
    }
  },
);

export default router;
