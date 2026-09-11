import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql, ilike } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  userOrgMembershipsTable,
  workHubChannelsTable,
  workHubChannelMembersTable,
  workHubMessagesTable,
  workHubCrewsTable,
  workHubCrewMembersTable,
  workHubCollaborationChannelsTable,
  workHubChatInvitationsTable,
  workHubPreferencesTable,
} from "@workspace/db";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { WorkHubAccessError } from "../work-hub/context-access";
import { listOwnedWorkHubChannels } from "../work-hub/queries";
import { executeWorkHubCommand } from "../work-hub/commands";
import { resolveChannelAccess } from "../work-hub/queries";
import { canManageCrew } from "../work-hub/collaboration-policy";
import { appendWorkHubAudit } from "../work-hub/audit";

const router: IRouter = Router();
type Actor = SessionPayload & { userId: number };
const name = z.string().trim().min(1).max(120);
const ownerSchema = z.object({
  type: z.enum(["vendor", "partner"]),
  id: z.number().int().positive(),
});
const preferenceSchema = z.object({
  pinned: z.array(z.string().max(100)).max(40).default([]),
  order: z.array(z.string().max(100)).max(40).default([]),
  favorites: z.array(z.string().max(100)).max(500).default([]),
  muted: z.array(z.string().max(100)).max(500).default([]),
  drafts: z
    .record(z.string().max(100), z.string().max(20000))
    .refine((x) => Object.keys(x).length <= 100)
    .default({}),
});
function owns(a: Actor, type: string, id: number) {
  return type === "vendor" ? a.vendorId === id : a.partnerId === id;
}
function admin(a: Actor, type: string, id: number) {
  return owns(a, type, id) && a.membershipRole === "admin";
}
function activeOwner(a: Actor) {
  if (a.vendorId) return { type: "vendor" as const, id: a.vendorId };
  if (a.partnerId) return { type: "partner" as const, id: a.partnerId };
  throw new WorkHubAccessError("forbidden");
}
async function memberOf(userId: number, type: string, id: number) {
  const [row] = await db
    .select()
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, userId),
        eq(userOrgMembershipsTable.orgType, type),
        type === "vendor"
          ? eq(userOrgMembershipsTable.vendorId, id)
          : eq(userOrgMembershipsTable.partnerId, id),
      ),
    )
    .limit(1);
  return Boolean(row);
}
async function crewAccess(a: Actor, id: string, manage = false) {
  const [crew] = await db
    .select()
    .from(workHubCrewsTable)
    .where(eq(workHubCrewsTable.id, z.string().uuid().parse(id)))
    .limit(1);
  if (!crew) throw new WorkHubAccessError("not_found");
  const [membership] = await db
    .select()
    .from(workHubCrewMembersTable)
    .where(
      and(
        eq(workHubCrewMembersTable.crewId, id),
        eq(workHubCrewMembersTable.userId, a.userId),
      ),
    )
    .limit(1);
  const isAdmin = admin(a, crew.ownerOrgType, crew.ownerOrgId);
  if (
    membership &&
    !(await memberOf(a.userId, crew.ownerOrgType, crew.ownerOrgId))
  )
    throw new WorkHubAccessError("not_found");
  if (!membership && !isAdmin) throw new WorkHubAccessError("not_found");
  if (
    manage &&
    !canManageCrew({
      ownerMatch: owns(a, crew.ownerOrgType, crew.ownerOrgId),
      companyAdmin: isAdmin,
      crewRole: membership?.mode ?? null,
    })
  )
    throw new WorkHubAccessError("forbidden");
  return { crew, role: isAdmin ? "admin" : membership!.mode };
}

router.use("/work-hub", async (req, res, next) => {
  if (!(await isWorkHubEnabled()))
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const actor = getSessionFromRequest(req);
  if (!actor?.userId)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  // Revalidate active company membership; stale session roles cannot administer a Crew.
  const orgType = actor.vendorId ? "vendor" : "partner";
  const orgId = actor.vendorId ?? actor.partnerId;
  const [membership] = orgId
    ? await db
        .select()
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, actor.userId),
            eq(userOrgMembershipsTable.orgType, orgType),
            orgType === "vendor"
              ? eq(userOrgMembershipsTable.vendorId, orgId)
              : eq(userOrgMembershipsTable.partnerId, orgId),
          ),
        )
        .limit(1)
    : [];
  res.locals.collaborationActor = {
    ...actor,
    membershipRole: membership?.role ?? null,
    vendorId: membership?.vendorId ?? null,
    partnerId: membership?.partnerId ?? null,
  };
  return next();
});

