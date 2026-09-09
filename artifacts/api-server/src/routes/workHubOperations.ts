import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod/v4";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db,
  workHubAcknowledgementsTable,
  workHubChannelsTable,
  workHubApprovalRequestsTable,
  workHubApprovalStepsTable,
  workHubAnnouncementRecipientsTable,
  workHubAnnouncementsTable,
  workHubExternalEventsTable,
  workHubFilesTable,
  workHubMeetingArtifactsTable,
  workHubMeetingAttendanceTable,
  workHubMeetingChatTable,
  workHubMeetingConsentsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingParticipantsTable,
  workHubMeetingsTable,
  workHubMessagesTable,
  workHubNotesTable,
  workHubImportBatchesTable,
  workHubImportItemsTable,
  workHubShiftAssignmentsTable,
  workHubShiftRequestsTable,
  workHubShiftsTable,
  workHubTaskEventsTable,
  workHubTasksTable,
  workHubChecklistTemplatesTable,
  workHubChecklistInstancesTable,
  workHubFormTemplatesTable,
  workHubFormInstancesTable,
  workHubFormSubmissionsTable,
  workHubTranscriptSegmentsTable,
  workHubAuditLogTable,
  siteWorkAssignmentsTable,
  usersTable,
} from "@workspace/db";
import {
  workHubCommandEnvelopeSchema,
  type WorkHubOwner,
  type WorkHubContextRef,
} from "@workspace/api-zod";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { ObjectStorageService } from "../lib/objectStorage";
import { absoluteUploadUrl } from "../lib/uploadUrl";
import { executeWorkHubCommand } from "../work-hub/commands";
import {
  createWorkHubAccess,
  requireWorkHubCapability,
  WorkHubAccessError,
} from "../work-hub/context-access";
import { resolveChannelAccess } from "../work-hub/queries";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import {
  normalizeRecurrenceRule,
  validateMeetingConsent,
} from "../work-hub/domain-rules";
import { validateVoiceNoteMetadata } from "../work-hub/file-policy";
import { notifyUsers } from "./notifications";
import { sessionCanSeeOwner } from "../work-hub/owner-boundary";
import { appendWorkHubAudit } from "../work-hub/audit";
import { microsoftImportStatus } from "../work-hub/microsoft-import";
import { resolveVndrlyIceServers } from "../work-hub/audio-provider";
import {
  assertOwnerMatchesChannel,
  assertOwnerUsers,
} from "../work-hub/owner-users";

const router: IRouter = Router();
const storage = new ObjectStorageService();
type MeetingSignal = {
  id: string;
  occurrenceId: string;
  fromUserId: number;
  toUserId: number | null;
  kind: "offer" | "answer" | "ice";
  payload: unknown;
  createdAt: number;
};
const meetingSignals = new Map<string, MeetingSignal[]>();
function pruneMeetingSignals(now = Date.now()) {
  for (const [key, values] of meetingSignals) {
    const fresh = values.filter((value) => now - value.createdAt < 5 * 60_000);
    if (fresh.length) meetingSignals.set(key, fresh);
    else meetingSignals.delete(key);
  }
}
type Actor = SessionPayload & { userId: number };
function actor(req: Request): Actor | null {
  const value = getSessionFromRequest(req);
  return value?.userId ? (value as Actor) : null;
}
function clientSource(req: Request): "web" | "ios" {
  return req.header("x-vndrly-client") === "ios" ? "ios" : "web";
}
async function ownAccess(
  session: Actor,
  owner: WorkHubOwner,
  capability: Parameters<typeof requireWorkHubCapability>[1],
  context: WorkHubContextRef = { kind: "organization", id: owner.id },
) {
  if (
    session.vendorRole === "gate_supervisor" &&
    (capability === "task.assign" || capability === "shift.manage")
  ) {
    if (
      owner.type !== "vendor" ||
      (context.kind !== "gate" && context.kind !== "site")
    )
      throw new WorkHubAccessError("forbidden");
    const siteId = Number(context.id);
    if (!Number.isInteger(siteId) || siteId <= 0)
      throw new WorkHubAccessError("not_found");
    const [assignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.vendorId, owner.id),
          eq(siteWorkAssignmentsTable.siteLocationId, siteId),
        ),
      )
      .limit(1);
    if (!assignment) throw new WorkHubAccessError("not_found");
  }
  const access = createWorkHubAccess({
    session,
    owner,
    context,
    participant: true,
  });
  requireWorkHubCapability(access, capability);
}
function failure(res: Response, error: unknown): void {
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
  if (error instanceof Error && error.message.includes("version_conflict")) {
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

async function claimOpenShift(shiftId: string, userId: number) {
  return db.transaction(async (tx) => {
    const [claimedShift] = await tx
      .update(workHubShiftsTable)
      .set({ open: false, updatedAt: new Date() })
      .where(
        and(
          eq(workHubShiftsTable.id, shiftId),
          eq(workHubShiftsTable.open, true),
        ),
      )
      .returning({ id: workHubShiftsTable.id });
    if (!claimedShift) return null;
    const [assignment] = await tx
      .insert(workHubShiftAssignmentsTable)
      .values({
        shiftId,
        userId,
        status: "claimed",
        assignedById: userId,
      })
      .returning();
    await tx.insert(workHubShiftRequestsTable).values({
      shiftId,
      requestType: "claim",
      requestedById: userId,
      status: "approved",
      decidedById: userId,
      decidedAt: new Date(),
    });
    return assignment;
  });
}
function ownerFilter(session: Actor) {
  return session.role === "admin"
    ? undefined
    : or(
        session.vendorId
          ? and(
              eq(workHubTasksTable.ownerOrgType, "vendor"),
              eq(workHubTasksTable.ownerOrgId, session.vendorId),
            )
          : undefined,
        session.partnerId
          ? and(
              eq(workHubTasksTable.ownerOrgType, "partner"),
              eq(workHubTasksTable.ownerOrgId, session.partnerId),
            )
          : undefined,
      );
}
function ownerFilterFor(
  session: Actor,
  table: { ownerOrgType: AnyPgColumn; ownerOrgId: AnyPgColumn },
) {
  return session.role === "admin"
    ? undefined
    : or(
        session.vendorId
          ? and(
              eq(table.ownerOrgType, "vendor"),
              eq(table.ownerOrgId, session.vendorId),
            )
          : undefined,
        session.partnerId
          ? and(
              eq(table.ownerOrgType, "partner"),
              eq(table.ownerOrgId, session.partnerId),
            )
          : undefined,
      );
}

router.use("/work-hub", async (_req, res, next) => {
  if (!(await isWorkHubEnabled())) {
    sendApiError(res, 404, "work_hub.not_found", "Not found");
    return;
  }
  next();
});

router.get("/work-hub/audit", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const owner = session.vendorId
    ? { type: "vendor" as const, id: session.vendorId }
    : session.partnerId
      ? { type: "partner" as const, id: session.partnerId }
      : null;
  if (!owner) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  try {
    await ownAccess(session, owner, "policy.manage");
    const rows = await db
      .select({
        id: workHubAuditLogTable.id,
        action: workHubAuditLogTable.action,
        subjectType: workHubAuditLogTable.subjectType,
        subjectId: workHubAuditLogTable.subjectId,
        source: workHubAuditLogTable.source,
        metadata: workHubAuditLogTable.metadata,
        createdAt: workHubAuditLogTable.createdAt,
        actorUserId: workHubAuditLogTable.actorUserId,
        actorName: usersTable.displayName,
      })
      .from(workHubAuditLogTable)
      .leftJoin(usersTable, eq(usersTable.id, workHubAuditLogTable.actorUserId))
      .where(
        and(
          eq(workHubAuditLogTable.ownerOrgType, owner.type),
          eq(workHubAuditLogTable.ownerOrgId, owner.id),
        ),
      )
      .orderBy(
        desc(workHubAuditLogTable.createdAt),
        desc(workHubAuditLogTable.id),
      )
      .limit(Math.min(200, Math.max(1, Number(req.query.limit) || 100)));
    return res.json(rows);
  } catch (error) {
    return failure(res, error);
  }
});

router.get("/work-hub/home", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const now = new Date();
  const [tasks, announcements, shifts, meetings] = await Promise.all([
    db
      .select()
      .from(workHubTasksTable)
      .where(
        and(
          ownerFilter(session),
          or(
            eq(workHubTasksTable.assigneeUserId, session.userId),
            eq(workHubTasksTable.createdById, session.userId),
          ),
        ),
      )
      .orderBy(asc(workHubTasksTable.dueAt))
      .limit(50),
    db
      .select({
        announcement: workHubAnnouncementsTable,
        recipient: workHubAnnouncementRecipientsTable,
      })
      .from(workHubAnnouncementRecipientsTable)
      .innerJoin(
        workHubAnnouncementsTable,
        eq(
          workHubAnnouncementsTable.id,
          workHubAnnouncementRecipientsTable.announcementId,
        ),
      )
      .where(
        and(
          eq(workHubAnnouncementRecipientsTable.userId, session.userId),
          isNull(workHubAnnouncementsTable.withdrawnAt),
        ),
      )
      .orderBy(desc(workHubAnnouncementsTable.publishedAt))
      .limit(50),
    db
      .select({
        shift: workHubShiftsTable,
        assignment: workHubShiftAssignmentsTable,
      })
      .from(workHubShiftAssignmentsTable)
      .innerJoin(
        workHubShiftsTable,
        eq(workHubShiftsTable.id, workHubShiftAssignmentsTable.shiftId),
      )
      .where(
        and(
          eq(workHubShiftAssignmentsTable.userId, session.userId),
          gte(workHubShiftsTable.endsAt, now),
        ),
      )
      .orderBy(asc(workHubShiftsTable.startsAt))
      .limit(50),
    db
      .select({
        occurrence: workHubMeetingOccurrencesTable,
        meeting: workHubMeetingsTable,
        participant: workHubMeetingParticipantsTable,
      })
      .from(workHubMeetingParticipantsTable)
      .innerJoin(
        workHubMeetingOccurrencesTable,
        eq(
          workHubMeetingOccurrencesTable.id,
          workHubMeetingParticipantsTable.occurrenceId,
        ),
      )
      .innerJoin(
        workHubMeetingsTable,
        eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
      )
      .where(
        and(
          eq(workHubMeetingParticipantsTable.userId, session.userId),
          gte(
            workHubMeetingOccurrencesTable.startsAt,
            new Date(now.getTime() - 86_400_000),
          ),
        ),
      )
      .orderBy(asc(workHubMeetingOccurrencesTable.startsAt))
      .limit(50),
  ]);
  return res.json({
    generatedAt: now.toISOString(),
    tasks,
    announcements,
    shifts,
    meetings,
  });
});

