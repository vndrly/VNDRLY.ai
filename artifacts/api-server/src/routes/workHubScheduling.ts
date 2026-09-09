import { Router, type IRouter } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  userOrgMembershipsTable,
  workHubSchedulingTypesTable as types,
  workHubSchedulingAvailabilityTable as availability,
  workHubMeetingsTable as meetings,
  workHubMeetingOccurrencesTable as occurrences,
  workHubMeetingParticipantsTable as participants,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { WorkHubAccessError } from "../work-hub/context-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  canManageSchedulingType,
  fitsAvailability,
  overlaps,
  schedulingSlots,
} from "../work-hub/scheduling-policy";

const router: IRouter = Router();
type Actor = {
  userId: number;
  owner: { type: "vendor" | "partner"; id: number };
  admin: boolean;
};
const timezone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid time zone");
const typeFields = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  durationMinutes: z.number().int().min(5).max(480),
  timezone,
  visibility: z.enum(["personal", "shared"]).default("personal"),
  active: z.boolean().default(true),
});
const operation = z.object({ operationId: z.string().uuid() });
const windowSchema = z
  .object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine(
    (w) =>
      new Date(w.endsAt) > new Date(w.startsAt) &&
      new Date(w.endsAt).getTime() - new Date(w.startsAt).getTime() <=
        7 * 86400000,
    "Availability must end after its start within seven days",
  );
