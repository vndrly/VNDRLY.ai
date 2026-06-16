import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, eq, sql } from "drizzle-orm";
import {
  db,
  majikCircleMembersTable,
  majikCirclesTable,
  majikPresenceTable,
  usersTable,
} from "@workspace/db";
import {
  MAJIK_DEFAULT_CIRCLE_ID,
  MAJIK_MAX_MEMBERS,
  MAJIK_STALE_HOURS,
  computeMajikPresenceState,
  type MajikCircleSnapshot,
  type MajikMemberPresence,
} from "@workspace/majik";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import {
  getCurrentMajikEventSeq,
  publishMajikEvent,
  subscribeMajikEvents,
} from "../lib/majik-events";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireSession(req: Request, res: Response): SessionPayload | null {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    res.status(401).json({
      message: "Not authenticated",
      code: "auth.not_authenticated",
    });
    return null;
  }
  return session;
}

function requireAdmin(session: SessionPayload, res: Response): boolean {
  if (session.role !== "admin") {
    res.status(403).json({
      message: "Admin access required",
      code: "auth.forbidden",
    });
    return false;
  }
  return true;
}

async function readDefaultCircle() {
  const [row] = await db
    .select()
    .from(majikCirclesTable)
    .where(eq(majikCirclesTable.id, MAJIK_DEFAULT_CIRCLE_ID));
  if (row) return row;
  await db
    .insert(majikCirclesTable)
    .values({
      id: MAJIK_DEFAULT_CIRCLE_ID,
      name: "Majik",
      maxMembers: MAJIK_MAX_MEMBERS,
    })
    .onConflictDoNothing();
  const [created] = await db
    .select()
    .from(majikCirclesTable)
    .where(eq(majikCirclesTable.id, MAJIK_DEFAULT_CIRCLE_ID));
  return created!;
}

async function isMajikMember(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ userId: majikCircleMembersTable.userId })
    .from(majikCircleMembersTable)
    .where(
      and(
        eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID),
        eq(majikCircleMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

function toMemberPresence(
  userId: number,
  displayName: string,
  isUp: boolean,
  updatedAt: Date | null,
): MajikMemberPresence {
  const { effectiveUp, state } = computeMajikPresenceState(isUp, updatedAt);
  return {
    userId,
    displayName,
    isUp,
    effectiveUp,
    state,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

async function buildCircleSnapshot(): Promise<MajikCircleSnapshot> {
  const circle = await readDefaultCircle();
  const rows = await db
    .select({
      userId: usersTable.id,
      displayName: usersTable.displayName,
      isUp: majikPresenceTable.isUp,
      updatedAt: majikPresenceTable.updatedAt,
    })
    .from(majikCircleMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, majikCircleMembersTable.userId))
    .leftJoin(
      majikPresenceTable,
      and(
        eq(majikPresenceTable.circleId, majikCircleMembersTable.circleId),
        eq(majikPresenceTable.userId, majikCircleMembersTable.userId),
      ),
    )
    .where(eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID))
    .orderBy(asc(usersTable.displayName));

  const members = rows.map((row) =>
    toMemberPresence(
      row.userId,
      row.displayName,
      row.isUp ?? false,
      row.updatedAt ?? null,
    ),
  );

  return {
    circleId: circle.id,
    name: circle.name,
    maxMembers: circle.maxMembers,
    memberCount: members.length,
    upCount: members.filter((m) => m.effectiveUp).length,
    staleHours: MAJIK_STALE_HOURS,
    members,
  };
}

async function requireMajikMember(
  req: Request,
  res: Response,
): Promise<SessionPayload | null> {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!(await isMajikMember(session.userId!))) {
    res.status(403).json({
      message: "You are not in the Majik team",
      code: "majik.not_member",
    });
    return null;
  }
  return session;
}

router.get("/majik/circle", async (req, res) => {
  const session = await requireMajikMember(req, res);
  if (!session) return;
  res.json(await buildCircleSnapshot());
});

router.get("/majik/me", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const member = await isMajikMember(session.userId!);
  res.json({
    userId: session.userId,
    displayName: session.displayName ?? null,
    isMember: member,
  });
});

router.post("/majik/up", async (req, res) => {
  const session = await requireMajikMember(req, res);
  if (!session) return;
  const now = new Date();
  await db
    .insert(majikPresenceTable)
    .values({
      circleId: MAJIK_DEFAULT_CIRCLE_ID,
      userId: session.userId!,
      isUp: true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [majikPresenceTable.circleId, majikPresenceTable.userId],
      set: { isUp: true, updatedAt: now },
    });

  const { effectiveUp, state } = computeMajikPresenceState(true, now);
  const updatedAt = now.toISOString();
  publishMajikEvent({
    type: "majik.presence_updated",
    circleId: MAJIK_DEFAULT_CIRCLE_ID,
    userId: session.userId!,
    isUp: true,
    effectiveUp,
    state,
    updatedAt,
  });

  res.json({
    ok: true,
    isUp: true,
    effectiveUp,
    state,
    updatedAt,
  });
});