router.get("/work-hub/tasks", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  return res.json(
    await db
      .select()
      .from(workHubTasksTable)
      .where(
        and(
          ownerFilter(session),
          req.query.status
            ? eq(workHubTasksTable.status, String(req.query.status))
            : undefined,
        ),
      )
      .orderBy(asc(workHubTasksTable.dueAt), desc(workHubTasksTable.createdAt))
      .limit(100),
  );
});

router.get("/work-hub/files", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const candidates = await db
    .select()
    .from(workHubFilesTable)
    .where(eq(workHubFilesTable.state, "finalized"))
    .orderBy(desc(workHubFilesTable.finalizedAt))
    .limit(500);
  const visible = (
    await Promise.all(
      candidates.map(async (file) => {
        if (!file.channelId)
          return sessionCanSeeOwner(session, file.ownerOrgType, file.ownerOrgId)
            ? file
            : null;
        try {
          await resolveChannelAccess(session, file.channelId, "channel.read");
          return file;
        } catch {
          return null;
        }
      }),
    )
  )
    .filter(Boolean)
    .slice(0, 100);
  return res.json(visible);
});

router.get("/work-hub/admin", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  if (session.role !== "admin" && session.membershipRole !== "admin")
    return sendApiError(
      res,
      403,
      "work_hub.forbidden",
      "Administrator access required",
    );
  const [checklists, forms, approvals, announcements] = await Promise.all([
    db
      .select()
      .from(workHubChecklistTemplatesTable)
      .where(ownerFilterFor(session, workHubChecklistTemplatesTable))
      .orderBy(desc(workHubChecklistTemplatesTable.createdAt))
      .limit(100),
    db
      .select()
      .from(workHubFormTemplatesTable)
      .where(ownerFilterFor(session, workHubFormTemplatesTable))
      .orderBy(desc(workHubFormTemplatesTable.createdAt))
      .limit(100),
    db
      .select()
      .from(workHubApprovalRequestsTable)
      .where(ownerFilterFor(session, workHubApprovalRequestsTable))
      .orderBy(desc(workHubApprovalRequestsTable.createdAt))
      .limit(100),
    db
      .select()
      .from(workHubAnnouncementsTable)
      .where(ownerFilterFor(session, workHubAnnouncementsTable))
      .orderBy(desc(workHubAnnouncementsTable.publishedAt))
      .limit(100),
  ]);
  const [checklistInstances, formInstances] = await Promise.all([
    checklists.length
      ? db
          .select()
          .from(workHubChecklistInstancesTable)
          .where(
            inArray(
              workHubChecklistInstancesTable.templateId,
              checklists.map((item) => item.id),
            ),
          )
          .orderBy(desc(workHubChecklistInstancesTable.createdAt))
          .limit(100)
      : Promise.resolve([]),
    forms.length
      ? db
          .select()
          .from(workHubFormInstancesTable)
          .where(
            inArray(
              workHubFormInstancesTable.templateId,
              forms.map((item) => item.id),
            ),
          )
          .orderBy(desc(workHubFormInstancesTable.createdAt))
          .limit(100)
      : Promise.resolve([]),
  ]);
  return res.json({
    checklists,
    checklistInstances,
    forms,
    formInstances,
    approvals,
    announcements,
  });
});

router.get("/work-hub/required-actions", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [checklists, forms, approvals] = await Promise.all([
    db
      .select({
        instance: workHubChecklistInstancesTable,
        template: workHubChecklistTemplatesTable,
      })
      .from(workHubChecklistInstancesTable)
      .innerJoin(
        workHubChecklistTemplatesTable,
        eq(
          workHubChecklistTemplatesTable.id,
          workHubChecklistInstancesTable.templateId,
        ),
      )
      .where(
        and(
          eq(workHubChecklistInstancesTable.assigneeUserId, session.userId),
          ownerFilterFor(session, workHubChecklistTemplatesTable),
        ),
      )
      .orderBy(desc(workHubChecklistInstancesTable.createdAt)),
    db
      .select({
        instance: workHubFormInstancesTable,
        template: workHubFormTemplatesTable,
      })
      .from(workHubFormInstancesTable)
      .innerJoin(
        workHubFormTemplatesTable,
        eq(workHubFormTemplatesTable.id, workHubFormInstancesTable.templateId),
      )
      .where(
        and(
          eq(workHubFormInstancesTable.assigneeUserId, session.userId),
          ownerFilterFor(session, workHubFormTemplatesTable),
        ),
      )
      .orderBy(desc(workHubFormInstancesTable.createdAt)),
    db
      .select({
        request: workHubApprovalRequestsTable,
        step: workHubApprovalStepsTable,
      })
      .from(workHubApprovalStepsTable)
      .innerJoin(
        workHubApprovalRequestsTable,
        eq(
          workHubApprovalRequestsTable.id,
          workHubApprovalStepsTable.requestId,
        ),
      )
      .where(
        and(
          eq(workHubApprovalStepsTable.approverUserId, session.userId),
          ownerFilterFor(session, workHubApprovalRequestsTable),
        ),
      )
      .orderBy(desc(workHubApprovalRequestsTable.createdAt)),
  ]);
  return res.json({ checklists, forms, approvals });
});

