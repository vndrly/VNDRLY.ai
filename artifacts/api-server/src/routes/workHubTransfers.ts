import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  userOrgMembershipsTable,
  workHubImportBatchesTable as batches,
  workHubImportItemsTable as items,
  workHubChannelsTable as channels,
  workHubChannelMembersTable as members,
  workHubNotesTable as notes,
  workHubTasksTable as tasks,
  workHubTaskEventsTable as events,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { WorkHubAccessError } from "../work-hub/context-access";
import { resolveChannelAccess } from "../work-hub/queries";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  transferRowSchema,
  transferSourceKey,
} from "../work-hub/transfer-policy";
const router: IRouter = Router();
async function admin(req: Parameters<typeof getSessionFromRequest>[0]) {
  const session = getSessionFromRequest(req);
  if (!session?.userId)
    throw Object.assign(new Error("Sign in to manage imports"), {
      status: 401,
    });
  if (!(await isWorkHubEnabled())) throw new WorkHubAccessError("not_found");
  const type = session.vendorId ? ("vendor" as const) : ("partner" as const),
    id = session.vendorId ?? session.partnerId;
  if (!id) throw new WorkHubAccessError("forbidden");
  const [membership] = await db
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
  if (membership?.role !== "admin") throw new WorkHubAccessError("forbidden");
  return {
    session: {
      ...session,
      userId: session.userId,
      membershipRole: membership.role,
    },
    owner: { type, id },
  };
}
const scope = (a: Awaited<ReturnType<typeof admin>>) =>
  and(
    eq(batches.ownerOrgType, a.owner.type),
    eq(batches.ownerOrgId, a.owner.id),
    eq(batches.provider, "csv"),
  );