router.get("/work-hub/crews", async (_req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const memberships = await db
    .select()
    .from(workHubCrewMembersTable)
    .where(eq(workHubCrewMembersTable.userId, a.userId));
  const ids = memberships.map((x) => x.crewId);
  const own =
    a.membershipRole === "admin"
      ? a.vendorId
        ? and(
            eq(workHubCrewsTable.ownerOrgType, "vendor"),
            eq(workHubCrewsTable.ownerOrgId, a.vendorId),
          )
        : a.partnerId
          ? and(
              eq(workHubCrewsTable.ownerOrgType, "partner"),
              eq(workHubCrewsTable.ownerOrgId, a.partnerId),
            )
          : undefined
      : undefined;
  if (!ids.length && !own) return res.json([]);
  const crews = await db
    .select()
    .from(workHubCrewsTable)
    .where(or(ids.length ? inArray(workHubCrewsTable.id, ids) : undefined, own))
    .orderBy(desc(workHubCrewsTable.createdAt));
  const eligible = await Promise.all(
    crews.map(async (c) =>
      (await memberOf(a.userId, c.ownerOrgType, c.ownerOrgId)) ? c : null,
    ),
  );
  return res.json(
    eligible
      .filter((c): c is (typeof crews)[number] => c !== null)
      .map((c) => ({
        ...c,
        role: admin(a, c.ownerOrgType, c.ownerOrgId)
          ? "admin"
          : memberships.find((m) => m.crewId === c.id)?.mode,
      })),
  );
});
router.post("/work-hub/crews", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const p = z
    .object({
      owner: ownerSchema,
      name,
      operationId: z.string().uuid().optional(),
    })
    .parse(req.body);
  if (!admin(a, p.owner.type, p.owner.id))
    throw new WorkHubAccessError("forbidden");
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "crew.create",
    {
      operationId: p.operationId ?? randomUUID(),
      expectedVersion: null,
      payloadVersion: 1,
      owner: p.owner,
      context: { kind: "organization", id: String(p.owner.id) },
      payload: p,
    },
    async (tx) => {
      const [c] = await tx
        .insert(workHubCrewsTable)
        .values({
          name: p.name,
          ownerOrgType: p.owner.type,
          ownerOrgId: p.owner.id,
          createdById: a.userId,
        })
        .returning();
      await tx
        .insert(workHubCrewMembersTable)
        .values({ crewId: c.id, userId: a.userId, mode: "owner" });
      await appendWorkHubAudit(
        {
          actorUserId: a.userId,
          owner: p.owner,
          action: "crew.created",
          subjectType: "crew",
          subjectId: c.id,
          source: "web",
        },
        tx,
      );
      return c;
    },
  );
  return res.status(result.replayed ? 200 : 201).json(result.resource);
});
router.patch("/work-hub/crews/:id", async (req, res) => {
  const { crew } = await crewAccess(
    res.locals.collaborationActor,
    req.params.id,
    true,
  );
  const p = z.object({ name }).parse(req.body);
  const [updated] = await db
    .update(workHubCrewsTable)
    .set(p)
    .where(eq(workHubCrewsTable.id, crew.id))
    .returning();
  return res.json(updated);
});
router.get("/work-hub/crews/:id/members", async (req, res) => {
  await crewAccess(res.locals.collaborationActor, req.params.id);
  return res.json(
    await db
      .select({
        userId: usersTable.id,
        displayName: usersTable.displayName,
        email: usersTable.email,
        mode: workHubCrewMembersTable.mode,
      })
      .from(workHubCrewMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, workHubCrewMembersTable.userId))
      .where(eq(workHubCrewMembersTable.crewId, req.params.id)),
  );
});
router.post("/work-hub/crews/:id/members", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const { crew } = await crewAccess(a, req.params.id, true);
  const p = z
    .object({
      userId: z.number().int().positive(),
      mode: z.enum(["owner", "member"]).default("member"),
    })
    .parse(req.body);
  if (!(await memberOf(p.userId, crew.ownerOrgType, crew.ownerOrgId)))
    throw new WorkHubAccessError("forbidden");
  const [member] = await db
    .insert(workHubCrewMembersTable)
    .values({ crewId: crew.id, ...p })
    .onConflictDoUpdate({
      target: [workHubCrewMembersTable.crewId, workHubCrewMembersTable.userId],
      set: { mode: p.mode },
    })
    .returning();
  await appendWorkHubAudit({
    actorUserId: a.userId,
    owner: {
      type: crew.ownerOrgType as "vendor" | "partner",
      id: crew.ownerOrgId,
    },
    action: "crew.membership_changed",
    subjectType: "crew",
    subjectId: crew.id,
    source: "web",
    metadata: p,
  });
  return res.json(member);
});
router.post("/work-hub/crews/:id/channels", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const { crew } = await crewAccess(a, req.params.id, true);
  const p = z
    .object({
      name,
      visibility: z.enum(["crew", "private", "shared"]).default("crew"),
      operationId: z.string().uuid().optional(),
    })
    .parse(req.body);
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "crew.channel.create",
    {
      operationId: p.operationId ?? randomUUID(),
      expectedVersion: null,
      payloadVersion: 1,
      owner: {
        type: crew.ownerOrgType as "vendor" | "partner",
        id: crew.ownerOrgId,
      },
      context: { kind: "crew", id: crew.id },
      payload: p,
    },
    async (tx) => {
      const [c] = await tx
        .insert(workHubChannelsTable)
        .values({
          name: p.name,
          ownerOrgType: crew.ownerOrgType,
          ownerOrgId: crew.ownerOrgId,
          contextKind: "crew",
          contextId: `${crew.id}:${randomUUID()}`,
          visibility: p.visibility === "crew" ? "group" : "private",
          createdById: a.userId,
        })
        .returning();
      await tx
        .insert(workHubCollaborationChannelsTable)
        .values({ channelId: c.id, crewId: crew.id, kind: p.visibility });
      await tx
        .insert(workHubChannelMembersTable)
        .values({ channelId: c.id, userId: a.userId, mode: "owner" });
      return c;
    },
  );
  return res.status(result.replayed ? 200 : 201).json(result.resource);
});
router.get("/work-hub/crews/:id/channels", async (req, res) => {
  await crewAccess(res.locals.collaborationActor, req.params.id);
  const rows = await db
    .select({
      channel: workHubChannelsTable,
      classification: workHubCollaborationChannelsTable.kind,
    })
    .from(workHubCollaborationChannelsTable)
    .innerJoin(
      workHubChannelsTable,
      eq(workHubChannelsTable.id, workHubCollaborationChannelsTable.channelId),
    )
    .where(
      and(
        eq(workHubCollaborationChannelsTable.crewId, req.params.id),
        eq(workHubChannelsTable.status, "active"),
      ),
    );
  const visible = await Promise.all(
    rows.map(async (row) => {
      try {
        await resolveChannelAccess(
          res.locals.collaborationActor,
          row.channel.id,
          "channel.read",
        );
        return { ...row.channel, classification: row.classification };
      } catch (error) {
        if (error instanceof WorkHubAccessError) return null;
        throw error;
      }
    }),
  );
  return res.json(visible.filter(Boolean));
});
router.get("/work-hub/people", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const owner = activeOwner(a);
  const search = z
    .string()
    .trim()
    .max(100)
    .parse(req.query.search ?? "");
  const channels = await listOwnedWorkHubChannels(a, undefined, 100);
  const peers = channels.length
    ? await db
        .select({ userId: workHubChannelMembersTable.userId })
        .from(workHubChannelMembersTable)
        .where(
          inArray(
            workHubChannelMembersTable.channelId,
            channels.map((c) => c.id),
          ),
        )
    : [];
  const company = await db
    .select({ userId: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, owner.type),
        owner.type === "vendor"
          ? eq(userOrgMembershipsTable.vendorId, owner.id)
          : eq(userOrgMembershipsTable.partnerId, owner.id),
      ),
    );
  const ids = [...new Set([...company, ...peers].map((x) => x.userId))].filter(
    (id) => id !== a.userId,
  );
  if (!ids.length) return res.json([]);
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, ids),
        search
          ? or(
              ilike(usersTable.displayName, `%${search}%`),
              ilike(usersTable.email, `%${search}%`),
            )
          : undefined,
      ),
    )
    .limit(50);
  return res.json(
    rows.map((r) => ({
      ...r,
      sameCompany: company.some((c) => c.userId === r.id),
    })),
  );
});
router.delete("/work-hub/crews/:id/members/:userId", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const { crew } = await crewAccess(a, req.params.id, true);
  const userId = z.coerce.number().int().positive().parse(req.params.userId);
  if (userId === a.userId) throw new WorkHubAccessError("forbidden");
  await db.transaction(async (tx) => {
    await tx
      .delete(workHubCrewMembersTable)
      .where(
        and(
          eq(workHubCrewMembersTable.crewId, crew.id),
          eq(workHubCrewMembersTable.userId, userId),
        ),
      );
    const channels = await tx
      .select()
      .from(workHubCollaborationChannelsTable)
      .where(eq(workHubCollaborationChannelsTable.crewId, crew.id));
    if (channels.length)
      await tx.delete(workHubChannelMembersTable).where(
        and(
          inArray(
            workHubChannelMembersTable.channelId,
            channels.map((c) => c.channelId),
          ),
          eq(workHubChannelMembersTable.userId, userId),
        ),
      );
  });
  return res.json({ removed: true });
});
router.post("/work-hub/channels/:channelId/invitations", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const { channel } = await resolveChannelAccess(
    a,
    req.params.channelId,
    "channel.manage",
  );
  const [scope] = await db
    .select()
    .from(workHubCollaborationChannelsTable)
    .where(eq(workHubCollaborationChannelsTable.channelId, channel.id))
    .limit(1);
  if (scope?.kind !== "shared") throw new WorkHubAccessError("forbidden");
  const { recipientUserId } = z
    .object({ recipientUserId: z.number().int().positive() })
    .parse(req.body);
  if (recipientUserId === a.userId) throw new WorkHubAccessError("forbidden");
  const owner = { type: channel.ownerOrgType, id: channel.ownerOrgId };
  const sameOrg = await memberOf(recipientUserId, owner.type, owner.id);
  if (!sameOrg) {
    const existingChannels = await listOwnedWorkHubChannels(a, undefined, 100);
    const peers = existingChannels.length
      ? await db
          .select()
          .from(workHubChannelMembersTable)
          .where(
            and(
              inArray(
                workHubChannelMembersTable.channelId,
                existingChannels.map((c) => c.id),
              ),
              eq(workHubChannelMembersTable.userId, recipientUserId),
            ),
          )
          .limit(1)
      : [];
    if (!peers.length) throw new WorkHubAccessError("forbidden");
  }
  const result = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workHubChatInvitationsTable)
      .values({
        channelId: channel.id,
        senderUserId: a.userId,
        recipientUserId,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await tx
      .select()
      .from(workHubChatInvitationsTable)
      .where(
        and(
          eq(workHubChatInvitationsTable.channelId, channel.id),
          eq(workHubChatInvitationsTable.recipientUserId, recipientUserId),
        ),
      )
      .limit(1);
    return existing;
  });
  return res.status(201).json(result);
});
router.get("/work-hub/preferences", async (_req, res) => {
  const [row] = await db
    .select()
    .from(workHubPreferencesTable)
    .where(
      eq(workHubPreferencesTable.userId, res.locals.collaborationActor.userId),
    )
    .limit(1);
  return res.json(
    preferenceSchema.parse(
      row?.preferences ?? {
        pinned: [
          "activity",
          "chat",
          "channels",
          "calendar",
          "calls",
          "files",
          "askv",
        ],
      },
    ),
  );
});
router.put("/work-hub/preferences", async (req, res) => {
  const preferences = preferenceSchema.parse(req.body);
  await db
    .insert(workHubPreferencesTable)
    .values({ userId: res.locals.collaborationActor.userId, preferences })
    .onConflictDoUpdate({
      target: workHubPreferencesTable.userId,
      set: { preferences },
    });
  return res.json(preferences);
});
router.get("/work-hub/chats", async (_req, res) =>
  res.json(
    (
      await listOwnedWorkHubChannels(
        res.locals.collaborationActor,
        undefined,
        100,
      )
    ).filter((c) => c.contextKind === "chat"),
  ),
);
router.get("/work-hub/invitations", async (_req, res) => {
  const id = res.locals.collaborationActor.userId;
  return res.json(
    await db
      .select()
      .from(workHubChatInvitationsTable)
      .where(
        or(
          eq(workHubChatInvitationsTable.senderUserId, id),
          eq(workHubChatInvitationsTable.recipientUserId, id),
        ),
      )
      .orderBy(desc(workHubChatInvitationsTable.createdAt))
      .limit(100),
  );
});
router.post("/work-hub/chats", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const p = z
    .object({
      recipientUserId: z.number().int().positive(),
      name: name.optional(),
    })
    .parse(req.body);
  const owner = activeOwner(a);
  if (p.recipientUserId === a.userId) throw new WorkHubAccessError("forbidden");
  const sameOrg = await memberOf(p.recipientUserId, owner.type, owner.id);
  if (!sameOrg) {
    // Existing shared channel membership establishes permission to request contact, never permission to bypass consent.
    const myChannels = await listOwnedWorkHubChannels(a, undefined, 100);
    const common = myChannels.length
      ? await db
          .select()
          .from(workHubChannelMembersTable)
          .where(
            and(
              inArray(
                workHubChannelMembersTable.channelId,
                myChannels.map((c) => c.id),
              ),
              eq(workHubChannelMembersTable.userId, p.recipientUserId),
            ),
          )
          .limit(1)
      : [];
    if (!common.length) throw new WorkHubAccessError("forbidden");
  }
  const pair = [a.userId, p.recipientUserId].sort((x, y) => x - y).join(":");
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${owner.type + ":" + owner.id + ":" + pair}))`,
    );
    const [existing] = await tx
      .select()
      .from(workHubChannelsTable)
      .where(
        and(
          eq(workHubChannelsTable.ownerOrgType, owner.type),
          eq(workHubChannelsTable.ownerOrgId, owner.id),
          eq(workHubChannelsTable.contextKind, "chat"),
          eq(workHubChannelsTable.contextId, pair),
        ),
      )
      .limit(1);
    if (existing) {
      const [invitation] = await tx
        .select()
        .from(workHubChatInvitationsTable)
        .where(eq(workHubChatInvitationsTable.channelId, existing.id))
        .limit(1);
      return invitation && invitation.status !== "accepted"
        ? { invitation }
        : { channel: existing };
    }
    const [recipient] = await tx
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, p.recipientUserId))
      .limit(1);
    if (!recipient) throw new WorkHubAccessError("not_found");
    const [channel] = await tx
      .insert(workHubChannelsTable)
      .values({
        ownerOrgType: owner.type,
        ownerOrgId: owner.id,
        contextKind: "chat",
        contextId: pair,
        name: p.name ?? recipient.displayName,
        visibility: "private",
        createdById: a.userId,
      })
      .returning();
    await tx
      .insert(workHubCollaborationChannelsTable)
      .values({ channelId: channel.id, kind: "chat" });
    if (sameOrg) {
      await tx.insert(workHubChannelMembersTable).values([
        { channelId: channel.id, userId: a.userId, mode: "owner" },
        { channelId: channel.id, userId: p.recipientUserId, mode: "member" },
      ]);
      return { channel };
    }
    const [invitation] = await tx
      .insert(workHubChatInvitationsTable)
      .values({
        channelId: channel.id,
        senderUserId: a.userId,
        recipientUserId: p.recipientUserId,
      })
      .returning();
    return { invitation };
  });
  return res.status(201).json(result);
});
router.post("/work-hub/invitations/:id/respond", async (req, res) => {
  const a = res.locals.collaborationActor as Actor;
  const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
  const result = await db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(workHubChatInvitationsTable)
      .where(
        and(
          eq(
            workHubChatInvitationsTable.id,
            z.string().uuid().parse(req.params.id),
          ),
          eq(workHubChatInvitationsTable.recipientUserId, a.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!invitation) throw new WorkHubAccessError("not_found");
    if (invitation.status !== "pending") return invitation;
    if (accept)
      await tx
        .insert(workHubChannelMembersTable)
        .values([
          {
            channelId: invitation.channelId,
            userId: invitation.senderUserId,
            mode: "owner",
          },
          { channelId: invitation.channelId, userId: a.userId, mode: "member" },
        ])
        .onConflictDoNothing();
    const [updated] = await tx
      .update(workHubChatInvitationsTable)
      .set({ status: accept ? "accepted" : "declined" })
      .where(eq(workHubChatInvitationsTable.id, invitation.id))
      .returning();
    return updated;
  });
  return res.json(result);
});
router.get("/work-hub/activity", async (_req, res) => {
  const channels = await listOwnedWorkHubChannels(
    res.locals.collaborationActor,
    undefined,
    100,
  );
  if (!channels.length) return res.json([]);
  const rows = await db
    .select({
      id: workHubMessagesTable.id,
      channelId: workHubMessagesTable.channelId,
      channelName: workHubChannelsTable.name,
      body: workHubMessagesTable.body,
      authorUserId: workHubMessagesTable.authorUserId,
      createdAt: workHubMessagesTable.createdAt,
      kind: workHubMessagesTable.kind,
    })
    .from(workHubMessagesTable)
    .innerJoin(
      workHubChannelsTable,
      eq(workHubChannelsTable.id, workHubMessagesTable.channelId),
    )
    .where(
      inArray(
        workHubMessagesTable.channelId,
        channels.map((c) => c.id),
      ),
    )
    .orderBy(desc(workHubMessagesTable.createdAt))
    .limit(100);
  return res.json(rows);
});
router.use(
  (
    error: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (error instanceof WorkHubAccessError)
      return sendApiError(res, error.status, error.code, error.message);
    if (error instanceof z.ZodError)
      return sendApiError(
        res,
        400,
        "work_hub.invalid_operation",
        "Invalid collaboration request",
        { issues: error.issues },
      );
    return next(error);
  },
);
export default router;