const templatePayload = z.object({
  name: z.string().trim().min(1).max(200),
  definition: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        label: z.string().trim().min(1).max(300),
        type: z.enum(["checkbox", "text", "number", "date", "choice"]),
        required: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(100),
});

async function createTemplate(
  req: Request,
  res: Response,
  kind: "checklist" | "form",
) {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(session, envelope.owner, "task.assign", envelope.context);
    const payload = templatePayload.parse(envelope.payload);
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      `${kind}.template.create`,
      envelope,
      async (tx) => {
        const [record] =
          kind === "checklist"
            ? await tx
                .insert(workHubChecklistTemplatesTable)
                .values({
                  ownerOrgType: envelope.owner.type,
                  ownerOrgId: envelope.owner.id,
                  name: payload.name,
                  definition: payload.definition,
                  createdById: session.userId,
                })
                .returning()
            : await tx
                .insert(workHubFormTemplatesTable)
                .values({
                  ownerOrgType: envelope.owner.type,
                  ownerOrgId: envelope.owner.id,
                  name: payload.name,
                  definition: payload.definition,
                  createdById: session.userId,
                })
                .returning();
        await appendWorkHubAudit(
          {
            actorUserId: session.userId,
            owner: envelope.owner,
            action: `${kind}.template.created`,
            subjectType: `${kind}_template`,
            subjectId: record.id,
            newVersion: 1,
            source: clientSource(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return record;
      },
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
}

router.post("/work-hub/admin/checklists", (req, res) =>
  createTemplate(req, res, "checklist"),
);
router.post("/work-hub/admin/forms", (req, res) =>
  createTemplate(req, res, "form"),
);

async function assignTemplate(
  req: Request,
  res: Response,
  kind: "checklist" | "form",
) {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(session, envelope.owner, "task.assign", envelope.context);
    const templateId = String(req.params.id);
    const payload = z
      .object({
        assigneeUserId: z.number().int().positive(),
        channelId: z.string().uuid().nullable().optional(),
        dueAt: z.iso.datetime().nullable().optional(),
      })
      .parse(envelope.payload);
    await assertOwnerUsers(envelope.owner, [payload.assigneeUserId]);
    const template =
      kind === "checklist"
        ? (
            await db
              .select()
              .from(workHubChecklistTemplatesTable)
              .where(
                and(
                  eq(workHubChecklistTemplatesTable.id, templateId),
                  eq(
                    workHubChecklistTemplatesTable.ownerOrgType,
                    envelope.owner.type,
                  ),
                  eq(
                    workHubChecklistTemplatesTable.ownerOrgId,
                    envelope.owner.id,
                  ),
                ),
              )
              .limit(1)
          )[0]
        : (
            await db
              .select()
              .from(workHubFormTemplatesTable)
              .where(
                and(
                  eq(workHubFormTemplatesTable.id, templateId),
                  eq(
                    workHubFormTemplatesTable.ownerOrgType,
                    envelope.owner.type,
                  ),
                  eq(workHubFormTemplatesTable.ownerOrgId, envelope.owner.id),
                ),
              )
              .limit(1)
          )[0];
    if (!template) throw new WorkHubAccessError("not_found");
    if (payload.channelId)
      await resolveChannelAccess(session, payload.channelId, "task.assign");
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      `${kind}.assign`,
      envelope,
      async (tx) => {
        const [record] =
          kind === "checklist"
            ? await tx
                .insert(workHubChecklistInstancesTable)
                .values({
                  templateId: template.id,
                  templateVersion: template.currentVersion,
                  snapshot: template.definition,
                  assigneeUserId: payload.assigneeUserId,
                  channelId: payload.channelId ?? null,
                  dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
                })
                .returning()
            : await tx
                .insert(workHubFormInstancesTable)
                .values({
                  templateId: template.id,
                  templateVersion: template.currentVersion,
                  definitionSnapshot: template.definition,
                  assigneeUserId: payload.assigneeUserId,
                  channelId: payload.channelId ?? null,
                  dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
                })
                .returning();
        await appendWorkHubAudit(
          {
            actorUserId: session.userId,
            owner: envelope.owner,
            action: `${kind}.assigned`,
            subjectType: `${kind}_instance`,
            subjectId: record.id,
            newVersion: 1,
            source: clientSource(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return record;
      },
    );
    if (!result.replayed)
      await notifyUsers([payload.assigneeUserId], {
        type: `work_hub_${kind}_assigned`,
        category: "work_hub_tasks",
        title: `${kind === "form" ? "Form" : "Checklist"} assigned`,
        body: template.name,
        link: `/work-hub/tasks?${kind}=${result.resource.id}`,
        dedupeKey: `work-hub-${kind}:${result.resource.id}`,
      });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
}

router.post("/work-hub/admin/checklists/:id/assign", (req, res) =>
  assignTemplate(req, res, "checklist"),
);
router.post("/work-hub/admin/forms/:id/assign", (req, res) =>
  assignTemplate(req, res, "form"),
);

router.post("/work-hub/checklists/:id/respond", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = z
      .object({
        responses: z.record(z.string(), z.unknown()),
        complete: z.boolean().default(false),
      })
      .parse(envelope.payload);
    const [record] = await db
      .select({
        instance: workHubChecklistInstancesTable,
        template: workHubChecklistTemplatesTable,
      })
      .from(workHubChecklistInstancesTable)
      .innerJoin(
        workHubChecklistTemplatesTable,
        eq(
          workHubChecklistTemplatesTable.id,
          workHubChecklistInstancesTable.templateId,
        ),
      )
      .where(
        and(
          eq(workHubChecklistInstancesTable.id, String(req.params.id)),
          eq(workHubChecklistInstancesTable.assigneeUserId, session.userId),
          eq(workHubChecklistTemplatesTable.ownerOrgType, envelope.owner.type),
          eq(workHubChecklistTemplatesTable.ownerOrgId, envelope.owner.id),
        ),
      )
      .limit(1);
    if (!record) throw new WorkHubAccessError("not_found");
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "checklist.respond",
      envelope,
      async (tx) => {
        const [updated] = await tx
          .update(workHubChecklistInstancesTable)
          .set({
            responses: payload.responses,
            status: payload.complete ? "completed" : "in_progress",
          })
          .where(eq(workHubChecklistInstancesTable.id, record.instance.id))
          .returning();
        await appendWorkHubAudit(
          {
            actorUserId: session.userId,
            owner: envelope.owner,
            action: payload.complete
              ? "checklist.completed"
              : "checklist.updated",
            subjectType: "checklist_instance",
            subjectId: updated.id,
            source: clientSource(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return updated;
      },
    );
    return res.json(result);
  } catch (error) {
    return failure(res, error);
  }
});

router.post("/work-hub/forms/:id/submit", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = z
      .object({ values: z.record(z.string(), z.unknown()) })
      .parse(envelope.payload);
    const [record] = await db
      .select({
        instance: workHubFormInstancesTable,
        template: workHubFormTemplatesTable,
      })
      .from(workHubFormInstancesTable)
      .innerJoin(
        workHubFormTemplatesTable,
        eq(workHubFormTemplatesTable.id, workHubFormInstancesTable.templateId),
      )
      .where(
        and(
          eq(workHubFormInstancesTable.id, String(req.params.id)),
          eq(workHubFormInstancesTable.assigneeUserId, session.userId),
          eq(workHubFormTemplatesTable.ownerOrgType, envelope.owner.type),
          eq(workHubFormTemplatesTable.ownerOrgId, envelope.owner.id),
        ),
      )
      .limit(1);
    if (!record) throw new WorkHubAccessError("not_found");
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "form.submit",
      envelope,
      async (tx) => {
        const prior = await tx
          .select()
          .from(workHubFormSubmissionsTable)
          .where(eq(workHubFormSubmissionsTable.instanceId, record.instance.id))
          .orderBy(desc(workHubFormSubmissionsTable.version))
          .limit(1);
        const [submission] = await tx
          .insert(workHubFormSubmissionsTable)
          .values({
            instanceId: record.instance.id,
            priorSubmissionId: prior[0]?.id ?? null,
            version: (prior[0]?.version ?? 0) + 1,
            submittedById: session.userId,
            values: payload.values,
          })
          .returning();
        await appendWorkHubAudit(
          {
            actorUserId: session.userId,
            owner: envelope.owner,
            action: "form.submitted",
            subjectType: "form_submission",
            subjectId: submission.id,
            newVersion: submission.version,
            source: clientSource(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return submission;
      },
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});

router.post("/work-hub/admin/approvals", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(session, envelope.owner, "task.assign", envelope.context);
    const payload = z
      .object({
        subjectType: z.string().min(1).max(80),
        subjectId: z.string().min(1).max(200),
        subjectVersion: z.number().int().positive().default(1),
        approverUserIds: z.array(z.number().int().positive()).min(1).max(50),
        mode: z.enum(["ordered", "parallel"]).default("ordered"),
      })
      .parse(envelope.payload);
    const approvers = [...new Set(payload.approverUserIds)];
    await assertOwnerUsers(envelope.owner, approvers);
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "approval.create",
      envelope,
      async (tx) => {
        const [request] = await tx
          .insert(workHubApprovalRequestsTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            subjectType: payload.subjectType,
            subjectId: payload.subjectId,
            subjectVersion: payload.subjectVersion,
            mode: payload.mode,
            requestedById: session.userId,
          })
          .returning();
        await tx.insert(workHubApprovalStepsTable).values(
          approvers.map((approverUserId, index) => ({
            requestId: request.id,
            stepOrder: payload.mode === "parallel" ? 1 : index + 1,
            approverUserId,
          })),
        );
        await appendWorkHubAudit(
          {
            actorUserId: session.userId,
            owner: envelope.owner,
            action: "approval.requested",
            subjectType: "approval",
            subjectId: request.id,
            newVersion: 1,
            source: clientSource(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return request;
      },
    );
    if (!result.replayed)
      await notifyUsers(approvers, {
        type: "work_hub_approval_requested",
        category: "work_hub_tasks",
        title: "Approval requested",
        body: `${payload.subjectType} requires review`,
        link: `/work-hub/tasks?approval=${result.resource.id}`,
        dedupeKey: `work-hub-approval:${result.resource.id}`,
      });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});

router.post("/work-hub/admin/approvals/:id/decide", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = z
      .object({
        decision: z.enum(["approved", "rejected"]),
        comment: z.string().max(5000).optional(),
      })
      .parse(envelope.payload);
    const [request] = await db
      .select()
      .from(workHubApprovalRequestsTable)
      .where(
        and(
          eq(workHubApprovalRequestsTable.id, req.params.id),
          ownerFilterFor(session, workHubApprovalRequestsTable),
        ),
      )
      .limit(1);
    if (!request) throw new WorkHubAccessError("not_found");
    if (
      request.ownerOrgType !== envelope.owner.type ||
      request.ownerOrgId !== envelope.owner.id
    )
      throw new WorkHubAccessError("not_found");
    const [step] = await db
      .select()
      .from(workHubApprovalStepsTable)
      .where(
        and(
          eq(workHubApprovalStepsTable.requestId, request.id),
          eq(workHubApprovalStepsTable.approverUserId, session.userId),
          isNull(workHubApprovalStepsTable.decision),
        ),
      )
      .orderBy(asc(workHubApprovalStepsTable.stepOrder))
      .limit(1);
    if (!step) throw new WorkHubAccessError("forbidden");
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "approval.decide",
      envelope,
      async (tx) => {
        await tx
          .update(workHubApprovalStepsTable)
          .set({
            decision: payload.decision,
            comment: payload.comment,
            decidedAt: new Date(),
          })
          .where(eq(workHubApprovalStepsTable.id, step.id));
        const remaining = await tx
          .select()
          .from(workHubApprovalStepsTable)
          .where(
            and(
              eq(workHubApprovalStepsTable.requestId, request.id),
              isNull(workHubApprovalStepsTable.decision),
            ),
          );
        const status =
          payload.decision === "rejected"
            ? "rejected"
            : remaining.length === 0
              ? "approved"
              : "pending";
        const [updated] = await tx
          .update(workHubApprovalRequestsTable)
          .set({ status })
          .where(eq(workHubApprovalRequestsTable.id, request.id))
          .returning();
        await appendWorkHubAudit(
          {
            actorUserId: session.userId,
            owner: envelope.owner,
            action: `approval.${payload.decision}`,
            subjectType: "approval",
            subjectId: request.id,
            source: clientSource(req),
            operationId: envelope.operationId,
          },
          tx,
        );
        return updated;
      },
    );
    return res.json(result);
  } catch (error) {
    return failure(res, error);
  }
});
router.post("/work-hub/tasks", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(session, envelope.owner, "task.assign", envelope.context);
    const payload = z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(20_000).nullable().optional(),
        assigneeUserId: z.number().int().positive().nullable().optional(),
        dueAt: z.iso.datetime().nullable().optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        channelId: z.string().uuid().nullable().optional(),
        recurrence: z.unknown().nullable().optional(),
      })
      .parse(envelope.payload);
    await assertOwnerUsers(
      envelope.owner,
      payload.assigneeUserId ? [payload.assigneeUserId] : [],
    );
    if (payload.channelId)
      await resolveChannelAccess(session, payload.channelId, "task.assign");
    const recurrence = payload.recurrence
      ? normalizeRecurrenceRule(payload.recurrence as never)
      : null;
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "task.create",
      envelope,
      async (tx) => {
        const [task] = await tx
          .insert(workHubTasksTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            channelId: payload.channelId ?? null,
            title: payload.title,
            description: payload.description ?? null,
            assigneeUserId: payload.assigneeUserId ?? null,
            dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
            priority: payload.priority,
            recurrence,
            createdById: session.userId,
          })
          .returning();
        await tx.insert(workHubTaskEventsTable).values({
          taskId: task.id,
          actorUserId: session.userId,
          eventType: "created",
        });
        return task;
      },
    );
    if (payload.assigneeUserId && !result.replayed)
      await notifyUsers([payload.assigneeUserId], {
        type: "work_hub_task_assigned",
        category: "work_hub_tasks",
        title: "New Work Hub task",
        body: payload.title,
        link: `/work-hub/tasks/${result.resource.id}`,
        dedupeKey: `work-hub-task:${result.resource.id}:assigned`,
      });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});