router.post("/majik/down", async (req, res) => {
  const session = await requireMajikMember(req, res);
  if (!session) return;
  const now = new Date();
  await db
    .insert(majikPresenceTable)
    .values({
      circleId: MAJIK_DEFAULT_CIRCLE_ID,
      userId: session.userId!,
      isUp: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [majikPresenceTable.circleId, majikPresenceTable.userId],
      set: { isUp: false, updatedAt: now },
    });

  publishMajikEvent({
    type: "majik.presence_updated",
    circleId: MAJIK_DEFAULT_CIRCLE_ID,
    userId: session.userId!,
    isUp: false,
    effectiveUp: false,
    state: "down",
    updatedAt: now.toISOString(),
  });

  res.json({
    ok: true,
    isUp: false,
    effectiveUp: false,
    state: "down" as const,
    updatedAt: now.toISOString(),
  });
});

router.get("/majik/events", async (req, res): Promise<void> => {
  const session = await requireMajikMember(req, res);
  if (!session) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: connected\n\n`);

  const lastEventIdHeader = req.header("Last-Event-ID");
  const lastSeenSeqRaw = lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
  const lastSeenSeq = Number.isFinite(lastSeenSeqRaw) ? lastSeenSeqRaw : null;
  void getCurrentMajikEventSeq()
    .then((currentSeq) => {
      const gap = lastSeenSeq != null && currentSeq > lastSeenSeq;
      const hello = {
        type: "majik.hello" as const,
        currentSeq,
        lastSeenSeq,
        gap,
      };
      try {
        res.write(`event: majik.hello\n`);
        res.write(`data: ${JSON.stringify(hello)}\n\n`);
      } catch {
        /* client gone */
      }
    })
    .catch(() => {
      /* swallow */
    });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 25000);

  const unsubscribe = subscribeMajikEvents((ev) => {
    if (ev.circleId !== MAJIK_DEFAULT_CIRCLE_ID) return;
    try {
      if (typeof ev.seq === "number") {
        res.write(`id: ${ev.seq}\n`);
      }
      res.write(`event: ${ev.type}\n`);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {
      /* client gone */
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get("/admin/majik/members", async (req, res) => {
  const session = requireSession(req, res);
  if (!session || !requireAdmin(session, res)) return;
  res.json(await buildCircleSnapshot());
});

router.post("/admin/majik/members", async (req, res) => {
  const session = requireSession(req, res);
  if (!session || !requireAdmin(session, res)) return;

  const userId = Number(req.body?.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({
      message: "userId is required",
      code: "majik.invalid_user_id",
    });
    return;
  }

  const circle = await readDefaultCircle();
  const [memberCountRow] = await db
    .select({ n: count() })
    .from(majikCircleMembersTable)
    .where(eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID));
  const memberCount = Number(memberCountRow?.n ?? 0);
  if (memberCount >= circle.maxMembers) {
    res.status(400).json({
      message: `Majik team is full (max ${circle.maxMembers})`,
      code: "majik.team_full",
    });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(404).json({
      message: "User not found",
      code: "majik.user_not_found",
    });
    return;
  }

  try {
    await db.insert(majikCircleMembersTable).values({
      circleId: MAJIK_DEFAULT_CIRCLE_ID,
      userId,
    });
  } catch (err) {
    logger.error({ err, userId }, "Failed to add Majik member");
    res.status(409).json({
      message: "User is already in a Majik team",
      code: "majik.already_member",
    });
    return;
  }

  res.status(201).json(await buildCircleSnapshot());
});

router.delete("/admin/majik/members/:userId", async (req, res) => {
  const session = requireSession(req, res);
  if (!session || !requireAdmin(session, res)) return;

  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({
      message: "Invalid userId",
      code: "majik.invalid_user_id",
    });
    return;
  }

  await db
    .delete(majikPresenceTable)
    .where(
      and(
        eq(majikPresenceTable.circleId, MAJIK_DEFAULT_CIRCLE_ID),
        eq(majikPresenceTable.userId, userId),
      ),
    );
  await db
    .delete(majikCircleMembersTable)
    .where(
      and(
        eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID),
        eq(majikCircleMembersTable.userId, userId),
      ),
    );

  res.json(await buildCircleSnapshot());
});

router.get("/admin/majik/candidates", async (req, res) => {
  const session = requireSession(req, res);
  if (!session || !requireAdmin(session, res)) return;

  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      username: usersTable.username,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(
      q.length > 0
        ? sql`(
            lower(${usersTable.displayName}) like ${`%${q}%`}
            or lower(${usersTable.username}) like ${`%${q}%`}
            or lower(coalesce(${usersTable.email}, '')) like ${`%${q}%`}
          )`
        : sql`true`,
    )
    .orderBy(asc(usersTable.displayName))
    .limit(25);

  const memberIds = new Set(
    (
      await db
        .select({ userId: majikCircleMembersTable.userId })
        .from(majikCircleMembersTable)
        .where(eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID))
    ).map((r) => r.userId),
  );

  res.json({
    candidates: rows
      .filter((row) => !memberIds.has(row.id))
      .map((row) => ({
        id: row.id,
        displayName: row.displayName,
        username: row.username,
        email: row.email,
        role: row.role,
      })),
  });
});

export default router;
