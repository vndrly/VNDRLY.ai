import { meetingRepositoryAccess } from "../work-hub/repository-meeting-files";
import { Router } from "express";
import { createHash } from "node:crypto";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  workHubFileLibraryTable as records,
  workHubFormTemplatesTable as courses,
  usersTable as users,
  workHubFilesTable as files,
  partnerVendorRelationshipsTable as relationships,
} from "@workspace/db";
import {
  workHubCommandEnvelopeSchema,
  RepositoryFolderSchema,
  RepositoryAudienceSchema,
  TravelAuthorizationSchema,
  TravelExpenseSchema,
  TRAVEL_TEMPLATES,
  RENEWAL_SOURCES,
  expenseAmount,
  travelTransition,
  folderPermission,
  FolderGrantSchema,
  BundleDefinitionSchema,
  LibraryMetadataSchema,
} from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import { resolveChannelAccess } from "../work-hub/queries";
import {
  repositoryContext,
  repositoryRecipientCanRead,
  repositoryScope,
  repositoryOptions,
  repositoryAudience,
  repositoryFolder,
  repositoryRecord,
  updateRepositoryRecord,
  requireRepositoryDocumentAccess,
} from "../work-hub/vendor-repository";
import { LibraryError, type LibraryActor } from "../work-hub/library-core";
import {
  assignRepositoryCourses,
  repositoryCertificationProgress,
} from "../work-hub/repository-certifications";
import { ObjectStorageService } from "../lib/objectStorage";
import { readReceipt } from "../work-hub/receipts";
const ocrBudget = new Map<number, { count: number; until: number }>();
const router = Router();
const uuid = z.uuid();
router.use("/work-hub/repository", async (req, res, next) => {
  try {
    if (!(await isWorkHubEnabled())) return res.sendStatus(404);
    const actor = getSessionFromRequest(req);
    if (!actor?.userId) return res.sendStatus(401);
    res.locals.actor = {
      ...actor,
      userId: actor.userId,
      source: req.header("x-vndrly-client") === "ios" ? "ios" : "web",
    };
    res.setHeader("Cache-Control", "private, no-store");
    return next();
  } catch {
    return res.sendStatus(503);
  }
});
function fail(res: any, error: unknown) {
  const e = error as Error & { status?: number };
  return res
    .status(error instanceof z.ZodError ? 400 : (e.status ?? 500))
    .json({
      message:
        error instanceof z.ZodError
          ? "Check the required fields."
          : e.status
            ? e.message
            : "Repository operation could not be completed.",
    });
}
router.get("/work-hub/repository/progress", async (_req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor;
    const ctx = await repositoryContext(db, actor);
    return res.json(await repositoryCertificationProgress(db, ctx.owner, actor.userId));
  } catch (error) { return fail(res, error); }
});
router.get("/work-hub/repository", async (req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor,
      ctx = await repositoryContext(db, actor);
    const rows = await db
      .select()
      .from(records)
      .where(repositoryScope(ctx.owner))
      .orderBy(desc(records.updatedAt));
    const folders = rows.filter(
      (r) =>
        r.kind === "repository_folder" &&
        (ctx.admin ||
          (r.recordKey === "travel" && ctx.canAssignTravel) ||
          folderPermission(
            FolderGrantSchema.array().parse(r.data.grants ?? []),
            ctx.identity,
            "read",
          ) ||
          folderPermission(
            FolderGrantSchema.array().parse(r.data.grants ?? []),
            ctx.identity,
            "write",
          ) ||
          folderPermission(
            FolderGrantSchema.array().parse(r.data.grants ?? []),
            ctx.identity,
            "edit",
          )),
    );
    const trips = rows.filter(
      (r) =>
        r.kind === "travel_trip" &&
        (ctx.canAssignTravel || r.data.travelerId === actor.userId),
    );
    const tripIds = new Set(trips.map((r) => r.id));
    const expenses = rows.filter(
      (r) => r.kind === "travel_expense" && tripIds.has(String(r.data.tripId)),
    );
    const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
    const names = creatorIds.length
      ? await db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .where(inArray(users.id, creatorIds))
      : [];
    return res.json({
      ...(await repositoryCertificationProgress(db, ctx.owner, actor.userId)),
      canAdmin: ctx.admin,
      canManageTraining: ctx.admin || ctx.office,
      canAssignTravel: ctx.canAssignTravel,
      folders,
      trips,
      expenses,
      templates: rows.filter((r) => r.kind === "travel_template"),
      travelTemplates: TRAVEL_TEMPLATES,
      renewalSources: RENEWAL_SOURCES,
      options:
        ctx.admin || ctx.office
          ? await repositoryOptions(db, actor)
          : { people: [], groups: [], positions: [], accountTypes: [] },
      creators: names,
      travelGrants: ctx.admin
        ? rows.filter((r) => r.kind === "repository_travel_grant")
        : [],
      augmentations: rows.filter(
        (r) =>
          r.kind === "vendor_augmentation" &&
          (ctx.admin ||
            ctx.office ||
            ((r.data.userIds as number[]) ?? []).includes(actor.userId)),
      ),
      courses: await db
        .select({
          id: courses.id,
          title: courses.name,
          version: courses.currentVersion,
        })
        .from(courses)
        .where(
          and(
            eq(courses.ownerOrgType, ctx.owner.type),
            eq(courses.ownerOrgId, ctx.owner.id),
            sql`${courses.libraryMetadata}->>'kind' IN ('training','bundle')`,
          ),
        )
        .limit(2000),
    });
  } catch (e) {
    return fail(res, e);
  }
});
router.get(
  "/work-hub/repository/vendor/:vendorId/augmentations",
  async (req, res) => {
    try {
      const actor = res.locals.actor as LibraryActor,
        ctx = await repositoryContext(db, actor),
        vendorId = z.coerce
          .number()
          .int()
          .positive()
          .parse(req.params.vendorId);
      if (ctx.owner.type !== "partner" || !ctx.admin)
        throw new LibraryError("Partner administrator required", 403);
      const [link] = await db
        .select()
        .from(relationships)
        .where(
          and(
            eq(relationships.vendorId, vendorId),
            eq(relationships.partnerId, ctx.owner.id),
            eq(relationships.status, "approved"),
          ),
        )
        .limit(1);
      if (!link)
        throw new LibraryError("Approved vendor connection required", 403);
      const progress = await repositoryCertificationProgress(db, {
        type: "vendor",
        id: vendorId,
      });
      return res.json({
        vendorId,
        bonusScore: progress.bonusScore,
        certifications: progress.certifications
          .filter((c) => c.augmented)
          .map((c) => ({
            id: c.id,
            title: c.title,
            complete: c.complete,
            addedBy: "addedBy" in c ? c.addedBy : null,
            addedAt: "addedAt" in c ? c.addedAt : null,
            steps: c.steps.map((step: any) => ({
              title: step.title,
              type: step.type,
              complete: step.complete,
              expiresAt: step.expiresAt ?? null,
            })),
          })),
      });
    } catch (e) {
      return fail(res, e);
    }
  },
);
router.get("/work-hub/repository/travel/export", async (req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor,
      ctx = await repositoryContext(db, actor);
    if (!ctx.canAssignTravel)
      throw new LibraryError("Assign Travel permission required", 403);
    const rows = await db
      .select()
      .from(records)
      .where(repositoryScope(ctx.owner));
    const trips = rows.filter((r) => r.kind === "travel_trip");
    const selected = req.query.person
      ? z.coerce.number().int().positive().parse(req.query.person)
      : null;
    const names = new Map(
      (await repositoryOptions(db, actor)).people.map((p) => [
        p.userId,
        p.name,
      ]),
    );
    const csv = (v: unknown) =>
      `"${String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const output = [
      [
        "Traveler",
        "Trip",
        "Status",
        "Date",
        "Category",
        "Description",
        "Currency",
        "Amount",
        "Receipt",
        "Reimbursable",
      ],
      ...rows
        .filter(
          (r) =>
            r.kind === "travel_expense" &&
            (!selected || r.data.travelerId === selected),
        )
        .map((r) => {
          const trip = trips.find((t) => t.id === r.data.tripId);
          return [
            names.get(Number(r.data.travelerId)),
            trip?.data.title,
            trip?.data.status,
            r.data.date,
            r.data.kind,
            r.data.description,
            r.data.currency,
            (Number(r.data.amountCents) / 100).toFixed(2),
            r.data.receiptId ?? r.data.documentId,
            r.data.reimbursable,
          ];
        }),
    ];
    const csvBody = output.map((row) => row.map(csv).join(",")).join("\r\n");
    if (req.query.metadata === "1")
      return res.json({
        fileName: "travel-expenses.csv",
        contentType: "text/csv; charset=utf-8",
        byteSize: Buffer.byteLength(csvBody),
      });
    res.type("text/csv").attachment("travel-expenses.csv").send(csvBody);
  } catch (e) {
    return fail(res, e);
  }
});
router.get("/work-hub/repository/expenses/:id/receipt", async (req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor,
      ctx = await repositoryContext(db, actor);
    const expense = await repositoryRecord(
      db,
      ctx.owner,
      uuid.parse(req.params.id),
      "travel_expense",
    );
    const trip = await repositoryRecord(
      db,
      ctx.owner,
      String(expense.data.tripId),
      "travel_trip",
    );
    if (!ctx.canAssignTravel && trip.data.travelerId !== actor.userId)
      throw new LibraryError("Receipt not found", 404);
    const snapshot = expense.data.receiptSnapshot as {
      fileId: string;
      fileName: string;
      checksumSha256: string;
    } | null;
    if (!snapshot) throw new LibraryError("Receipt photo not attached", 404);
    const [file] = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, snapshot.fileId),
          eq(files.ownerOrgType, ctx.owner.type),
          eq(files.ownerOrgId, ctx.owner.id),
        ),
      );
    if (!file || file.checksumSha256 !== snapshot.checksumSha256)
      throw new LibraryError("Receipt not found", 404);
    if (req.query.metadata === "1")
      return res.json({
        fileName: snapshot.fileName,
        contentType: "application/octet-stream",
        byteSize: file.byteSize,
      });
    const object = await new ObjectStorageService().getStoredObject(
      file.storageKey,
    );
    if (
      object.body.length !== file.byteSize ||
      createHash("sha256").update(object.body).digest("hex") !==
        snapshot.checksumSha256
    )
      throw new LibraryError("Receipt integrity check failed", 409);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(snapshot.fileName)}`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.type("application/octet-stream").send(object.body);
  } catch (e) {
    return fail(res, e);
  }
});
router.get("/work-hub/repository/receipts", async (req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor,
      ctx = await repositoryContext(db, actor);
    const candidates = await db
      .select()
      .from(records)
      .where(and(repositoryScope(ctx.owner), eq(records.kind, "receipt")))
      .orderBy(desc(records.createdAt))
      .limit(200);
    const result = [];
    for (const r of candidates) {
      try {
        await resolveChannelAccess(
          actor,
          String(r.data.channelId),
          "channel.read",
        );
        result.push({
          id: r.id,
          fields: r.data.fields,
          photoDocumentId: r.data.photoDocumentId,
        });
      } catch {
        /* Preserve channel privacy. */
      }
    }
    return res.json(result);
  } catch (e) {
    return fail(res, e);
  }
});
router.post("/work-hub/repository/receipt-read", async (req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor,
      ctx = await repositoryContext(db, actor),
      id = uuid.parse(req.body.documentId),
      doc = await repositoryRecord(db, ctx.owner, id, "document");
    await requireRepositoryDocumentAccess(db, actor, doc, "read");
    if (!doc.data.tripId || doc.data.state !== "active")
      throw new LibraryError("Choose an active trip receipt photo", 400);
    if (doc.data.scope === "channel")
      await resolveChannelAccess(
        actor,
        String(doc.data.channelId),
        "file.download",
      );
    if (doc.data.scope === "personal" && doc.createdBy !== actor.userId)
      throw new LibraryError("File not found", 404);
    if (doc.data.scope === "meeting")
      await meetingRepositoryAccess(db, actor as any, doc);
    const now = Date.now();
    for (const [key, b] of ocrBudget) if (b.until < now) ocrBudget.delete(key);
    const budget = ocrBudget.get(actor.userId) ?? {
      count: 0,
      until: now + 60000,
    };
    if (budget.count >= 10 || ocrBudget.size > 5000)
      throw new LibraryError(
        "Wait a minute before reading another receipt",
        429,
      );
    budget.count++;
    ocrBudget.set(actor.userId, budget);
    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.id, String(doc.data.currentFileId)))
      .limit(1);
    if (!file || file.byteSize > 3 * 1024 * 1024)
      throw new LibraryError("Choose a receipt photo under 3 MB", 400);
    const object = await new ObjectStorageService().getStoredObject(
      file.storageKey,
    );
    if (!object) throw new LibraryError("Receipt photo unavailable", 404);
    return res.json(
      await readReceipt(object.body.toString("base64"), file.contentType),
    );
  } catch (e) {
    return fail(res, e);
  }
});
router.post("/work-hub/repository/:action", async (req, res) => {
  try {
    const actor = res.locals.actor as LibraryActor,
      envelope = workHubCommandEnvelopeSchema.parse(req.body),
      action = z
        .enum([
          "folder",
          "travel-setup",
          "travel-grant",
          "authorize",
          "expense",
          "trip-status",
          "template",
          "file-details",
          "augment",
          "trip-form",
          "ack",
          "renew",
        ])
        .parse(req.params.action);
    const ctx = await repositoryContext(db, actor);
    if (
      envelope.owner.type !== ctx.owner.type ||
      envelope.owner.id !== ctx.owner.id ||
      envelope.context.kind !== "organization" ||
      String(envelope.context.id) !== String(ctx.owner.id)
    )
      throw new LibraryError("Current company required", 403);
    const payload = z.record(z.string(), z.unknown()).parse(envelope.payload);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({ action, payload, version: envelope.expectedVersion }),
      )
      .digest("hex");
    const authorize = async (tx: any) => {
      const fresh = await repositoryContext(tx, actor);
      if (
        ["folder", "travel-setup", "travel-grant"].includes(action) &&
        !fresh.admin
      )
        throw new LibraryError("Vendor Admin required", 403);
      if (["authorize", "template"].includes(action) && !fresh.canAssignTravel)
        throw new LibraryError("Assign Travel permission required", 403);
      if (action === "augment" && !fresh.admin && !fresh.office)
        throw new LibraryError("Vendor Admin or Office Staff required", 403);
      if (["expense", "trip-status", "trip-form"].includes(action)) {
        const trip = await repositoryRecord(
          tx,
          fresh.owner,
          uuid.parse(payload.tripId),
          "travel_trip",
        );
        if (!fresh.canAssignTravel && trip.data.travelerId !== actor.userId)
          throw new LibraryError("Trip not found", 404);
      }
      if (action === "renew") {
        const a = await repositoryRecord(
          tx,
          fresh.owner,
          uuid.parse(payload.augmentationId),
          "vendor_augmentation",
        );
        if (!((a.data.userIds as number[]) ?? []).includes(actor.userId))
          throw new LibraryError("Assigned certification not found", 404);
      }
      if (action === "ack") {
        const a = await repositoryRecord(
          tx,
          fresh.owner,
          uuid.parse(payload.augmentationId),
          "vendor_augmentation",
        );
        if (
          !((a.data.userIds as number[]) ?? []).includes(actor.userId) ||
          !((a.data.documentIds as string[]) ?? []).includes(
            uuid.parse(payload.documentId),
          )
        )
          throw new LibraryError("Assigned material not found", 404);
        const doc = await repositoryRecord(
          tx,
          fresh.owner,
          uuid.parse(payload.documentId),
          "document",
        );
        await requireRepositoryDocumentAccess(tx, actor, doc, "read");
      }
      if (action === "file-details") {
        const doc = await repositoryRecord(
          tx,
          fresh.owner,
          uuid.parse(payload.id),
          "document",
        );
        await requireRepositoryDocumentAccess(tx, actor, doc, "edit");
        if (
          !fresh.admin &&
          doc.createdBy !== actor.userId &&
          (doc.data.scope !== "company" ||
            (!doc.data.folderId && !doc.data.tripId))
        )
          throw new LibraryError(
            "File owner or folder Edit permission required",
            403,
          );
        if (doc.data.scope === "meeting")
          await meetingRepositoryAccess(tx, actor as any, doc, true);
        if (doc.data.scope === "channel")
          await resolveChannelAccess(
            actor,
            String(doc.data.channelId),
            "file.download",
            tx,
          );
        if (doc.data.scope === "personal" && doc.createdBy !== actor.userId)
          throw new LibraryError("File not found", 404);
      }
    };
    const result = await executeWorkHubCommand(
      { userId: actor.userId, source: actor.source ?? "web" },
      `repository.${action}`,
      envelope,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`repository:${ctx.owner.type}:${ctx.owner.id}`}))`,
        );
        await authorize(tx);
        const fresh = await repositoryContext(tx, actor);
        const insert = async (
          kind: string,
          key: string,
          data: Record<string, unknown>,
        ) => {
          const [row] = await tx
            .insert(records)
            .values({
              orgType: ctx.owner.type,
              orgId: ctx.owner.id,
              kind,
              recordKey: key,
              createdBy: actor.userId,
              data: { ...data, version: 1 },
            })
            .returning();
          return row;
        };
        let saved: Record<string, unknown> = {};
        if (action === "folder") {
          const input = RepositoryFolderSchema.parse(payload);
          if (input.parentId)
            await repositoryFolder(tx, actor, input.parentId, "write");
          for (const grant of input.grants)
            await repositoryAudience(tx, actor, grant);
          const id = payload.id ? uuid.parse(payload.id) : null;
          if (input.parentId === id && id)
            throw new LibraryError("A folder cannot contain itself", 400);
          if (id) {
            const row = await repositoryRecord(
              tx,
              ctx.owner,
              id,
              "repository_folder",
            );
            let parent = input.parentId;
            for (let depth = 0; parent; depth++) {
              if (depth > 50 || parent === id)
                throw new LibraryError("Folder nesting cycle", 400);
              parent = (
                await repositoryRecord(
                  tx,
                  ctx.owner,
                  parent,
                  "repository_folder",
                )
              ).data.parentId as string | null;
            }
            saved = await updateRepositoryRecord(
              tx,
              row,
              envelope.expectedVersion,
              input,
            );
          } else
            saved = await insert(
              "repository_folder",
              envelope.operationId,
              input,
            );
        }
        if (action === "travel-setup") {
          const prior = await tx
            .select()
            .from(records)
            .where(
              and(
                repositoryScope(ctx.owner),
                eq(records.kind, "repository_folder"),
                eq(records.recordKey, "travel"),
              ),
            )
            .limit(1);
          if (prior.length) saved = { id: prior[0].id };
          else {
            const folder = await insert("repository_folder", "travel", {
              name: "Travel",
              category: "Travel",
              parentId: null,
              protected: true,
              grants: [],
            });
            for (const template of TRAVEL_TEMPLATES)
              await insert("travel_template", template.id, {
                ...template,
                folderId: folder.id,
                values: {},
                example: true,
              });
            saved = { id: folder.id };
          }
        }
        if (action === "travel-grant") {
          const userIds = z
            .array(z.number().int().positive())
            .max(5000)
            .parse(payload.userIds);
          const options = await repositoryOptions(tx, actor);
          const eligible = await repositoryAudience(tx, actor, {
            userIds,
            groupIds: [],
            roles: [],
          });
          for (const p of eligible) {
            if (
              !options.people.find((o) => o.userId === p.userId)
                ?.canAssignTravelRole
            )
              throw new LibraryError(
                "Assign Travel is available to Office Staff and Admins",
                400,
              );
          }
          const [prior] = await tx
            .select()
            .from(records)
            .where(
              and(
                repositoryScope(ctx.owner),
                eq(records.kind, "repository_travel_grant"),
                eq(records.recordKey, "assign-travel"),
              ),
            )
            .limit(1);
          saved = prior
            ? await updateRepositoryRecord(
                tx,
                prior,
                envelope.expectedVersion,
                {
                  userIds,
                  permission: "assign_travel",
                  label: "Assign Travel",
                },
              )
            : await insert("repository_travel_grant", "assign-travel", {
                userIds,
                permission: "assign_travel",
                label: "Assign Travel",
              });
        }
        if (action === "authorize") {
          const input = TravelAuthorizationSchema.parse(payload),
            people = await repositoryAudience(tx, actor, input.audience);
          if (!people.length)
            throw new LibraryError(
              "Choose Individuals, Groups or Positions",
              400,
            );
          const templateRows = await tx
            .select()
            .from(records)
            .where(
              and(
                repositoryScope(ctx.owner),
                eq(records.kind, "travel_template"),
              ),
            );
          const formSnapshots = input.templateIds.map((id) => {
            const t = templateRows.find(
              (r) => r.id === id || r.recordKey === id,
            );
            if (!t) throw new LibraryError("Travel template not found", 404);
            return {
              id: t.id,
              name: t.data.name,
              fields: t.data.fields,
              version: t.data.version,
            };
          });
          const created = [];
          for (const p of people) {
            const trip = await insert(
              "travel_trip",
              `${envelope.operationId}:${p.userId}`,
              {
                ...input,
                formSnapshots,
                forms: {},
                travelerId: p.userId,
                travelerName: p.name,
                status: "authorized",
                authorizedBy: actor.userId,
                authorizedAt: new Date().toISOString(),
                history: [
                  {
                    action: "authorize",
                    actorId: actor.userId,
                    at: new Date().toISOString(),
                  },
                ],
              },
            );
            created.push(trip.id);
          }
          saved = { tripIds: created };
        }
        if (action === "expense") {
          const trip = await repositoryRecord(
            tx,
            ctx.owner,
            uuid.parse(payload.tripId),
            "travel_trip",
          );
          if (!["authorized", "returned"].includes(String(trip.data.status)))
            throw new LibraryError("Trip is locked for review", 409);
          const input = TravelExpenseSchema.parse(payload);
          if (
            input.date < String(trip.data.startDate) ||
            input.date > String(trip.data.endDate)
          )
            throw new LibraryError(
              "Expense date must be within the authorized trip",
              400,
            );
          let receiptSnapshot: Record<string, unknown> | null = null;
          if (input.documentId) {
            const doc = await repositoryRecord(
              tx,
              ctx.owner,
              input.documentId,
              "document",
            );
            await requireRepositoryDocumentAccess(tx, actor, doc, "read");
            if (doc.data.scope === "meeting")
              await meetingRepositoryAccess(tx, actor as any, doc);
            if (doc.data.scope === "channel")
              await resolveChannelAccess(
                actor,
                String(doc.data.channelId),
                "channel.read",
                tx,
              );
            if (doc.data.scope === "personal" && doc.createdBy !== actor.userId)
              throw new LibraryError("File not found", 404);
            if (doc.data.state !== "active")
              throw new LibraryError("Active receipt required", 400);
            const [receiptFile] = await tx
              .select()
              .from(files)
              .where(
                and(
                  eq(files.id, String(doc.data.currentFileId)),
                  eq(files.ownerOrgType, ctx.owner.type),
                  eq(files.ownerOrgId, ctx.owner.id),
                ),
              );
            if (
              !receiptFile ||
              !["managed", "finalized"].includes(receiptFile.state)
            )
              throw new LibraryError("Receipt file unavailable", 404);
            receiptSnapshot = {
              fileId: receiptFile.id,
              fileName: receiptFile.fileName,
              checksumSha256: receiptFile.checksumSha256,
              attachedBy: actor.userId,
              attachedAt: new Date().toISOString(),
            };
          }
          if (input.receiptId) {
            const receipt = await repositoryRecord(
              tx,
              ctx.owner,
              input.receiptId,
              "receipt",
            );
            await resolveChannelAccess(
              actor,
              String(receipt.data.channelId),
              "channel.read",
              tx,
            );
            const [photo] = await tx
              .select()
              .from(files)
              .where(
                and(
                  eq(files.id, String(receipt.data.photoFileId)),
                  eq(files.ownerOrgType, ctx.owner.type),
                  eq(files.ownerOrgId, ctx.owner.id),
                ),
              );
            if (!photo || !["managed", "finalized"].includes(photo.state))
              throw new LibraryError("Receipt photo unavailable", 404);
            receiptSnapshot = {
              fileId: photo.id,
              fileName: photo.fileName,
              checksumSha256: photo.checksumSha256,
              attachedBy: actor.userId,
              attachedAt: new Date().toISOString(),
              sourceReceiptId: receipt.id,
            };
            const fields = receipt.data.fields as Record<string, string>;
            if (
              Math.round(Number(fields.total) * 100) !== input.amountCents ||
              fields.currency !== trip.data.currency
            )
              throw new LibraryError("Receipt amount/currency must match", 400);
          }
          const amountCents = expenseAmount({
            ...input,
            rateCents: trip.data.mileageRateCents as number | undefined,
          });
          if (
            input.kind === "receipt" &&
            !input.documentId &&
            !input.receiptId &&
            !input.missingReceiptReason
          )
            throw new LibraryError(
              "Attach a receipt or explain why it is missing",
              400,
            );
          const prior = await tx
            .select()
            .from(records)
            .where(
              and(
                repositoryScope(ctx.owner),
                eq(records.kind, "travel_expense"),
              ),
            );
          if (
            (input.receiptId || input.documentId) &&
            prior.some(
              (r) =>
                r.id !== payload.id &&
                ((input.receiptId && r.data.receiptId === input.receiptId) ||
                  (input.documentId && r.data.documentId === input.documentId)),
            )
          )
            throw new LibraryError(
              "This receipt is already attached to a travel expense",
              409,
            );
          const data = {
            ...input,
            amountCents,
            tripId: trip.id,
            travelerId: trip.data.travelerId,
            currency: trip.data.currency,
            receiptSnapshot,
            rateCents:
              input.kind === "mileage" ? trip.data.mileageRateCents : null,
          };
          if (payload.id) {
            const row = await repositoryRecord(
              tx,
              ctx.owner,
              uuid.parse(payload.id),
              "travel_expense",
            );
            if (row.data.tripId !== trip.id)
              throw new LibraryError("Expense not found", 404);
            saved = await updateRepositoryRecord(
              tx,
              row,
              envelope.expectedVersion,
              data,
            );
          } else
            saved = await insert("travel_expense", envelope.operationId, data);
        }
        if (action === "trip-status") {
          const trip = await repositoryRecord(
              tx,
              ctx.owner,
              uuid.parse(payload.tripId),
              "travel_trip",
            ),
            change = z
              .enum(["submit", "return", "approve", "close", "cancel"])
              .parse(payload.action),
            reason = z
              .string()
              .max(2000)
              .parse(payload.reason ?? "");
          if (
            ["approve", "return", "close", "cancel"].includes(change) &&
            !fresh.canAssignTravel
          )
            throw new LibraryError("Assign Travel required", 403);
          if (change === "approve" && trip.data.travelerId === actor.userId)
            throw new LibraryError(
              "Another authorized reviewer must approve your trip",
              403,
            );
          if (change === "return" && !reason.trim())
            throw new LibraryError(
              "Enter a reason for returning the report",
              400,
            );
          const status = travelTransition(
            String(trip.data.status),
            change,
            fresh.canAssignTravel,
          );
          const history = Array.isArray(trip.data.history)
            ? trip.data.history
            : [];
          saved = await updateRepositoryRecord(
            tx,
            trip,
            envelope.expectedVersion,
            {
              ...trip.data,
              status,
              history: [
                ...history,
                {
                  action: change,
                  reason,
                  actorId: actor.userId,
                  at: new Date().toISOString(),
                },
              ],
            },
          );
        }
        if (action === "trip-form") {
          const trip = await repositoryRecord(
            tx,
            ctx.owner,
            uuid.parse(payload.tripId),
            "travel_trip",
          );
          if (!["authorized", "returned"].includes(String(trip.data.status)))
            throw new LibraryError("Trip is locked for review", 409);
          const formId = uuid.parse(payload.formId),
            snapshot = ((trip.data.formSnapshots as any[]) ?? []).find(
              (f) => f.id === formId,
            );
          if (!snapshot) throw new LibraryError("Assigned form not found", 404);
          const values = z
            .record(z.string().max(100), z.string().max(10000))
            .parse(payload.values);
          if (Object.keys(values).some((k) => !snapshot.fields.includes(k)))
            throw new LibraryError("Unknown form field", 400);
          saved = await updateRepositoryRecord(
            tx,
            trip,
            envelope.expectedVersion,
            {
              ...trip.data,
              forms: {
                ...(trip.data.forms as object),
                [formId]: {
                  values,
                  updatedBy: actor.userId,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          );
        }
        if (action === "renew") {
          const a = await repositoryRecord(
              tx,
              ctx.owner,
              uuid.parse(payload.augmentationId),
              "vendor_augmentation",
            ),
            [base] = await tx
              .select()
              .from(courses)
              .where(eq(courses.id, String(a.data.baseItemId))),
            b = BundleDefinitionSchema.safeParse(base?.bundleDefinition);
          const ids = [
            ...new Set([
              ...(b.success
                ? b.data.entries.map((e) => e.templateId)
                : base
                  ? [base.id]
                  : []),
              ...((a.data.courseIds as string[]) ?? []),
            ]),
          ];
          const recipients = await repositoryAudience(tx, actor, {
            userIds: [actor.userId],
            roles: [],
            groupIds: [],
          });
          await assignRepositoryCourses(
            tx,
            ctx.owner,
            ids,
            recipients,
            actor,
            a.data.renewalMonths as number | null,
          );
          saved = { id: a.id };
        }
        if (action === "ack") {
          const aug = await repositoryRecord(
              tx,
              ctx.owner,
              uuid.parse(payload.augmentationId),
              "vendor_augmentation",
            ),
            doc = await repositoryRecord(
              tx,
              ctx.owner,
              uuid.parse(payload.documentId),
              "document",
            );
          if (
            doc.data.state !== "active" ||
            doc.data.scope !== "company" ||
            !doc.data.currentFileId
          )
            throw new LibraryError("Active company material required", 400);
          if (payload.confirmed !== true)
            throw new LibraryError("Confirm you completed this material", 400);
          const key = `${aug.id}:${actor.userId}:${doc.id}:${doc.data.currentFileId}`;
          const [prior] = await tx
            .select()
            .from(records)
            .where(
              and(
                repositoryScope(ctx.owner),
                eq(records.kind, "augmentation_ack"),
                eq(records.recordKey, key),
              ),
            );
          saved = prior
            ? await updateRepositoryRecord(
                tx,
                prior,
                Number(prior.data.version ?? 1),
                { ...prior.data, confirmedAt: new Date().toISOString() },
              )
            : await insert("augmentation_ack", key, {
                augmentationId: aug.id,
                documentId: doc.id,
                fileId: doc.data.currentFileId,
                userId: actor.userId,
                confirmed: true,
              });
        }
        if (action === "template") {
          const row = await repositoryRecord(
            tx,
            ctx.owner,
            uuid.parse(payload.id),
            "travel_template",
          );
          const input = z
            .object({
              name: z.string().trim().min(1).max(160),
              fields: z.array(z.string().trim().min(1).max(100)).max(60),
            })
            .parse(payload);
          saved = await updateRepositoryRecord(
            tx,
            row,
            envelope.expectedVersion,
            { ...row.data, ...input, example: false },
          );
        }
        if (action === "file-details") {
          const doc = await repositoryRecord(
            tx,
            ctx.owner,
            uuid.parse(payload.id),
            "document",
          );
          if (Number(doc.data.version ?? 1) !== envelope.expectedVersion)
            throw new LibraryError(
              "File details changed; reopen before saving",
              409,
            );
          const input = z
            .object({
              training: z.boolean(),
              categoryIds: z.array(z.uuid()).max(50),
              folderId: z.uuid().nullable(),
              tripId: z.uuid().nullable().default(null),
            })
            .parse(payload);
          if (input.folderId)
            await repositoryFolder(tx, actor, input.folderId, "write");
          for (const id of input.categoryIds)
            await repositoryFolder(tx, actor, id, "read");
          if (input.tripId) {
            const trip = await repositoryRecord(
              tx,
              ctx.owner,
              input.tripId,
              "travel_trip",
            );
            if (!fresh.canAssignTravel && trip.data.travelerId !== actor.userId)
              throw new LibraryError("Trip not found", 404);
          }
          await tx
            .update(records)
            .set({
              data: {
                ...doc.data,
                purpose: input.training ? "training" : null,
                categoryIds: input.categoryIds,
                folderId: input.folderId,
                tripId: input.tripId,
                version: Number(doc.data.version ?? 1) + 1,
                updatedBy: actor.userId,
                classifiedBy: actor.userId,
                classifiedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            })
            .where(eq(records.id, doc.id));
          saved = { id: doc.id };
        }
        if (action === "augment") {
          const input = z
            .object({
              title: z.string().trim().min(1).max(160),
              baseItemId: z.uuid(),
              courseIds: z.array(z.uuid()).max(100),
              documentIds: z.array(z.uuid()).max(100),
              required: z.boolean().default(true),
              renewalMonths: z
                .number()
                .int()
                .min(1)
                .max(120)
                .nullable()
                .default(null),
              renewalSource: z.string().max(1000).default(""),
              audience: RepositoryAudienceSchema,
            })
            .parse(payload);
          const ownedCourses = await tx
            .select()
            .from(courses)
            .where(
              and(
                eq(courses.ownerOrgType, ctx.owner.type),
                eq(courses.ownerOrgId, ctx.owner.id),
              ),
            );
          if (
            [input.baseItemId, ...input.courseIds].some(
              (id) => !ownedCourses.some((c) => c.id === id),
            )
          )
            throw new LibraryError("Course/certification not found", 404);
          for (const id of input.documentIds) {
            const doc = await repositoryRecord(tx, ctx.owner, id, "document");
            await requireRepositoryDocumentAccess(tx, actor, doc, "read");
            if (doc.data.scope !== "company" || doc.data.state !== "active")
              throw new LibraryError(
                "Choose active company training materials",
                400,
              );
          }
          if (input.renewalMonths && !input.renewalSource.trim())
            throw new LibraryError("A renewal policy/source is required", 400);
          const recipients = await repositoryAudience(
            tx,
            actor,
            input.audience,
          );
          for (const recipient of recipients)
            for (const id of input.documentIds) {
              const doc = await repositoryRecord(tx, ctx.owner, id, "document");
              if (
                !(await repositoryRecipientCanRead(
                  tx,
                  ctx.owner,
                  doc,
                  recipient.userId,
                ))
              )
                throw new LibraryError(
                  "Every recipient must have Read access to the selected material",
                  403,
                );
            }
          const base = ownedCourses.find((c) => c.id === input.baseItemId)!;
          const bundle = BundleDefinitionSchema.safeParse(
            base.bundleDefinition,
          );
          const ids = [
            ...new Set([
              ...(bundle.success
                ? bundle.data.entries.map((e) => e.templateId)
                : [base.id]),
              ...input.courseIds,
            ]),
          ];
          await assignRepositoryCourses(
            tx,
            ctx.owner,
            ids,
            recipients,
            actor,
            input.renewalMonths,
          );
          const augmentationData = {
            ...input,
            userIds: recipients.map((p) => p.userId),
            courseVersions: input.courseIds.map((id) => ({
              courseId: id,
              version: LibraryMetadataSchema.parse(
                ownedCourses.find((c) => c.id === id)!.libraryMetadata,
              ).contentVersion,
            })),
            addedBy: actor.userId,
            addedAt: new Date().toISOString(),
          };
          saved = payload.id
            ? await updateRepositoryRecord(
                tx,
                await repositoryRecord(
                  tx,
                  ctx.owner,
                  uuid.parse(payload.id),
                  "vendor_augmentation",
                ),
                envelope.expectedVersion,
                augmentationData,
              )
            : await insert(
                "vendor_augmentation",
                envelope.operationId,
                augmentationData,
              );
        }
        await appendWorkHubAudit(
          {
            actorUserId: actor.userId,
            owner: ctx.owner,
            action: `repository.${action}`,
            subjectType: "repository",
            subjectId: String(saved.id ?? envelope.operationId),
            source: actor.source ?? "web",
            operationId: envelope.operationId,
            metadata: { fingerprint },
          },
          tx,
        );
        return { ...saved, fingerprint };
      },
      authorize,
    );
    if (result.resource.fingerprint !== fingerprint)
      throw new LibraryError(
        "Operation does not match the original request",
        409,
      );
    return res.json(result);
  } catch (e) {
    return fail(res, e);
  }
});
export default router;