router.patch("/work-hub/tasks/:id", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = z
      .object({
        status: z.enum(["open", "in_progress", "completed", "cancelled"]),
      })
      .parse(envelope.payload);
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "task.update",
      envelope,
      async (tx) => {
        const [current] = await tx
          .select()
          .from(workHubTasksTable)
          .where(eq(workHubTasksTable.id, req.params.id))
          .limit(1);
        if (!current) throw new WorkHubAccessError("not_found");
        if (
          current.ownerOrgType !== envelope.owner.type ||
          current.ownerOrgId !== envelope.owner.id ||
          !sessionCanSeeOwner(session, current.ownerOrgType, current.ownerOrgId)
        )
          throw new WorkHubAccessError("not_found");
        if (
          current.assigneeUserId !== session.userId &&
          current.createdById !== session.userId &&
          session.role !== "admin" &&
          session.membershipRole !== "admin"
        )
          throw new WorkHubAccessError("forbidden");
        if (current.version !== envelope.expectedVersion)
          throw new Error("work_hub.version_conflict");
        const [updated] = await tx
          .update(workHubTasksTable)
          .set({
            status: payload.status,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workHubTasksTable.id, current.id))
          .returning();
        await tx.insert(workHubTaskEventsTable).values({
          taskId: current.id,
          actorUserId: session.userId,
          eventType: `status.${payload.status}`,
        });
        return updated;
      },
    );
    return res.json(result);
  } catch (error) {
    return failure(res, error);
  }
});

