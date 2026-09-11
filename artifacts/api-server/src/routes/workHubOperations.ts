import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID, createHash } from "node:crypto";
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
  userOrgMembershipsTable,
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
import {
  audioIceServers,
  captureAllowed,
  SignalMailbox,
} from "../work-hub/internal-audio";
import { getObjectStore } from "../lib/objectStore";
import workHubMeetingsRouter from "./workHubMeetings";
import workHubMeetingReplayRouter from "./workHubMeetingReplay";
import { assertOwnerMatchesChannel, assertOwnerUsers } from "../work-hub/owner-users";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const meetingSignals = new SignalMailbox();
function announcementMembership(userId: number, adminOnly = false) {
  return sql`exists (select 1 from ${userOrgMembershipsTable} membership
    where membership.user_id = ${userId}
    and membership.org_type = ${workHubAnnouncementsTable.ownerOrgType}
    and case when membership.org_type = 'vendor' then membership.vendor_id else membership.partner_id end = ${workHubAnnouncementsTable.ownerOrgId}
    ${adminOnly ? sql`and membership.role = 'admin'` : sql``})`;
}
function announcementReadable(userId: number) {
  return and(announcementMembership(userId), isNull(workHubAnnouncementsTable.withdrawnAt),
    or(announcementMembership(userId, true), sql`exists (select 1 from ${workHubAnnouncementRecipientsTable} recipient
      where recipient.announcement_id = ${workHubAnnouncementsTable.id} and recipient.user_id = ${userId})`));
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

router.use("/work-hub/meetings", workHubMeetingReplayRouter);
router.use("/work-hub/meetings", workHubMeetingsRouter);

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
          announcementMembership(session.userId),
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
      .where(and(ownerFilterFor(session, workHubAnnouncementsTable), announcementMembership(session.userId, true)))
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
      async (tx) => {
        const members = await tx.select().from(userOrgMembershipsTable).where(and(
          eq(userOrgMembershipsTable.orgType, envelope.owner.type),
          envelope.owner.type === "vendor" ? eq(userOrgMembershipsTable.vendorId, envelope.owner.id) : eq(userOrgMembershipsTable.partnerId, envelope.owner.id),
          inArray(userOrgMembershipsTable.userId, [...new Set([session.userId, ...recipients])]),
        )).for("share");
        if (!members.some(member => member.userId === session.userId && member.role === "admin") ||
          recipients.some(userId => !members.some(member => member.userId === userId))) throw new WorkHubAccessError("forbidden");
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
        link: `/work-hub?announcement=${result.resource.id}`,
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
  try {
    const recipient = await db.transaction(async (tx) => {
      const [announcement] = await tx.select().from(workHubAnnouncementsTable).where(and(
        eq(workHubAnnouncementsTable.id, req.params.id), announcementReadable(session.userId),
      )).limit(1);
      if (!announcement) throw new WorkHubAccessError("not_found");
      const [membership] = await tx.select().from(userOrgMembershipsTable).where(and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, announcement.ownerOrgType),
        announcement.ownerOrgType === "vendor" ? eq(userOrgMembershipsTable.vendorId, announcement.ownerOrgId) : eq(userOrgMembershipsTable.partnerId, announcement.ownerOrgId),
      )).for("share");
      if (!membership) throw new WorkHubAccessError("not_found");
      const [row] = await tx.update(workHubAnnouncementRecipientsTable).set({
        acknowledgedAt: sql`coalesce(${workHubAnnouncementRecipientsTable.acknowledgedAt}, now())`,
        viewedAt: sql`coalesce(${workHubAnnouncementRecipientsTable.viewedAt}, now())`,
      }).where(and(eq(workHubAnnouncementRecipientsTable.announcementId, announcement.id),
        eq(workHubAnnouncementRecipientsTable.userId, session.userId))).returning();
      if (!row) throw new WorkHubAccessError("not_found");
      await tx.insert(workHubAcknowledgementsTable).values({
        ownerOrgType: announcement.ownerOrgType, ownerOrgId: announcement.ownerOrgId,
        subjectType: "announcement", subjectId: announcement.id, subjectVersion: announcement.version, userId: session.userId,
      }).onConflictDoNothing();
      return row;
    });
    return res.json(recipient);
  } catch (error) {
    return failure(res, error);
  }
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
          sql`exists (select 1 from ${workHubMeetingParticipantsTable} mp where mp.occurrence_id = ${workHubMeetingOccurrencesTable.id} and mp.user_id = ${session.userId})`,
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
        for (const userId of [...participants].sort((a, b) => a - b)) {
          await tx.execute(sql`select pg_advisory_xact_lock(73009, ${userId})`);
        }
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
type MeetingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class MeetingMutationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function meetingMutation(
  req: Request,
  res: Response,
  apply: (tx: MeetingTx, session: Actor, id: string) => Promise<unknown>,
) {
  const session = actor(req);
  if (!session)
    return res.status(401).json({ message: "Authentication required" });
  try {
    const id = z.string().uuid().parse(req.params.occurrenceId);
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"meeting-capture:" + id}))`,
      );
      // The new meeting router uses this same row lock for consent and presence.
      // Keep legacy capture uploads/start serialized with withdrawal and leave.
      await tx.execute(sql`select ${workHubMeetingOccurrencesTable.id} from ${workHubMeetingOccurrencesTable} where ${workHubMeetingOccurrencesTable.id} = ${id} for update`);
      return apply(tx, session, id);
    });
    return res.json(result);
  } catch (error) {
    return res
      .status(error instanceof MeetingMutationError ? error.status : 400)
      .json({
        message:
          error instanceof Error ? error.message : "Meeting operation failed",
      });
  }
}
async function requireMeetingMember(
  tx: MeetingTx,
  id: string,
  userId: number,
  hostOnly = false,
) {
  const [member] = await tx
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(workHubMeetingParticipantsTable.occurrenceId, id),
        eq(workHubMeetingParticipantsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member || member.removedAt) throw new MeetingMutationError(404, "Meeting not found");
  if (hostOnly && member.role !== "host")
    throw new MeetingMutationError(
      403,
      "Only the meeting host can record or transcribe",
    );
  return member;
}
async function meetingEntry(tx: MeetingTx, id: string) {
  const [entry] = await tx
    .select({
      occurrence: workHubMeetingOccurrencesTable,
      meeting: workHubMeetingsTable,
    })
    .from(workHubMeetingOccurrencesTable)
    .innerJoin(
      workHubMeetingsTable,
      eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
    )
    .where(eq(workHubMeetingOccurrencesTable.id, id));
  if (!entry) throw new MeetingMutationError(404, "Meeting not found");
  return entry;
}
async function requireCaptureConsent(
  tx: MeetingTx,
  id: string,
  userId: number,
) {
  const member = await requireMeetingMember(tx, id, userId, true);
  const entry = await meetingEntry(tx, id);
  if (["ended", "cancelled"].includes(entry.occurrence.status))
    throw new MeetingMutationError(409, "Meeting has ended");
  const present = await tx
    .select()
    .from(workHubMeetingAttendanceTable)
    .where(
      and(
        eq(workHubMeetingAttendanceTable.occurrenceId, id),
        isNull(workHubMeetingAttendanceTable.leftAt),
      ),
    );
  const consents = await tx
    .select()
    .from(workHubMeetingConsentsTable)
    .where(eq(workHubMeetingConsentsTable.occurrenceId, id));
  if (
    !present.some((p) => p.userId === userId) ||
    !captureAllowed({
      role: member.role,
      recordingAllowed: entry.meeting.recordingAllowed,
      policyVersion: entry.meeting.policyVersion,
      consents,
      present: present.map((p) => p.userId),
    })
  )
    throw new MeetingMutationError(
      409,
      "Every present participant must consent before capture",
    );
  return entry;
}
router.post("/work-hub/meetings/:occurrenceId/consent", (req, res) =>
  meetingMutation(req, res, async (tx, session, id) => {
    await requireMeetingMember(tx, id, session.userId);
    const entry = await meetingEntry(tx, id);
    const p = z
      .object({
        policyVersion: z.number().int().positive(),
        response: z.enum(["accepted", "declined"]),
      })
      .parse(req.body);
    if (p.policyVersion !== entry.meeting.policyVersion)
      throw new MeetingMutationError(
        409,
        "Consent policy changed; refresh the meeting",
      );
    const [consent] = await tx
      .insert(workHubMeetingConsentsTable)
      .values({ occurrenceId: id, userId: session.userId, ...p })
      .onConflictDoUpdate({
        target: [
          workHubMeetingConsentsTable.occurrenceId,
          workHubMeetingConsentsTable.userId,
          workHubMeetingConsentsTable.policyVersion,
        ],
        set: { response: p.response, respondedAt: new Date() },
      })
      .returning();
    if (p.response === "declined")
      await tx
        .update(workHubMeetingOccurrencesTable)
        .set({ recordingState: "off", transcriptState: "off" })
        .where(eq(workHubMeetingOccurrencesTable.id, id));
    return consent;
  }),
);

router.post("/work-hub/meetings/:occurrenceId/join", (req, res) =>
  meetingMutation(req, res, async (tx, session, id) => {
    await requireMeetingMember(tx, id, session.userId);
    const { occurrence, meeting } = await meetingEntry(tx, id);
    if (["ended", "cancelled"].includes(occurrence.status))
      throw new MeetingMutationError(409, "Meeting has ended");
    const roomId = occurrence.providerRoomId ?? "vndrly-" + randomUUID();
    const [attending] = await tx
      .select()
      .from(workHubMeetingAttendanceTable)
      .where(
        and(
          eq(workHubMeetingAttendanceTable.occurrenceId, id),
          eq(workHubMeetingAttendanceTable.userId, session.userId),
          isNull(workHubMeetingAttendanceTable.leftAt),
        ),
      );
    if (!attending) {
      await tx
        .update(workHubMeetingOccurrencesTable)
        .set({
          providerRoomId: roomId,
          status: "live",
          recordingState: "off",
          transcriptState: "off",
        })
        .where(eq(workHubMeetingOccurrencesTable.id, id));
      await tx
        .insert(workHubMeetingAttendanceTable)
        .values({ occurrenceId: id, userId: session.userId });
      await tx
        .insert(workHubMeetingConsentsTable)
        .values({
          occurrenceId: id,
          userId: session.userId,
          policyVersion: meeting.policyVersion,
          response: "declined",
        })
        .onConflictDoUpdate({
          target: [
            workHubMeetingConsentsTable.occurrenceId,
            workHubMeetingConsentsTable.userId,
            workHubMeetingConsentsTable.policyVersion,
          ],
          set: { response: "declined", respondedAt: new Date() },
        });
    }
    const [currentConsent] = await tx
      .select()
      .from(workHubMeetingConsentsTable)
      .where(
        and(
          eq(workHubMeetingConsentsTable.occurrenceId, id),
          eq(workHubMeetingConsentsTable.userId, session.userId),
          eq(workHubMeetingConsentsTable.policyVersion, meeting.policyVersion),
        ),
      )
      .limit(1);
    const participants = await tx
      .select()
      .from(workHubMeetingParticipantsTable)
      .where(eq(workHubMeetingParticipantsTable.occurrenceId, id));
    return {
      roomId,
      consentAccepted: currentConsent?.response === "accepted",
      userId: session.userId,
      participants: participants.map(
        ({ userId, role, muted, handRaisedAt }) => ({
          userId,
          role,
          muted,
          handRaisedAt,
        }),
      ),
      transcription: false,
      recordingAllowed: meeting.recordingAllowed,
      policyVersion: meeting.policyVersion,
      iceServers: audioIceServers(process.env, session.userId),
    };
  }),
);

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
      toUserId: z.number().int().positive(),
      kind: z.enum(["offer", "answer", "ice"]),
      payload: z.unknown(),
    })
    .parse(req.body);
  if ((JSON.stringify(payload.payload) ?? "").length > 65536)
    return sendApiError(
      res,
      413,
      "work_hub.signal_too_large",
      "Audio signal too large",
    );
  const [target] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(
          workHubMeetingParticipantsTable.occurrenceId,
          req.params.occurrenceId,
        ),
        eq(workHubMeetingParticipantsTable.userId, payload.toUserId),
      ),
    );
  if (!target)
    return sendApiError(
      res,
      404,
      "work_hub.not_found",
      "Participant not found",
    );
  const signal = meetingSignals.append(
    req.params.occurrenceId,
    session.userId,
    payload.toUserId,
    payload.kind,
    payload.payload,
  );
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
  if (!Number.isFinite(since) || since < 0)
    return sendApiError(
      res,
      400,
      "work_hub.invalid_cursor",
      "Invalid audio cursor",
    );
  return res.json(
    meetingSignals.read(req.params.occurrenceId, session.userId, since),
  );
});

router.get("/work-hub/meetings/:occurrenceId/audio-state", async (req, res) => {
  const session = actor(req);
  if (!session)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const [member] = await db
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
  if (!member) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const [occurrence] = await db
    .select()
    .from(workHubMeetingOccurrencesTable)
    .where(eq(workHubMeetingOccurrencesTable.id, req.params.occurrenceId));
  const present = await db
    .select({ userId: workHubMeetingAttendanceTable.userId })
    .from(workHubMeetingAttendanceTable)
    .where(
      and(
        eq(workHubMeetingAttendanceTable.occurrenceId, req.params.occurrenceId),
        isNull(workHubMeetingAttendanceTable.leftAt),
      ),
    );
  return res.json({
    recordingState: occurrence?.recordingState ?? "off",
    presentUserIds: [...new Set(present.map((x) => x.userId))],
  });
});

router.post("/work-hub/meetings/:occurrenceId/leave", (req, res) =>
  meetingMutation(req, res, async (tx, session, id) => {
    await requireMeetingMember(tx, id, session.userId);
    await tx
      .update(workHubMeetingAttendanceTable)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(workHubMeetingAttendanceTable.occurrenceId, id),
          eq(workHubMeetingAttendanceTable.userId, session.userId),
          isNull(workHubMeetingAttendanceTable.leftAt),
        ),
      );
    await tx
      .update(workHubMeetingOccurrencesTable)
      .set({ recordingState: "off", transcriptState: "off" })
      .where(eq(workHubMeetingOccurrencesTable.id, id));
    return { left: true };
  }),
);

router.post("/work-hub/meetings/:occurrenceId/recording", (req, res) =>
  meetingMutation(req, res, async (tx, session, id) => {
    await requireMeetingMember(tx, id, session.userId, true);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const entry = enabled
      ? await requireCaptureConsent(tx, id, session.userId)
      : await meetingEntry(tx, id);
    await tx
      .update(workHubMeetingOccurrencesTable)
      .set({
        recordingState: enabled ? "active" : "off",
        transcriptState: enabled ? "active" : "off",
      })
      .where(eq(workHubMeetingOccurrencesTable.id, id));
    await appendWorkHubAudit(
      {
        actorUserId: session.userId,
        owner: {
          type: entry.meeting.ownerOrgType as "vendor" | "partner",
          id: entry.meeting.ownerOrgId,
        },
        action: enabled
          ? "meeting.recording_started"
          : "meeting.recording_stopped",
        subjectType: "meeting_occurrence",
        subjectId: id,
        source: clientSource(req),
      },
      tx,
    );
    return { recordingState: enabled ? "active" : "off" };
  }),
);

router.post("/work-hub/meetings/:occurrenceId/audio-chunks", (req, res) =>
  meetingMutation(req, res, async (tx, session, id) => {
    await requireMeetingMember(tx, id, session.userId, true);
    const p = z
      .object({
        id: z.uuid(),
        audioBase64: z
          .string()
          .min(1)
          .max(2_000_000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        contentType: z.enum([
          "audio/webm",
          "audio/webm;codecs=opus",
          "audio/ogg",
          "audio/ogg;codecs=opus",
          "audio/mp4",
        ]),
        startsAtMs: z.number().int().min(0).max(2147483647),
        endsAtMs: z.number().int().min(0).max(2147483647),
      })
      .refine(
        (x) =>
          x.endsAtMs >= x.startsAtMs && x.endsAtMs - x.startsAtMs <= 120000,
      )
      .parse(req.body);
    const storageKey =
      "/objects/work-hub-recordings/" + id + "/" + session.userId + "/" + p.id;
    const bytes = Buffer.from(p.audioBase64, "base64");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const [prior] = await tx
      .select()
      .from(workHubMeetingArtifactsTable)
      .where(eq(workHubMeetingArtifactsTable.id, p.id));
    if (prior) {
      if (
        prior.storageKey !== storageKey ||
        prior.metadata?.checksum !== checksum ||
        prior.metadata?.startsAtMs !== p.startsAtMs ||
        prior.metadata?.endsAtMs !== p.endsAtMs
      )
        throw new MeetingMutationError(
          409,
          "Recording identifier already used for different audio",
        );
      return { id: prior.id, replayed: true };
    }
    const entry = await requireCaptureConsent(tx, id, session.userId);
    if (entry.occurrence.recordingState !== "active")
      throw new MeetingMutationError(409, "Capture is inactive");
    await getObjectStore().putObject(storageKey, p.contentType, bytes, {
      owner: "workhub-recording:" + id,
      visibility: "private",
    });
    await tx.insert(workHubMeetingArtifactsTable).values({
      id: p.id,
      occurrenceId: id,
      artifactType: "audio",
      storageKey,
      state: "ready",
      metadata: {
        uploadedBy: session.userId,
        mixedAudio: true,
        checksum,
        startsAtMs: p.startsAtMs,
        endsAtMs: p.endsAtMs,
      },
    });
    return { id: p.id };
  }),
);

router.get(
  "/work-hub/meetings/:occurrenceId/audio-chunks/:artifactId",
  async (req, res) => {
    const session = actor(req);
    if (!session)
      return sendApiError(
        res,
        401,
        "auth.unauthenticated",
        "Authentication required",
      );
    const [member] = await db
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
    if (!member || member.removedAt)
      return sendApiError(res, 404, "work_hub.not_found", "Not found");
    const [artifact] = await db
      .select()
      .from(workHubMeetingArtifactsTable)
      .where(
        and(
          eq(
            workHubMeetingArtifactsTable.occurrenceId,
            req.params.occurrenceId,
          ),
          eq(workHubMeetingArtifactsTable.id, req.params.artifactId),
          eq(workHubMeetingArtifactsTable.artifactType, "audio"),
        ),
      );
    if (!artifact?.storageKey)
      return sendApiError(res, 404, "work_hub.not_found", "Not found");
    const object = await storage.getStoredObject(artifact.storageKey);
    res.setHeader("Cache-Control", "private, no-store");
    return res.type(object.contentType).send(object.body);
  },
);

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

router.post("/work-hub/meetings/:occurrenceId/transcript", (req, res) =>
  meetingMutation(req, res, async (tx, session, id) => {
    await requireMeetingMember(tx, id, session.userId, true);
    const p = z
      .object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(20000),
        startsAtMs: z.number().int().min(0).max(2147483647),
        endsAtMs: z.number().int().min(0).max(2147483647),
      })
      .refine((x) => x.endsAtMs >= x.startsAtMs)
      .parse(req.body);
    const [audio] = await tx
      .select()
      .from(workHubMeetingArtifactsTable)
      .where(
        and(
          eq(workHubMeetingArtifactsTable.id, p.id),
          eq(workHubMeetingArtifactsTable.occurrenceId, id),
          eq(workHubMeetingArtifactsTable.artifactType, "audio"),
          eq(workHubMeetingArtifactsTable.state, "ready"),
        ),
      );
    if (
      !audio ||
      audio.metadata?.startsAtMs !== p.startsAtMs ||
      audio.metadata?.endsAtMs !== p.endsAtMs
    )
      throw new MeetingMutationError(
        409,
        "Transcript requires its previously authorized audio chunk",
      );
    const [prior] = await tx
      .select()
      .from(workHubTranscriptSegmentsTable)
      .where(eq(workHubTranscriptSegmentsTable.id, p.id));
    if (prior) {
      if (prior.text !== p.text)
        throw new MeetingMutationError(
          409,
          "Transcript identifier already used",
        );
      return prior;
    }
    let [artifact] = await tx
      .select()
      .from(workHubMeetingArtifactsTable)
      .where(
        and(
          eq(workHubMeetingArtifactsTable.occurrenceId, id),
          eq(workHubMeetingArtifactsTable.artifactType, "transcript"),
        ),
      );
    if (!artifact)
      [artifact] = await tx
        .insert(workHubMeetingArtifactsTable)
        .values({
          occurrenceId: id,
          artifactType: "transcript",
          state: "active",
          metadata: { consentNotice: true, mixedAudio: true },
        })
        .returning();
    const [segment] = await tx
      .insert(workHubTranscriptSegmentsTable)
      .values({
        id: p.id,
        artifactId: artifact.id,
        speakerUserId: null,
        text: p.text,
        startsAtMs: p.startsAtMs,
        endsAtMs: p.endsAtMs,
      })
      .returning();
    return segment;
  }),
);

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
  if (!participant)
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
      .where(and(ownerFilterFor(session, workHubAnnouncementsTable), announcementReadable(session.userId)))
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
          meetingParticipantIds.has(occurrence.id) &&
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
          meetingParticipantIds.has(occurrenceId) &&
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