function envelope(a: Actor, operationId: string, payload: unknown) {
  return {
    owner: a.owner,
    context: { kind: "organization" as const, id: a.owner.id },
    operationId,
    expectedVersion: null,
    payloadVersion: 1 as const,
    payload,
  };
}
async function actor(
  req: Parameters<typeof getSessionFromRequest>[0],
): Promise<Actor> {
  const session = getSessionFromRequest(req);
  if (!session?.userId)
    throw Object.assign(new Error("Sign in to use scheduling"), {
      status: 401,
    });
  if (!(await isWorkHubEnabled())) throw new WorkHubAccessError("not_found");
  const type = session.vendorId ? "vendor" : "partner",
    id = session.vendorId ?? session.partnerId;
  if (!id) throw new WorkHubAccessError("forbidden");
  const [member] = await db
    .select()
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, type),
        type === "vendor"
          ? eq(userOrgMembershipsTable.vendorId, id)
          : eq(userOrgMembershipsTable.partnerId, id),
      ),
    )
    .limit(1);
  if (!member) throw new WorkHubAccessError("forbidden");
  return {
    userId: session.userId,
    owner: { type, id },
    admin: member.role === "admin",
  };
}
async function getType(a: Actor, id: string, manage = false) {
  const [row] = await db
    .select()
    .from(types)
    .where(
      and(
        eq(types.id, z.string().uuid().parse(id)),
        eq(types.ownerOrgType, a.owner.type),
        eq(types.ownerOrgId, a.owner.id),
      ),
    )
    .limit(1);
  if (!row || (row.visibility !== "shared" && row.hostUserId !== a.userId))
    throw new WorkHubAccessError("not_found");
  if (
    manage &&
    !canManageSchedulingType(a.userId, row.hostUserId, row.visibility, a.admin)
  )
    throw new WorkHubAccessError("forbidden");
  return row;
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function busyFor(tx: Tx | typeof db, ids: number[]) {
  return tx
    .select({ startsAt: occurrences.startsAt, endsAt: occurrences.endsAt })
    .from(occurrences)
    .innerJoin(participants, eq(participants.occurrenceId, occurrences.id))
    .where(
      and(
        inArray(participants.userId, ids),
        sql`${occurrences.status} <> 'cancelled'`,
        sql`coalesce(${occurrences.endsAt}, ${occurrences.startsAt} + interval '1 hour') > now()`,
      ),
    );
}
function normalizedBusy(rows: { startsAt: Date; endsAt: Date | null }[]) {
  return rows.map((row) => ({
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? new Date(row.startsAt.getTime() + 3600000),
  }));
}

router.get("/work-hub/scheduling/types", async (req, res) => {
  const a = await actor(req);
  const rows = await db
    .select()
    .from(types)
    .where(
      and(
        eq(types.ownerOrgType, a.owner.type),
        eq(types.ownerOrgId, a.owner.id),
        or(eq(types.hostUserId, a.userId), eq(types.visibility, "shared")),
      ),
    );
  return res.json(
    rows.map((row) => ({
      ...row,
      canManage: canManageSchedulingType(
        a.userId,
        row.hostUserId,
        row.visibility,
        a.admin,
      ),
    })),
  );
});
router.post("/work-hub/scheduling/types", async (req, res) => {
  const a = await actor(req),
    p = typeFields.extend(operation.shape).parse(req.body);
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "scheduling.type.create",
    envelope(a, p.operationId, p),
    async (tx) => {
      const [row] = await tx
        .insert(types)
        .values({
          title: p.title,
          description: p.description,
          durationMinutes: p.durationMinutes,
          timezone: p.timezone,
          visibility: p.visibility,
          active: p.active,
          hostUserId: a.userId,
          ownerOrgType: a.owner.type,
          ownerOrgId: a.owner.id,
        })
        .returning();
      await appendWorkHubAudit(
        {
          actorUserId: a.userId,
          owner: a.owner,
          action: "scheduling.type.created",
          subjectType: "scheduling_type",
          subjectId: row!.id,
          source: "web",
          operationId: p.operationId,
        },
        tx,
      );
      return row;
    },
  );
  return res.status(result.replayed ? 200 : 201).json(result.resource);
});
router.patch("/work-hub/scheduling/types/:id", async (req, res) => {
  const a = await actor(req),
    row = await getType(a, req.params.id, true),
    p = typeFields
      .extend({
        ...operation.shape,
        expectedVersion: z.number().int().positive(),
      })
      .parse(req.body);
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "scheduling.type.update",
    envelope(a, p.operationId, p),
    async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(73009, ${row.hostUserId})`,
      );
      const [locked] = await tx
        .select()
        .from(types)
        .where(eq(types.id, row.id))
        .limit(1);
      if (
        !locked ||
        !canManageSchedulingType(
          a.userId,
          locked.hostUserId,
          locked.visibility,
          a.admin,
        )
      )
        throw new WorkHubAccessError("forbidden");
      const [updated] = await tx
        .update(types)
        .set({
          title: p.title,
          description: p.description,
          durationMinutes: p.durationMinutes,
          timezone: p.timezone,
          visibility: p.visibility,
          active: p.active,
          version: p.expectedVersion + 1,
        })
        .where(and(eq(types.id, row.id), eq(types.version, p.expectedVersion)))
        .returning();
      if (!updated)
        throw Object.assign(
          new Error("This schedule changed. Refresh before saving."),
          { status: 409 },
        );
      await appendWorkHubAudit(
        {
          actorUserId: a.userId,
          owner: a.owner,
          action: "scheduling.type.updated",
          subjectType: "scheduling_type",
          subjectId: row.id,
          source: "web",
          operationId: p.operationId,
        },
        tx,
      );
      return updated;
    },
  );
  return res.json(result.resource);
});
router.get("/work-hub/scheduling/types/:id/availability", async (req, res) => {
  const a = await actor(req),
    row = await getType(a, req.params.id);
  const windows = await db
    .select()
    .from(availability)
    .where(eq(availability.typeId, row.id));
  const busy = normalizedBusy(
    await busyFor(db, [...new Set([row.hostUserId, a.userId])]),
  );
  return res.json({
    windows: canManageSchedulingType(
      a.userId,
      row.hostUserId,
      row.visibility,
      a.admin,
    )
      ? windows
      : [],
    slots: row.active
      ? schedulingSlots(windows, row.durationMinutes, busy)
      : [],
    version: row.version,
  });
});
router.put("/work-hub/scheduling/types/:id/availability", async (req, res) => {
  const a = await actor(req),
    row = await getType(a, req.params.id, true);
  const p = operation
    .extend({
      expectedVersion: z.number().int().positive(),
      windows: z.array(windowSchema).max(60),
    })
    .parse(req.body);
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "scheduling.availability.update",
    envelope(a, p.operationId, p),
    async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(73009, ${row.hostUserId})`,
      );
      const [locked] = await tx
        .select()
        .from(types)
        .where(eq(types.id, row.id))
        .limit(1);
      if (
        !locked ||
        !canManageSchedulingType(
          a.userId,
          locked.hostUserId,
          locked.visibility,
          a.admin,
        )
      )
        throw new WorkHubAccessError("forbidden");
      const [updated] = await tx
        .update(types)
        .set({ version: p.expectedVersion + 1 })
        .where(and(eq(types.id, row.id), eq(types.version, p.expectedVersion)))
        .returning();
      if (!updated)
        throw Object.assign(
          new Error("Availability changed. Refresh before saving."),
          { status: 409 },
        );
      await tx.delete(availability).where(eq(availability.typeId, row.id));
      if (p.windows.length)
        await tx.insert(availability).values(
          p.windows.map((w) => ({
            typeId: row.id,
            startsAt: new Date(w.startsAt),
            endsAt: new Date(w.endsAt),
          })),
        );
      await appendWorkHubAudit(
        {
          actorUserId: a.userId,
          owner: a.owner,
          action: "scheduling.availability.updated",
          subjectType: "scheduling_type",
          subjectId: row.id,
          source: "web",
          operationId: p.operationId,
        },
        tx,
      );
      return { version: updated.version };
    },
  );
  return res.json(result.resource);
});
router.post("/work-hub/scheduling/types/:id/book", async (req, res) => {
  const a = await actor(req),
    row = await getType(a, req.params.id);
  const p = operation
    .extend({
      startsAt: z.string().datetime(),
      note: z.string().max(2000).default(""),
    })
    .parse(req.body);
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "scheduling.book",
    envelope(a, p.operationId, p),
    async (tx) => {
      const ids = [...new Set([row.hostUserId, a.userId])].sort(
        (a, b) => a - b,
      );
      for (const id of ids)
        await tx.execute(sql`select pg_advisory_xact_lock(73009, ${id})`);
      const [current] = await tx
        .select()
        .from(types)
        .where(eq(types.id, row.id))
        .limit(1);
      if (
        !current?.active ||
        (current.visibility !== "shared" && current.hostUserId !== a.userId)
      )
        throw new WorkHubAccessError("not_found");
      const [hostMembership] = await tx
        .select()
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, current.hostUserId),
            eq(userOrgMembershipsTable.orgType, a.owner.type),
            a.owner.type === "vendor"
              ? eq(userOrgMembershipsTable.vendorId, a.owner.id)
              : eq(userOrgMembershipsTable.partnerId, a.owner.id),
          ),
        )
        .limit(1);
      if (!hostMembership) throw new WorkHubAccessError("not_found");
      const start = new Date(p.startsAt),
        end = new Date(start.getTime() + current.durationMinutes * 60000);
      const windows = await tx
        .select()
        .from(availability)
        .where(eq(availability.typeId, current.id));
      if (start <= new Date() || !fitsAvailability(start, end, windows))
        throw Object.assign(
          new Error("This time is outside the host's availability."),
          { status: 409 },
        );
      const busy = normalizedBusy(await busyFor(tx, ids));
      if (busy.some((b) => overlaps(start, end, b.startsAt, b.endsAt)))
        throw Object.assign(
          new Error(
            "This time was just booked or conflicts with an existing meeting. Choose another time.",
          ),
          { status: 409 },
        );
      const [meeting] = await tx
        .insert(meetings)
        .values({
          ownerOrgType: a.owner.type,
          ownerOrgId: a.owner.id,
          title: current.title,
          agenda: [current.description, p.note].filter(Boolean).join("\n\n"),
          timezone: current.timezone,
          recordingAllowed: false,
          createdById: current.hostUserId,
        })
        .returning();
      const [occurrence] = await tx
        .insert(occurrences)
        .values({ meetingId: meeting!.id, startsAt: start, endsAt: end })
        .returning();
      await tx.insert(participants).values(
        ids.map((id) => ({
          occurrenceId: occurrence!.id,
          userId: id,
          role: id === current.hostUserId ? "host" : "participant",
          rsvp: "accepted",
        })),
      );
      await appendWorkHubAudit(
        {
          actorUserId: a.userId,
          owner: a.owner,
          action: "scheduling.booked",
          subjectType: "meeting_occurrence",
          subjectId: occurrence!.id,
          source: "web",
          operationId: p.operationId,
          metadata: { schedulingTypeId: current.id },
        },
        tx,
      );
      return { meeting, occurrence };
    },
  );
  return res.status(result.replayed ? 200 : 201).json(result.resource);
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
        "work_hub.invalid_schedule",
        "Check the scheduling fields",
        { issues: error.issues },
      );
    if (error instanceof Error && "status" in error)
      return sendApiError(
        res,
        Number(error.status),
        "work_hub.scheduling_conflict",
        error.message,
      );
    return next(error);
  },
);
export default router;