router.post("/work-hub/announcements", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(
      session,
      envelope.owner,
      "announcement.publish",
      envelope.context,
    );
    const payload = z
      .object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(50_000),
        recipientUserIds: z.array(z.number().int().positive()).min(1).max(5000),
        urgency: z.enum(["normal", "urgent"]).default("normal"),
        acknowledgementRequired: z.boolean().default(false),
        expiresAt: z.iso.datetime().nullable().optional(),
      })
      .parse(envelope.payload);
    const recipients = [...new Set(payload.recipientUserIds)];
    await assertOwnerUsers(envelope.owner, recipients);
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "announcement.publish",
      envelope,
      async (tx) => {
        const [announcement] = await tx
          .insert(workHubAnnouncementsTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            title: payload.title,
            body: payload.body,
            urgency: payload.urgency,
            acknowledgementRequired: payload.acknowledgementRequired,
            publishedById: session.userId,
            expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
          })
          .returning();
        await tx.insert(workHubAnnouncementRecipientsTable).values(
          recipients.map((userId) => ({
            announcementId: announcement.id,
            userId,
          })),
        );
        return announcement;
      },
    );
    if (!result.replayed)
      await notifyUsers(recipients, {
        type:
          payload.urgency === "urgent"
            ? "work_hub_announcement_urgent"
            : "work_hub_announcement",
        category: "system",
        title: payload.title,
        body: payload.body.slice(0, 180),
        link: `/work-hub/announcements/${result.resource.id}`,
        dedupeKey: `work-hub-announcement:${result.resource.id}`,
      });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});
router.post("/work-hub/announcements/:id/acknowledge", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [recipient] = await db
    .update(workHubAnnouncementRecipientsTable)
    .set({ acknowledgedAt: new Date(), viewedAt: new Date() })
    .where(
      and(
        eq(workHubAnnouncementRecipientsTable.announcementId, req.params.id),
        eq(workHubAnnouncementRecipientsTable.userId, session.userId),
      ),
    )
    .returning();
  if (!recipient)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const [announcement] = await db
    .select()
    .from(workHubAnnouncementsTable)
    .where(eq(workHubAnnouncementsTable.id, req.params.id));
  await db
    .insert(workHubAcknowledgementsTable)
    .values({
      ownerOrgType: announcement.ownerOrgType,
      ownerOrgId: announcement.ownerOrgId,
      subjectType: "announcement",
      subjectId: announcement.id,
      subjectVersion: announcement.version,
      userId: session.userId,
    })
    .onConflictDoNothing();
  return res.json(recipient);
});

router.get("/work-hub/calendar", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const start = new Date(String(req.query.start));
  const end = new Date(String(req.query.end));
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end
  )
    return sendApiError(
      res,
      400,
      "work_hub.invalid_operation",
      "Invalid calendar range",
    );
  const shiftOwner =
    session.role === "admin"
      ? undefined
      : or(
          session.vendorId
            ? and(
                eq(workHubShiftsTable.ownerOrgType, "vendor"),
                eq(workHubShiftsTable.ownerOrgId, session.vendorId),
              )
            : undefined,
          session.partnerId
            ? and(
                eq(workHubShiftsTable.ownerOrgType, "partner"),
                eq(workHubShiftsTable.ownerOrgId, session.partnerId),
              )
            : undefined,
          sql`${workHubShiftsTable.sharedWithUserIds} @> ${JSON.stringify([session.userId])}::jsonb`,
        );
  const meetingOwner =
    session.role === "admin"
      ? undefined
      : or(
          session.vendorId
            ? and(
                eq(workHubMeetingsTable.ownerOrgType, "vendor"),
                eq(workHubMeetingsTable.ownerOrgId, session.vendorId),
              )
            : undefined,
          session.partnerId
            ? and(
                eq(workHubMeetingsTable.ownerOrgType, "partner"),
                eq(workHubMeetingsTable.ownerOrgId, session.partnerId),
              )
            : undefined,
        );
  const [shifts, tasks, meetings] = await Promise.all([
    db
      .select()
      .from(workHubShiftsTable)
      .where(
        and(
          shiftOwner,
          lte(workHubShiftsTable.startsAt, end),
          gte(workHubShiftsTable.endsAt, start),
        ),
      ),
    db
      .select()
      .from(workHubTasksTable)
      .where(
        and(
          ownerFilter(session),
          gte(workHubTasksTable.dueAt, start),
          lte(workHubTasksTable.dueAt, end),
        ),
      ),
    db
      .select({
        occurrence: workHubMeetingOccurrencesTable,
        meeting: workHubMeetingsTable,
      })
      .from(workHubMeetingOccurrencesTable)
      .innerJoin(
        workHubMeetingsTable,
        eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
      )
      .where(
        and(
          meetingOwner,
          lte(workHubMeetingOccurrencesTable.startsAt, end),
          or(
            isNull(workHubMeetingOccurrencesTable.endsAt),
            gte(workHubMeetingOccurrencesTable.endsAt, start),
          ),
        ),
      ),
  ]);
  return res.json({
    shifts: shifts.map((item) => ({
      source: "vndrly",
      authority: "work_hub_shift",
      item,
    })),
    tasks: tasks.map((item) => ({
      source: "vndrly",
      authority: "work_hub_task",
      item,
    })),
    meetings: meetings.map((item) => ({
      source: "vndrly",
      authority: "work_hub_meeting",
      item,
    })),
    external: [],
  });
});
router.post("/work-hub/shifts", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(session, envelope.owner, "shift.manage", envelope.context);
    const payload = z
      .object({
        title: z.string().trim().min(1).max(200),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        timezone: z.string().min(3).max(80),
        open: z.boolean().default(false),
        assigneeUserIds: z
          .array(z.number().int().positive())
          .max(500)
          .default([]),
        qualificationCodes: z.array(z.string().max(80)).max(50).default([]),
        recurrence: z.unknown().nullable().optional(),
        calendarType: z.enum(["company", "project"]).default("company"),
        projectName: z.string().trim().max(200).nullable().optional(),
        milestoneStatus: z
          .enum(["completed", "in_progress", "upcoming", "blocked", "overdue"])
          .default("upcoming"),
        percentComplete: z.number().int().min(0).max(100).default(0),
        sharedWithUserIds: z
          .array(z.number().int().positive())
          .max(500)
          .default([]),
      })
      .parse(envelope.payload);
    await assertOwnerUsers(envelope.owner, [
      ...payload.assigneeUserIds,
      ...payload.sharedWithUserIds,
    ]);
    if (new Date(payload.startsAt) >= new Date(payload.endsAt))
      throw new z.ZodError([]);
    const recurrence = payload.recurrence
      ? normalizeRecurrenceRule(payload.recurrence as never)
      : null;
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "shift.create",
      envelope,
      async (tx) => {
        const [shift] = await tx
          .insert(workHubShiftsTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            title: payload.title,
            startsAt: new Date(payload.startsAt),
            endsAt: new Date(payload.endsAt),
            timezone: payload.timezone,
            open: payload.open,
            qualificationCodes: payload.qualificationCodes,
            recurrence,
            calendarType: payload.calendarType,
            projectName: payload.projectName ?? null,
            milestoneStatus: payload.milestoneStatus,
            percentComplete: payload.percentComplete,
            sharedWithUserIds: [...new Set(payload.sharedWithUserIds)],
            createdById: session.userId,
          })
          .returning();
        if (payload.assigneeUserIds.length)
          await tx
            .insert(workHubShiftAssignmentsTable)
            .values(
              [...new Set(payload.assigneeUserIds)].map((userId) => ({
                shiftId: shift.id,
                userId,
                assignedById: session.userId,
              })),
            )
            .onConflictDoNothing();
        return shift;
      },
    );
    if (!result.replayed)
      await notifyUsers(payload.assigneeUserIds, {
        type: "work_hub_shift_assigned",
        category: "crew",
        title: "Shift assigned",
        body: payload.title,
        link: `/work-hub/calendar?shift=${result.resource.id}`,
        dedupeKey: `work-hub-shift:${result.resource.id}`,
      });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});