async function targetChannel(
  a: Awaited<ReturnType<typeof admin>>,
  channelId: string | null,
) {
  if (!channelId) throw new WorkHubAccessError("forbidden");
  const { channel } = await resolveChannelAccess(
    a.session,
    channelId,
    "channel.write",
  );
  if (
    channel.ownerOrgType !== a.owner.type ||
    channel.ownerOrgId !== a.owner.id
  )
    throw new WorkHubAccessError("forbidden");
}
const envelope = (
  a: Awaited<ReturnType<typeof admin>>,
  operationId: string,
  payload: unknown,
) => ({
  operationId,
  owner: a.owner,
  context: { kind: "organization" as const, id: a.owner.id },
  payloadVersion: 1 as const,
  expectedVersion: null,
  payload,
});
router.get("/work-hub/transfers", async (req, res) => {
  const a = await admin(req);
  const records = await db
    .select()
    .from(batches)
    .where(scope(a))
    .orderBy(desc(batches.createdAt))
    .limit(50);
  const rows = records.length
    ? await db
        .select()
        .from(items)
        .where(
          inArray(
            items.batchId,
            records.map((b) => b.id),
          ),
        )
    : [];
  return res.json({ batches: records, items: rows });
});
router.post("/work-hub/transfers/preview", async (req, res) => {
  const a = await admin(req);
  const p = z
    .object({
      operationId: z.string().uuid(),
      source: z.string().trim().min(1).max(120),
      category: z.enum(["channels", "tasks", "notes"]),
      channelId: z.string().uuid().nullable().optional(),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
    })
    .parse(req.body);
  if (p.category === "notes") await targetChannel(a, p.channelId ?? null);
  const result = await executeWorkHubCommand(
    { userId: a.session.userId, source: "web" },
    "transfer.preview",
    envelope(a, p.operationId, p),
    async (tx) => {
      const [batch] = await tx
        .insert(batches)
        .values({
          ownerOrgType: a.owner.type,
          ownerOrgId: a.owner.id,
          provider: "csv",
          direction: "csv_to_vndrly",
          categories: [p.category],
          requestedById: a.session.userId,
          errorSummary: { source: p.source, channelId: p.channelId ?? null },
        })
        .returning();
      const seen = new Set<string>();
      const normalized = [];
      for (const [index, raw] of p.rows.entries()) {
        const parsed = transferRowSchema.safeParse(raw);
        const value = parsed.success
          ? parsed.data
          : {
              externalId: String(raw.externalId ?? "").slice(0, 200),
              title: String(raw.title ?? "").slice(0, 180),
              body: "",
              dueAt: null,
            };
        const sourceKey = transferSourceKey(
          a.owner.type,
          a.owner.id,
          p.source,
          p.category,
          value.externalId || `invalid:${index}`,
        );
        let error = parsed.success
          ? null
          : "External ID and title are required; use only supported columns and ISO dates.";
        if (!error && p.category === "channels" && value.title.length > 120)
          error = "Channel names cannot exceed 120 characters.";
        if (!error && seen.has(sourceKey))
          error = "Duplicate external ID within this file.";
        seen.add(sourceKey);
        const [prior] = await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.category, p.category),
              eq(items.externalId, sourceKey),
              isNotNull(items.activatedSubjectId),
            ),
          )
          .limit(1);
        normalized.push({
          batchId: batch!.id,
          category: p.category,
          externalId: sourceKey,
          externalVersion: `${batch!.id}:${index}`,
          status: error ? "error" : prior ? "duplicate" : "staged",
          payload: { ...value, rowNumber: index + 2 },
          permissionMapping: {
            channelId: p.channelId ?? null,
            visibility: p.category === "channels" ? "organization" : null,
          },
          error: error ? { message: error } : null,
        });
      }
      const staged = await tx.insert(items).values(normalized).returning();
      await appendWorkHubAudit(
        {
          actorUserId: a.session.userId,
          owner: a.owner,
          action: "transfer.previewed",
          subjectType: "import_batch",
          subjectId: batch!.id,
          source: "web",
          operationId: p.operationId,
        },
        tx,
      );
      return { batch, items: staged };
    },
  );
  return res.status(result.replayed ? 200 : 201).json(result.resource);
});
router.post("/work-hub/transfers/:id/apply", async (req, res) => {
  const a = await admin(req);
  const p = z
    .object({ operationId: z.string().uuid(), confirm: z.literal(true) })
    .parse(req.body);
  const id = z.string().uuid().parse(req.params.id);
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, id), scope(a)))
    .limit(1);
  if (!batch) throw new WorkHubAccessError("not_found");
  const channelId =
    typeof batch.errorSummary?.channelId === "string"
      ? batch.errorSummary.channelId
      : null;
  if (batch.categories.includes("notes")) await targetChannel(a, channelId);
  const result = await executeWorkHubCommand(
    { userId: a.session.userId, source: "web" },
    "transfer.apply",
    envelope(a, p.operationId, { batchId: id }),
    async (tx) => {
      // Serialize import activation within a company, including separate batches sharing external IDs.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`work-hub-transfer:${a.owner.type}:${a.owner.id}`}))`,
      );
      const rows = await tx.select().from(items).where(eq(items.batchId, id));
      let imported = 0,
        duplicates = 0,
        errors = 0;
      for (const row of rows) {
        if (row.status === "error") {
          errors++;
          continue;
        }
        if (row.activatedSubjectId) {
          imported++;
          continue;
        }
        const [prior] = await tx
          .select()
          .from(items)
          .where(
            and(
              eq(items.category, row.category),
              eq(items.externalId, row.externalId),
              isNotNull(items.activatedSubjectId),
            ),
          )
          .limit(1);
        if (prior) {
          duplicates++;
          await tx
            .update(items)
            .set({
              status: "duplicate",
              conflict: {
                existingSubjectType: prior.activatedSubjectType,
                existingSubjectId: prior.activatedSubjectId,
              },
            })
            .where(eq(items.id, row.id));
          continue;
        }
        const value = transferRowSchema.parse({
          externalId: row.payload.externalId,
          title: row.payload.title,
          body: row.payload.body,
          dueAt: row.payload.dueAt,
        });
        let subjectId: string, subjectType: string;
        if (row.category === "channels") {
          const [channel] = await tx
            .insert(channels)
            .values({
              ownerOrgType: a.owner.type,
              ownerOrgId: a.owner.id,
              contextKind: "organization",
              contextId: `csv:${row.externalId}`,
              name: value.title,
              visibility: "organization",
              createdById: a.session.userId,
            })
            .returning();
          await tx
            .insert(members)
            .values({
              channelId: channel!.id,
              userId: a.session.userId,
              mode: "owner",
            });
          subjectId = channel!.id;
          subjectType = "channel";
        } else if (row.category === "tasks") {
          const [task] = await tx
            .insert(tasks)
            .values({
              ownerOrgType: a.owner.type,
              ownerOrgId: a.owner.id,
              title: value.title,
              description: value.body,
              dueAt: value.dueAt ? new Date(value.dueAt) : null,
              createdById: a.session.userId,
              assigneeUserId: null,
            })
            .returning();
          await tx
            .insert(events)
            .values({
              taskId: task!.id,
              actorUserId: a.session.userId,
              eventType: "imported",
              detail: { batchId: id },
            });
          subjectId = task!.id;
          subjectType = "task";
        } else {
          const [note] = await tx
            .insert(notes)
            .values({
              channelId: channelId!,
              title: value.title,
              body: value.body,
              createdById: a.session.userId,
              updatedById: a.session.userId,
            })
            .returning();
          subjectId = note!.id;
          subjectType = "note";
        }
        await tx
          .update(items)
          .set({
            status: "imported",
            importedAt: new Date(),
            activatedSubjectType: subjectType,
            activatedSubjectId: subjectId,
          })
          .where(eq(items.id, row.id));
        imported++;
      }
      const [updated] = await tx
        .update(batches)
        .set({
          status: errors ? "completed_with_errors" : "completed",
          reviewedById: a.session.userId,
          reviewedAt: new Date(),
          activatedAt: new Date(),
          completedAt: new Date(),
          errorSummary: { ...batch.errorSummary, imported, duplicates, errors },
        })
        .where(eq(batches.id, id))
        .returning();
      await appendWorkHubAudit(
        {
          actorUserId: a.session.userId,
          owner: a.owner,
          action: "transfer.applied",
          subjectType: "import_batch",
          subjectId: id,
          source: "web",
          operationId: p.operationId,
          metadata: { imported, duplicates, errors },
        },
        tx,
      );
      return { batch: updated, imported, duplicates, errors };
    },
  );
  return res.json(result.resource);
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
        "work_hub.invalid_transfer",
        "Check import columns, dates and row limits",
        { issues: error.issues },
      );
    if (error instanceof Error && "status" in error)
      return sendApiError(
        res,
        Number(error.status),
        "work_hub.transfer_failed",
        error.message,
      );
    return next(error);
  },
);
export default router;
