import { Router, type IRouter, type Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, desc, sql, or } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  userOrgMembershipsTable as memberships,
  workHubFilesTable as files,
  workHubFileLibraryTable as library,
} from "@workspace/db";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { resolveChannelAccess } from "../work-hub/queries";
import { WorkHubAccessError } from "../work-hub/context-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import { ObjectStorageService } from "../lib/objectStorage";
import { absoluteUploadUrl } from "../lib/uploadUrl";
import { isWorkHubEnabled } from "../work-hub/feature-access";
const router: IRouter = Router();
const storage = new ObjectStorageService();
const ownerSchema = z.object({
  type: z.enum(["vendor", "partner"]),
  id: z.coerce.number().int().positive(),
});
type Owner = z.infer<typeof ownerSchema>;
type Actor = SessionPayload & { userId: number };
type Document = typeof library.$inferSelect;
class FileError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const scope = (owner: Owner) =>
  and(eq(library.orgType, owner.type), eq(library.orgId, owner.id));
const ownerOf = (doc: Document): Owner => ({
  type: doc.orgType as Owner["type"],
  id: doc.orgId,
});
async function membership(actor: Actor, owner: Owner) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, actor.userId),
        eq(memberships.orgType, owner.type),
        eq(
          owner.type === "vendor"
            ? memberships.vendorId
            : memberships.partnerId,
          owner.id,
        ),
      ),
    )
    .limit(1);
  return row;
}
async function documentAccess(actor: Actor, doc: Document, manage = false) {
  if (doc.kind !== "document") throw new FileError(404, "File not found");
  if (doc.data.scope === "personal") {
    if (
      doc.createdBy !== actor.userId ||
      !(await membership(actor, ownerOf(doc)))
    )
      throw new FileError(404, "File not found");
    return;
  }
  if (doc.data.scope === "channel") {
    const { channel } = await resolveChannelAccess(
      actor,
      String(doc.data.channelId),
      "file.download",
    );
    if (
      channel.ownerOrgType !== doc.orgType ||
      channel.ownerOrgId !== doc.orgId
    )
      throw new FileError(404, "File not found");
  } else if (!(await membership(actor, ownerOf(doc))))
    throw new FileError(404, "File not found");
  if (
    manage &&
    doc.createdBy !== actor.userId &&
    (await membership(actor, ownerOf(doc)))?.role !== "admin"
  )
    throw new FileError(
      403,
      "Only the file owner or company administrator may manage this file",
    );
}
async function loadDocument(id: string) {
  const [doc] = await db
    .select()
    .from(library)
    .where(and(eq(library.id, id), eq(library.kind, "document")))
    .limit(1);
  if (!doc) throw new FileError(404, "File not found");
  return doc;
}
function failure(res: Response, error: unknown) {
  return res
    .status(
      error instanceof FileError || error instanceof WorkHubAccessError
        ? error.status
        : 400,
    )
    .json({
      message: error instanceof Error ? error.message : "Invalid file request",
    });
}
async function serve(
  res: Response,
  doc: Document,
  versionId?: string,
  preview = false,
) {
  if (doc.data.state !== "active") throw new FileError(404, "File not found");
  const versions = doc.data.versions as string[];
  const id = versionId ?? String(doc.data.currentFileId);
  if (!versions.includes(id)) throw new FileError(404, "Version not found");
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.state, "managed")))
    .limit(1);
  if (
    !file ||
    file.ownerOrgId !== doc.orgId ||
    file.ownerOrgType !== doc.orgType
  )
    throw new FileError(404, "File not found");
  const object = await storage.getStoredObject(file.storageKey);
  if (
    object.body.length !== file.byteSize ||
    createHash("sha256").update(object.body).digest("hex") !==
      file.checksumSha256
  )
    throw new FileError(409, "Stored file failed integrity verification");
  // Active formats never execute in the application origin, even through public links.
  const canPreview =
    /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(
      file.contentType,
    );
  res.setHeader(
    "Content-Type",
    canPreview ? file.contentType : "application/octet-stream",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Disposition",
    `${preview && canPreview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  return res.send(object.body);
}
router.use("/work-hub/file-library", async (_req, res, next) => {
  if (!(await isWorkHubEnabled())) return res.sendStatus(404);
  return next();
});
router.get("/work-hub/file-library/public/:token", async (req, res) => {
  try {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.token);
    const [link] = await db
      .select()
      .from(library)
      .where(
        and(
          eq(library.kind, "share"),
          eq(
            library.recordKey,
            createHash("sha256").update(token).digest("hex"),
          ),
        ),
      )
      .limit(1);
    if (
      !link ||
      link.data.revoked ||
      !(new Date(String(link.data.expiresAt)).getTime() > Date.now())
    )
      throw new FileError(404, "Link expired or revoked");
    const doc = await loadDocument(String(link.data.documentId));
    if (doc.orgId !== link.orgId || doc.orgType !== link.orgType)
      throw new FileError(404, "File not found");
    return await serve(res, doc, String(link.data.versionId));
  } catch (error) {
    return failure(res, error);
  }
});
async function legacyFileAccess(actor: Actor, file: typeof files.$inferSelect) {
  if (file.state !== "finalized") throw new FileError(404, "File not found");
  if (file.channelId) {
    const { channel } = await resolveChannelAccess(
      actor,
      file.channelId,
      "file.download",
    );
    if (
      channel.ownerOrgType !== file.ownerOrgType ||
      channel.ownerOrgId !== file.ownerOrgId
    )
      throw new FileError(404, "File not found");
  } else if (
    !(await membership(actor, {
      type: file.ownerOrgType as "vendor" | "partner",
      id: file.ownerOrgId,
    }))
  )
    throw new FileError(404, "File not found");
}
router.get("/work-hub/file-library/legacy", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req) as Actor | null;
    if (!actor?.userId) return res.sendStatus(401);
    const candidates = await db
      .select()
      .from(files)
      .where(eq(files.state, "finalized"))
      .orderBy(desc(files.finalizedAt));
    const visible = [];
    for (const file of candidates) {
      try {
        await legacyFileAccess(actor, file);
        visible.push({
          id: file.id,
          fileName: file.fileName,
          contentType: file.contentType,
          byteSize: file.byteSize,
          finalizedAt: file.finalizedAt,
        });
      } catch {}
    }
    return res.json(visible);
  } catch (error) {
    return failure(res, error);
  }
});
router.get("/work-hub/file-library/legacy/:id/download", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req) as Actor | null;
    if (!actor?.userId) return res.sendStatus(401);
    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.id, z.string().uuid().parse(req.params.id)))
      .limit(1);
    if (!file) throw new FileError(404, "File not found");
    await legacyFileAccess(actor, file);
    const object = await storage.getStoredObject(file.storageKey);
    const safe =
      /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(
        file.contentType,
      );
    res.setHeader(
      "Content-Type",
      safe ? file.contentType : "application/octet-stream",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      (req.query.preview === "1" && safe ? "inline" : "attachment") +
        "; filename*=UTF-8''" +
        encodeURIComponent(file.fileName),
    );
    return res.send(object.body);
  } catch (error) {
    return failure(res, error);
  }
});
router.get("/work-hub/file-library", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req) as Actor | null;
    if (!actor?.userId) return res.sendStatus(401);
    const owner = ownerSchema.parse({
      type: req.query.orgType,
      id: req.query.orgId,
    });
    const candidates = await db
      .select()
      .from(library)
      .where(
        and(
          or(scope(owner), sql`${library.data}->>'scope' = 'channel'`),
          eq(library.kind, "document"),
        ),
      )
      .orderBy(desc(library.updatedAt));
    const favorites = await db
      .select()
      .from(library)
      .where(
        and(eq(library.kind, "favorite"), eq(library.createdBy, actor.userId)),
      );
    const documents = [];
    for (const doc of candidates) {
      try {
        await documentAccess(actor, doc);
        documents.push({
          ...doc,
          favorite: favorites.some(
            (f) => f.data.documentId === doc.id && f.data.active,
          ),
          canManage:
            doc.createdBy === actor.userId ||
            (await membership(actor, ownerOf(doc)))?.role === "admin",
        });
      } catch {}
    }
    return res.json(documents);
  } catch (error) {
    return failure(res, error);
  }
});
router.get("/work-hub/file-library/:id/download", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req) as Actor | null;
    if (!actor?.userId) return res.sendStatus(401);
    const doc = await loadDocument(z.string().uuid().parse(req.params.id));
    await documentAccess(actor, doc);
    return await serve(
      res,
      doc,
      req.query.version
        ? z.string().uuid().parse(req.query.version)
        : undefined,
      req.query.preview === "1",
    );
  } catch (error) {
    return failure(res, error);
  }
});
router.get("/work-hub/file-library/:id/versions", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req) as Actor | null;
    if (!actor?.userId) return res.sendStatus(401);
    const doc = await loadDocument(z.string().uuid().parse(req.params.id));
    await documentAccess(actor, doc);
    const rows = [];
    for (const id of doc.data.versions as string[]) {
      const [file] = await db
        .select({
          id: files.id,
          fileName: files.fileName,
          contentType: files.contentType,
          byteSize: files.byteSize,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(eq(files.id, id));
      if (file) rows.push(file);
    }
    return res.json(rows);
  } catch (error) {
    return failure(res, error);
  }
});
router.post("/work-hub/file-library/:action", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req) as Actor | null;
    if (!actor?.userId) return res.sendStatus(401);
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const owner = ownerSchema.parse(envelope.owner);
    if (
      envelope.context.kind !== "organization" ||
      String(envelope.context.id) !== String(owner.id)
    )
      throw new FileError(403, "Owner context mismatch");
    const action = String(req.params.action);
    // Replays must pass current authorization before the operation cache is read.
    const replayPayload = z
      .object({
        id: z.string().uuid().optional(),
        documentId: z.string().uuid().optional(),
        scope: z.enum(["personal", "company", "channel"]).optional(),
        channelId: z.string().uuid().optional(),
      })
      .passthrough()
      .parse(envelope.payload);
    const replayDocumentId = replayPayload.id ?? replayPayload.documentId;
    if (replayDocumentId) {
      const replayDocument = await loadDocument(replayDocumentId);
      await documentAccess(actor, replayDocument, action !== "favorite");
      if (
        replayDocument.orgId !== owner.id ||
        replayDocument.orgType !== owner.type
      )
        throw new FileError(403, "File owner mismatch");
    } else if (
      action === "reserve" &&
      replayPayload.scope === "channel" &&
      replayPayload.channelId
    ) {
      const { channel } = await resolveChannelAccess(
        actor,
        replayPayload.channelId,
        "channel.write",
      );
      if (
        channel.ownerOrgId !== owner.id ||
        channel.ownerOrgType !== owner.type
      )
        throw new FileError(403, "Channel owner mismatch");
    } else if (!(await membership(actor, owner)))
      throw new FileError(403, "Company membership required");
    const result = await executeWorkHubCommand(
      { userId: actor.userId, source: "web" },
      `file-library.${action}`,
      envelope,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`file-library:${owner.type}:${owner.id}`}))`,
        );
        if (action === "reserve") {
          const p = z
            .object({
              documentId: z.string().uuid().optional(),
              scope: z.enum(["personal", "company", "channel"]),
              channelId: z.string().uuid().optional(),
              fileName: z.string().trim().min(1).max(255),
              contentType: z.string().min(1).max(120),
              byteSize: z
                .number()
                .int()
                .positive()
                .max(25 * 1024 * 1024),
              checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(envelope.payload);
          let doc: Document;
          if (p.documentId) {
            doc = await loadDocument(p.documentId);
            await documentAccess(actor, doc, true);
            if (
              doc.orgId !== owner.id ||
              doc.orgType !== owner.type ||
              doc.data.state !== "active"
            )
              throw new FileError(403, "File owner mismatch or recycled file");
          } else {
            if (p.scope !== "channel" && !(await membership(actor, owner)))
              throw new FileError(403, "Company membership required");
            if (p.scope === "channel") {
              if (!p.channelId) throw new FileError(400, "Channel is required");
              const { channel } = await resolveChannelAccess(
                actor,
                p.channelId,
                "channel.write",
              );
              if (
                channel.ownerOrgId !== owner.id ||
                channel.ownerOrgType !== owner.type
              )
                throw new FileError(403, "Channel owner mismatch");
            }
            [doc] = await tx
              .insert(library)
              .values({
                orgType: owner.type,
                orgId: owner.id,
                kind: "document",
                recordKey: envelope.operationId,
                createdBy: actor.userId,
                data: {
                  scope: p.scope,
                  channelId: p.scope === "channel" ? p.channelId : null,
                  name: p.fileName,
                  state: "active",
                  versions: [],
                  currentFileId: null,
                },
              })
              .returning();
          }
          const descriptor = storage.getUploadDescriptor();
          const [file] = await tx
            .insert(files)
            .values({
              ownerOrgType: owner.type,
              ownerOrgId: owner.id,
              channelId: doc.data.channelId as string | null,
              uploadedById: actor.userId,
              storageKey: descriptor.objectPath,
              fileName: p.fileName,
              contentType: p.contentType,
              byteSize: p.byteSize,
              checksumSha256: p.checksumSha256,
              state: "managed_reserved",
              mediaMetadata: { documentId: doc.id },
              expiresAt: new Date(Date.now() + 86400000),
            })
            .returning();
          return {
            documentId: doc.id,
            fileId: file.id,
            objectPath: file.storageKey,
            uploadURL: absoluteUploadUrl(req, descriptor.uploadURL),
          };
        }
        const p = z
          .object({
            id: z.string().uuid(),
            fileId: z.string().uuid().optional(),
            active: z.boolean().optional(),
            expiresInDays: z.number().int().min(1).max(30).optional(),
            shareId: z.string().uuid().optional(),
          })
          .strict()
          .parse(envelope.payload);
        const doc = await loadDocument(p.id);
        await documentAccess(actor, doc, action !== "favorite");
        if (doc.orgId !== owner.id || doc.orgType !== owner.type)
          throw new FileError(403, "File owner mismatch");
        let data = { ...doc.data };
        if (action === "finalize") {
          if (data.state !== "active" || !p.fileId)
            throw new FileError(409, "Active file and upload required");
          const [file] = await tx
            .select()
            .from(files)
            .where(eq(files.id, p.fileId))
            .limit(1);
          if (
            !file ||
            file.uploadedById !== actor.userId ||
            file.mediaMetadata?.documentId !== doc.id ||
            file.state !== "managed_reserved" ||
            !file.expiresAt ||
            file.expiresAt.getTime() < Date.now()
          )
            throw new FileError(403, "Upload reservation mismatch or expired");
          const object = await storage.getStoredObject(file.storageKey);
          if (
            object.body.length !== file.byteSize ||
            createHash("sha256").update(object.body).digest("hex") !==
              file.checksumSha256
          )
            throw new FileError(409, "Uploaded bytes do not match reservation");
          await storage.trySetObjectEntityAclPolicy(file.storageKey, {
            owner: `workhub-file:${file.id}`,
            visibility: "private",
          });
          await tx
            .update(files)
            .set({ state: "managed", finalizedAt: new Date(), expiresAt: null })
            .where(eq(files.id, file.id));
          data = {
            ...data,
            currentFileId: file.id,
            name: file.fileName,
            contentType: file.contentType,
            byteSize: file.byteSize,
            versions: [...(data.versions as string[]), file.id],
          };
        } else if (action === "recycle" || action === "restore") {
          data.state = action === "recycle" ? "recycled" : "active";
          if (action === "recycle") {
            const links = await tx
              .select()
              .from(library)
              .where(
                and(
                  scope(owner),
                  eq(library.kind, "share"),
                  sql`${library.data}->>'documentId' = ${doc.id}`,
                ),
              );
            for (const link of links)
              await tx
                .update(library)
                .set({
                  data: { ...link.data, revoked: true },
                  updatedAt: new Date(),
                })
                .where(eq(library.id, link.id));
          }
        } else if (action === "favorite") {
          const [saved] = await tx
            .insert(library)
            .values({
              orgType: owner.type,
              orgId: owner.id,
              kind: "favorite",
              recordKey: `${actor.userId}:${doc.id}`,
              createdBy: actor.userId,
              data: { documentId: doc.id, active: p.active ?? true },
            })
            .onConflictDoUpdate({
              target: [
                library.orgType,
                library.orgId,
                library.kind,
                library.recordKey,
              ],
              set: {
                data: { documentId: doc.id, active: p.active ?? true },
                updatedAt: new Date(),
              },
            })
            .returning();
          return saved;
        } else if (action === "share") {
          if (data.state !== "active" || !data.currentFileId)
            throw new FileError(409, "Finalized active file required");
          const token = randomBytes(32).toString("hex");
          const expiresAt = new Date(
            Date.now() + (p.expiresInDays ?? 7) * 86400000,
          ).toISOString();
          const [link] = await tx
            .insert(library)
            .values({
              orgType: owner.type,
              orgId: owner.id,
              kind: "share",
              recordKey: createHash("sha256").update(token).digest("hex"),
              createdBy: actor.userId,
              data: {
                documentId: doc.id,
                versionId: data.currentFileId,
                expiresAt,
                revoked: false,
              },
            })
            .returning();
          await appendWorkHubAudit(
            {
              actorUserId: actor.userId,
              owner,
              action: "file.shared",
              subjectType: "file",
              subjectId: doc.id,
              source: "web",
              operationId: envelope.operationId,
            },
            tx,
          );
          return { id: link.id, documentId: doc.id, token, expiresAt };
        } else if (action === "revoke-share") {
          // Revoke every public link for this document without changing or deleting its object.
          const links = await tx
            .select()
            .from(library)
            .where(
              and(
                scope(owner),
                eq(library.kind, "share"),
                sql`${library.data}->>'documentId' = ${doc.id}`,
              ),
            );
          for (const link of links)
            await tx
              .update(library)
              .set({
                data: { ...link.data, revoked: true },
                updatedAt: new Date(),
              })
              .where(eq(library.id, link.id));
        } else throw new FileError(400, "Unknown file action");
        const [saved] = await tx
          .update(library)
          .set({ data, updatedAt: new Date() })
          .where(eq(library.id, doc.id))
          .returning();
        await appendWorkHubAudit(
          {
            actorUserId: actor.userId,
            owner,
            action: `file.${action}`,
            subjectType: "file",
            subjectId: doc.id,
            source: "web",
            operationId: envelope.operationId,
          },
          tx,
        );
        return saved;
      },
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
});
export default router;