router.post("/work-hub/shifts/:id/claim", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [shift] = await db
    .select()
    .from(workHubShiftsTable)
    .where(eq(workHubShiftsTable.id, req.params.id));
  if (!shift) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  if (!sessionCanSeeOwner(session, shift.ownerOrgType, shift.ownerOrgId))
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  if (!shift.open)
    return sendApiError(
      res,
      409,
      "work_hub.invalid_operation",
      "Shift is not open",
    );
  const assignment = await claimOpenShift(shift.id, session.userId);
  if (!assignment)
    return sendApiError(
      res,
      409,
      "work_hub.invalid_operation",
      "Shift was already claimed",
    );
  return res.status(201).json(assignment);
});

router.post("/work-hub/meetings", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    await ownAccess(session, envelope.owner, "meeting.host", envelope.context);
    const payload = z
      .object({
        title: z.string().trim().min(1).max(200),
        agenda: z.string().max(50_000).nullable().optional(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime().nullable().optional(),
        timezone: z.string().min(3).max(80),
        recordingAllowed: z.boolean().default(false),
        participantUserIds: z
          .array(z.number().int().positive())
          .max(500)
          .default([]),
        recurrence: z.unknown().nullable().optional(),
      })
      .parse(envelope.payload);
    const recurrence = payload.recurrence
      ? normalizeRecurrenceRule(payload.recurrence as never)
      : null;
    const participants = [
      ...new Set([session.userId, ...payload.participantUserIds]),
    ];
    await assertOwnerUsers(envelope.owner, payload.participantUserIds);
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "meeting.create",
      envelope,
      async (tx) => {
        const [meeting] = await tx
          .insert(workHubMeetingsTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            title: payload.title,
            agenda: payload.agenda ?? null,
            timezone: payload.timezone,
            recurrence,
            recordingAllowed: payload.recordingAllowed,
            createdById: session.userId,
          })
          .returning();
        const [occurrence] = await tx
          .insert(workHubMeetingOccurrencesTable)
          .values({
            meetingId: meeting.id,
            startsAt: new Date(payload.startsAt),
            endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
          })
          .returning();
        await tx.insert(workHubMeetingParticipantsTable).values(
          participants.map((userId) => ({
            occurrenceId: occurrence.id,
            userId,
            role: userId === session.userId ? "host" : "participant",
          })),
        );
        return { meeting, occurrence };
      },
    );
    if (!result.replayed)
      await notifyUsers(
        participants.filter((id) => id !== session.userId),
        {
          type: "work_hub_meeting_invite",
          category: "system",
          title: "Meeting invitation",
          body: payload.title,
          link: `/work-hub/meetings/${result.resource.occurrence.id}`,
          dedupeKey: `work-hub-meeting:${result.resource.occurrence.id}:invite`,
        },
      );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});
router.post("/work-hub/meetings/:occurrenceId/consent", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const payload = z
    .object({
      policyVersion: z.number().int().positive(),
      response: z.enum(["accepted", "declined"]),
    })
    .parse(req.body);
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const [consent] = await db
    .insert(workHubMeetingConsentsTable)
    .values({
      occurrenceId: req.params.occurrenceId,
      userId: session.userId,
      ...payload,
    })
    .onConflictDoUpdate({
      target: [
        workHubMeetingConsentsTable.occurrenceId,
        workHubMeetingConsentsTable.userId,
        workHubMeetingConsentsTable.policyVersion,
      ],
      set: { response: payload.response, respondedAt: new Date() },
    })
    .returning();
  return res.json(consent);
});
router.post("/work-hub/meetings/:occurrenceId/join", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const [occurrence] = await db
    .select()
    .from(workHubMeetingOccurrencesTable)
    .where(eq(workHubMeetingOccurrencesTable.id, req.params.occurrenceId));
  if (!occurrence)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const roomId = occurrence.providerRoomId ?? `vndrly-${randomUUID()}`;
  if (!occurrence.providerRoomId)
    await db
      .update(workHubMeetingOccurrencesTable)
      .set({
        providerRoomId: roomId,
        status: "live",
        transcriptState: "active",
      })
      .where(eq(workHubMeetingOccurrencesTable.id, occurrence.id));
  await db
    .insert(workHubMeetingAttendanceTable)
    .values({ occurrenceId: occurrence.id, userId: session.userId });
  const participants = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(eq(workHubMeetingParticipantsTable.occurrenceId, occurrence.id));
  return res.json({
    roomId,
    userId: session.userId,
    participants: participants.map(({ userId, role, muted, handRaisedAt }) => ({
      userId,
      role,
      muted,
      handRaisedAt,
    })),
    transcription: true,
    iceServers: resolveVndrlyIceServers(),
  });
});

router.post("/work-hub/meetings/:occurrenceId/signal", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const payload = z
    .object({
      toUserId: z.number().int().positive().nullable().default(null),
      kind: z.enum(["offer", "answer", "ice"]),
      payload: z.unknown(),
    })
    .parse(req.body);
  pruneMeetingSignals();
  const signal: MeetingSignal = {
    id: randomUUID(),
    occurrenceId: req.params.occurrenceId,
    fromUserId: session.userId,
    ...payload,
    createdAt: Date.now(),
  };
  meetingSignals.set(req.params.occurrenceId, [
    ...(meetingSignals.get(req.params.occurrenceId) ?? []),
    signal,
  ]);
  return res.status(201).json({ id: signal.id });
});

router.get("/work-hub/meetings/:occurrenceId/signals", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const since = Number(req.query.since ?? 0);
  pruneMeetingSignals();
  return res.json(
    (meetingSignals.get(req.params.occurrenceId) ?? []).filter(
      (signal) =>
        signal.createdAt > since &&
        signal.fromUserId !== session.userId &&
        (signal.toUserId == null || signal.toUserId === session.userId),
    ),
  );
});

router.post("/work-hub/meetings/:occurrenceId/presence", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const payload = z
    .object({
      muted: z.boolean().optional(),
      handRaised: z.boolean().optional(),
    })
    .parse(req.body);
  const [updated] = await db
    .update(workHubMeetingParticipantsTable)
    .set({
      ...(payload.muted === undefined ? {} : { muted: payload.muted }),
      ...(payload.handRaised === undefined
        ? {}
        : { handRaisedAt: payload.handRaised ? new Date() : null }),
    })
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    )
    .returning();
  if (!updated)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  return res.json(updated);
});

router.post("/work-hub/meetings/:occurrenceId/transcript", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const payload = z
    .object({
      text: z.string().trim().min(1).max(20_000),
      startsAtMs: z.number().int().min(0),
      endsAtMs: z.number().int().min(0),
    })
    .parse(req.body);
  let [artifact] = await db
    .select()
    .from(workHubMeetingArtifactsTable)
    .where(
      and(
        eq(workHubMeetingArtifactsTable.occurrenceId, req.params.occurrenceId),
        eq(workHubMeetingArtifactsTable.artifactType, "transcript"),
      ),
    );
  if (!artifact)
    [artifact] = await db
      .insert(workHubMeetingArtifactsTable)
      .values({
        occurrenceId: req.params.occurrenceId,
        artifactType: "transcript",
        state: "active",
        metadata: { consentNotice: true },
      })
      .returning();
  const [segment] = await db
    .insert(workHubTranscriptSegmentsTable)
    .values({
      artifactId: artifact.id,
      speakerUserId: session.userId,
      ...payload,
    })
    .returning();
  return res.status(201).json(segment);
});
router.post("/work-hub/meetings/:occurrenceId/chat", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const body = z.string().trim().min(1).max(10_000).parse(req.body?.body);
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant)
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const [message] = await db
    .insert(workHubMeetingChatTable)
    .values({
      occurrenceId: req.params.occurrenceId,
      userId: session.userId,
      body,
    })
    .returning();
  return res.status(201).json(message);
});
router.get("/work-hub/meetings/:occurrenceId/catch-up", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, session.userId),
      ),
    );
  if (!participant && session.role !== "admin")
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const [occurrence] = await db
    .select({
      occurrence: workHubMeetingOccurrencesTable,
      meeting: workHubMeetingsTable,
    })
    .from(workHubMeetingOccurrencesTable)
    .innerJoin(
      workHubMeetingsTable,
      eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
    )
    .where(eq(workHubMeetingOccurrencesTable.id, req.params.occurrenceId));
  const artifacts = await db
    .select()
    .from(workHubMeetingArtifactsTable)
    .where(
      eq(workHubMeetingArtifactsTable.occurrenceId, req.params.occurrenceId),
    );
  const artifactIds = artifacts.map((item) => item.id);
  const [attendance, chat, transcript] = await Promise.all([
    db
      .select()
      .from(workHubMeetingAttendanceTable)
      .where(
        eq(workHubMeetingAttendanceTable.occurrenceId, req.params.occurrenceId),
      ),
    db
      .select()
      .from(workHubMeetingChatTable)
      .where(eq(workHubMeetingChatTable.occurrenceId, req.params.occurrenceId))
      .orderBy(asc(workHubMeetingChatTable.createdAt)),
    artifactIds.length
      ? db
          .select()
          .from(workHubTranscriptSegmentsTable)
          .where(
            inArray(workHubTranscriptSegmentsTable.artifactId, artifactIds),
          )
          .orderBy(asc(workHubTranscriptSegmentsTable.startsAtMs))
      : Promise.resolve([]),
  ]);
  return res.json({
    ...occurrence,
    attendance,
    chat,
    artifacts,
    transcript,
    recap: null,
    suggestedTasks: [],
  });
});

router.post("/work-hub/files/reserve", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const payload = z
      .object({
        channelId: z.string().uuid(),
        fileName: z.string().trim().min(1).max(255),
        contentType: z.string().trim().min(1).max(120),
        byteSize: z
          .number()
          .int()
          .positive()
          .max(25 * 1024 * 1024),
        checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i),
        voiceMetadata: z.unknown().nullable().optional(),
        category: z.string().trim().max(80).default("General Notes"),
        accessLevel: z.enum(["internal", "shared"]).default("internal"),
        tags: z.array(z.string().trim().max(50)).max(30).default([]),
      })
      .parse(envelope.payload);
    const { channel } = await resolveChannelAccess(
      session,
      payload.channelId,
      "channel.write",
    );
    assertOwnerMatchesChannel(envelope.owner, channel);
    const voiceMetadata = payload.voiceMetadata
      ? validateVoiceNoteMetadata(payload.voiceMetadata)
      : null;
    const mediaMetadata = {
      ...(voiceMetadata ?? {}),
      category: payload.category,
      accessLevel: payload.accessLevel,
      tags: payload.tags,
    };
    const descriptor = storage.getUploadDescriptor();
    const result = await executeWorkHubCommand(
      { userId: session.userId, source: clientSource(req) },
      "file.reserve",
      envelope,
      async (tx) => {
        const [file] = await tx
          .insert(workHubFilesTable)
          .values({
            ownerOrgType: envelope.owner.type,
            ownerOrgId: envelope.owner.id,
            channelId: payload.channelId,
            uploadedById: session.userId,
            storageKey: descriptor.objectPath,
            fileName: payload.fileName,
            contentType: payload.contentType,
            byteSize: payload.byteSize,
            checksumSha256: payload.checksumSha256.toLowerCase(),
            mediaMetadata,
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          })
          .returning();
        return {
          file,
          uploadURL: absoluteUploadUrl(req, descriptor.uploadURL),
        };
      },
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});
router.post("/work-hub/files/:id/finalize", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const payload = z.object({ objectURL: z.string().min(1) }).parse(req.body);
  const [file] = await db
    .select()
    .from(workHubFilesTable)
    .where(eq(workHubFilesTable.id, req.params.id));
  if (!file) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  if (!file.channelId)
    return sendApiError(
      res,
      409,
      "work_hub.invalid_operation",
      "File context missing",
    );
  await resolveChannelAccess(session, file.channelId, "channel.write");
  const objectPath = await storage.trySetObjectEntityAclPolicy(
    payload.objectURL,
    { owner: String(session.userId), visibility: "private" },
  );
  if (objectPath !== file.storageKey)
    return sendApiError(
      res,
      409,
      "work_hub.invalid_operation",
      "Upload reservation mismatch",
    );
  const [updated] = await db
    .update(workHubFilesTable)
    .set({ state: "finalized", finalizedAt: new Date(), expiresAt: null })
    .where(eq(workHubFilesTable.id, file.id))
    .returning();
  return res.json(updated);
});

router.get("/work-hub/search", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const q = z.string().trim().min(2).max(200).parse(req.query.q);
  const start = req.query.start ? new Date(String(req.query.start)) : null;
  const end = req.query.end ? new Date(String(req.query.end)) : null;
  const subjectType = req.query.type
    ? z.string().trim().max(80).parse(req.query.type)
    : null;
  if (
    (start && Number.isNaN(start.getTime())) ||
    (end && Number.isNaN(end.getTime())) ||
    (start && end && start > end)
  )
    return sendApiError(
      res,
      400,
      "work_hub.invalid_operation",
      "Invalid search date range",
    );
  const inRange = (value: Date | string | null | undefined) => {
    const time = value ? new Date(value).getTime() : 0;
    return (
      (!start || time >= start.getTime()) && (!end || time <= end.getTime())
    );
  };
  const matches = (...values: unknown[]) =>
    q.toLowerCase() === "all" ||
    values.some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(q.toLowerCase()),
    );
  const wants = (type: string) => !subjectType || subjectType === type;
  const [tasks, meetings, files, announcements, channels] = await Promise.all([
    db
      .select()
      .from(workHubTasksTable)
      .where(ownerFilter(session))
      .orderBy(desc(workHubTasksTable.updatedAt))
      .limit(200),
    db
      .select({
        occurrence: workHubMeetingOccurrencesTable,
        meeting: workHubMeetingsTable,
      })
      .from(workHubMeetingOccurrencesTable)
      .innerJoin(
        workHubMeetingsTable,
        eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
      )
      .orderBy(desc(workHubMeetingOccurrencesTable.startsAt))
      .limit(200),
    db
      .select()
      .from(workHubFilesTable)
      .where(eq(workHubFilesTable.state, "finalized"))
      .orderBy(desc(workHubFilesTable.finalizedAt))
      .limit(200),
    db
      .select()
      .from(workHubAnnouncementsTable)
      .where(ownerFilterFor(session, workHubAnnouncementsTable))
      .orderBy(desc(workHubAnnouncementsTable.publishedAt))
      .limit(200),
    db.select().from(workHubChannelsTable).limit(500),
  ]);
  const visibleChannels = new Set<string>();
  await Promise.all(
    channels.map(async (channel) => {
      try {
        await resolveChannelAccess(session, channel.id, "channel.read");
        visibleChannels.add(channel.id);
      } catch {
        /* hidden */
      }
    }),
  );
  const [messages, notes] = await Promise.all([
    visibleChannels.size
      ? db
          .select()
          .from(workHubMessagesTable)
          .where(inArray(workHubMessagesTable.channelId, [...visibleChannels]))
          .orderBy(desc(workHubMessagesTable.createdAt))
          .limit(300)
      : Promise.resolve([]),
    visibleChannels.size
      ? db
          .select()
          .from(workHubNotesTable)
          .where(inArray(workHubNotesTable.channelId, [...visibleChannels]))
          .orderBy(desc(workHubNotesTable.updatedAt))
          .limit(200)
      : Promise.resolve([]),
  ]);
  const visibleMessages = messages as Array<
    typeof workHubMessagesTable.$inferSelect
  >;
  const visibleNotes = notes as Array<typeof workHubNotesTable.$inferSelect>;
  const meetingParticipantIds = new Set(
    (
      await db
        .select({ occurrenceId: workHubMeetingParticipantsTable.occurrenceId })
        .from(workHubMeetingParticipantsTable)
        .where(eq(workHubMeetingParticipantsTable.userId, session.userId))
    ).map((row) => row.occurrenceId),
  );
  const [forms, transcripts] = await Promise.all([
    db
      .select({
        instance: workHubFormInstancesTable,
        template: workHubFormTemplatesTable,
      })
      .from(workHubFormInstancesTable)
      .innerJoin(
        workHubFormTemplatesTable,
        eq(workHubFormTemplatesTable.id, workHubFormInstancesTable.templateId),
      )
      .where(
        session.role === "admin"
          ? undefined
          : eq(workHubFormInstancesTable.assigneeUserId, session.userId),
      )
      .limit(200),
    db
      .select({
        segment: workHubTranscriptSegmentsTable,
        occurrenceId: workHubMeetingArtifactsTable.occurrenceId,
        startsAt: workHubMeetingOccurrencesTable.startsAt,
      })
      .from(workHubTranscriptSegmentsTable)
      .innerJoin(
        workHubMeetingArtifactsTable,
        eq(
          workHubMeetingArtifactsTable.id,
          workHubTranscriptSegmentsTable.artifactId,
        ),
      )
      .innerJoin(
        workHubMeetingOccurrencesTable,
        eq(
          workHubMeetingOccurrencesTable.id,
          workHubMeetingArtifactsTable.occurrenceId,
        ),
      )
      .limit(500),
  ]);
  const results = [
    ...tasks
      .filter(
        (row) =>
          wants("task") &&
          inRange(row.updatedAt) &&
          matches(row.title, row.description),
      )
      .map((row) => ({
        id: `task:${row.id}`,
        subjectType: "task",
        subjectId: row.id,
        title: row.title,
        contextKind: "organization",
        contextId: `${row.ownerOrgType}:${row.ownerOrgId}`,
        updatedAt: row.updatedAt,
      })),
    ...meetings
      .filter(
        ({ occurrence, meeting }) =>
          wants("meeting") &&
          (session.role === "admin" ||
            meetingParticipantIds.has(occurrence.id)) &&
          inRange(occurrence.startsAt) &&
          matches(meeting.title, meeting.agenda),
      )
      .map(({ occurrence, meeting }) => ({
        id: `meeting:${occurrence.id}`,
        subjectType: "meeting",
        subjectId: occurrence.id,
        title: meeting.title,
        contextKind: "meeting",
        contextId: occurrence.id,
        updatedAt: occurrence.startsAt,
      })),
    ...files
      .filter(
        (row) =>
          wants("file") &&
          row.channelId &&
          visibleChannels.has(row.channelId) &&
          inRange(row.finalizedAt) &&
          matches(row.fileName, row.mediaMetadata?.category),
      )
      .map((row) => ({
        id: `file:${row.id}`,
        subjectType: "file",
        subjectId: row.id,
        title: row.fileName,
        contextKind: "channel",
        contextId: row.channelId!,
        updatedAt: row.finalizedAt,
      })),
    ...announcements
      .filter(
        (row) =>
          wants("announcement") &&
          inRange(row.publishedAt) &&
          matches(row.title, row.body),
      )
      .map((row) => ({
        id: `announcement:${row.id}`,
        subjectType: "announcement",
        subjectId: row.id,
        title: row.title,
        contextKind: "organization",
        contextId: `${row.ownerOrgType}:${row.ownerOrgId}`,
        updatedAt: row.publishedAt,
      })),
    ...visibleMessages
      .filter(
        (row) =>
          wants("message") && inRange(row.createdAt) && matches(row.body),
      )
      .map((row) => ({
        id: `message:${row.id}`,
        subjectType: "message",
        subjectId: row.id,
        title: row.body.slice(0, 120),
        contextKind: "channel",
        contextId: row.channelId,
        updatedAt: row.createdAt,
      })),
    ...visibleNotes
      .filter(
        (row) =>
          wants("note") &&
          inRange(row.updatedAt) &&
          matches(row.title, row.body),
      )
      .map((row) => ({
        id: `note:${row.id}`,
        subjectType: "note",
        subjectId: row.id,
        title: row.title,
        contextKind: "channel",
        contextId: row.channelId,
        updatedAt: row.updatedAt,
      })),
    ...forms
      .filter(
        ({ instance, template }) =>
          wants("form") &&
          sessionCanSeeOwner(
            session,
            template.ownerOrgType,
            template.ownerOrgId,
          ) &&
          inRange(instance.createdAt) &&
          matches(template.name, instance.definitionSnapshot),
      )
      .map(({ instance, template }) => ({
        id: `form:${instance.id}`,
        subjectType: "form",
        subjectId: instance.id,
        title: template.name,
        contextKind: "organization",
        contextId: `${template.ownerOrgType}:${template.ownerOrgId}`,
        updatedAt: instance.createdAt,
      })),
    ...transcripts
      .filter(
        ({ occurrenceId, segment, startsAt }) =>
          (!subjectType ||
            subjectType === "transcript" ||
            subjectType === "meeting") &&
          (session.role === "admin" ||
            meetingParticipantIds.has(occurrenceId)) &&
          inRange(startsAt) &&
          matches(segment.text),
      )
      .map(({ occurrenceId, segment, startsAt }) => ({
        id: `transcript:${segment.id}`,
        subjectType: "meeting",
        subjectId: occurrenceId,
        title: segment.text.slice(0, 120),
        contextKind: "meeting",
        contextId: occurrenceId,
        updatedAt: startsAt,
      })),
  ]
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? 0).getTime() -
        new Date(a.updatedAt ?? 0).getTime(),
    )
    .slice(0, 100);
  return res.json(results);
});
router.get("/work-hub/connectors/microsoft-365", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const configured = Boolean(
    process.env.MICROSOFT_365_CLIENT_ID &&
    process.env.MICROSOFT_365_CLIENT_SECRET,
  );
  return res.json(microsoftImportStatus(configured));
});
router.get("/work-hub/connectors/microsoft-365/imports", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const batches = await db
    .select()
    .from(workHubImportBatchesTable)
    .where(ownerFilterFor(session, workHubImportBatchesTable))
    .orderBy(desc(workHubImportBatchesTable.createdAt))
    .limit(50);
  const items = batches.length
    ? await db
        .select()
        .from(workHubImportItemsTable)
        .where(
          inArray(
            workHubImportItemsTable.batchId,
            batches.map((batch) => batch.id),
          ),
        )
        .orderBy(desc(workHubImportItemsTable.importedAt))
    : [];
  return res.json({ batches, items });
});
router.post("/work-hub/connectors/microsoft-365/connect", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const owner = z
    .object({
      type: z.enum(["vendor", "partner"]),
      id: z.number().int().positive(),
    })
    .parse(req.body?.owner);
  await ownAccess(session, owner, "connector.manage");
  return sendApiError(
    res,
    503,
    "work_hub.provider_unavailable",
    "Microsoft 365 registration is required before connection",
    {
      capability: "staged_import",
      direction: "microsoft_to_vndrly",
      writeBack: false,
      safeDisabled: true,
    },
  );
});

export default router;
