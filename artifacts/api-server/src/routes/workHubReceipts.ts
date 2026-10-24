import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, workHubFileLibraryTable as library, workHubFilesTable as files, workHubMessagesTable as messages } from "@workspace/db";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { resolveChannelAccess } from "../work-hub/queries";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { WorkHubAccessError } from "../work-hub/context-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import { readReceipt, receiptInput, receiptCsv, receiptExcel, type ReceiptData } from "../work-hub/receipts";

const router: IRouter = Router();
const uuid = z.string().uuid();
const ocrBudget = new Map<number, { count: number; expires: number }>();
async function actorFor(req: Request) {
  if (!await isWorkHubEnabled()) throw new WorkHubAccessError("not_found");
  const actor = getSessionFromRequest(req);
  if (!actor?.userId) throw Object.assign(new Error("Sign in to use receipts."), { status: 401 });
  return actor as typeof actor & { userId: number };
}
function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: "Check the receipt fields, date and amounts, and confirm your review." });
  if (error instanceof WorkHubAccessError) return res.status(error.status).json({ message: error.message });
  const e = error as Error & { status?: number };
  return res.status(e.status ?? 500).json({ message: e.status ? e.message : "Receipt operation could not be completed. Please retry." });
}
const receiptScope = (channelId: string) => and(eq(library.kind, "receipt"), sql`${library.data}->>'channelId' = ${channelId}`);

router.post("/work-hub/channels/:channelId/receipts/ocr", async (req, res) => {
  try {
    const actor = await actorFor(req);
    await resolveChannelAccess(actor, uuid.parse(req.params.channelId), "channel.write");
    const now = Date.now();
    for (const [id, entry] of ocrBudget) if (entry.expires < now) ocrBudget.delete(id);
    const entry = ocrBudget.get(actor.userId) ?? { count: 0, expires: now + 60_000 };
    if (entry.count >= 10 || ocrBudget.size >= 5000) return res.status(429).json({ message: "Please wait a minute before reading another receipt." });
    entry.count++; ocrBudget.set(actor.userId, entry);
    const input = z.object({ imageBase64: z.string().max(4 * 1024 * 1024), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict().parse(req.body);
    try { return res.json(await readReceipt(input.imageBase64, input.mimeType)); }
    catch { return res.status(503).json({ message: "Receipt reading is unavailable. You can still enter and save the fields manually." }); }
  } catch (error) { return fail(res, error); }
});

router.get("/work-hub/channels/:channelId/receipts", async (req, res) => {
  try {
    const actor = await actorFor(req), channelId = uuid.parse(req.params.channelId);
    const { access } = await resolveChannelAccess(actor, channelId, "channel.read");
    const result = await db.select().from(library).where(receiptScope(channelId)).orderBy(desc(library.createdAt), desc(library.id)).limit(201);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ rows: result.slice(0, 200).map(r => ({ ...r, canEdit: r.createdBy === actor.userId || access.capabilities.has("channel.manage") })), hasMore: result.length > 200 });
  } catch (error) { return fail(res, error); }
});

router.get("/work-hub/channels/:channelId/receipts/export", async (req, res) => {
  try {
    const actor = await actorFor(req), channelId = uuid.parse(req.params.channelId);
    await resolveChannelAccess(actor, channelId, "channel.read");
    const format = z.enum(["csv", "xlsx"]).parse(req.query.format);
    const id = req.query.id ? uuid.parse(req.query.id) : undefined;
    const result = await db.select().from(library).where(and(receiptScope(channelId), id ? eq(library.id, id) : undefined)).orderBy(desc(library.createdAt)).limit(10001);
    if (id && !result.length) throw new WorkHubAccessError("not_found");
    if (result.length > 10000) return res.status(413).json({ message: "This export exceeds 10,000 receipts. Export individual receipts instead." });
    const rows = result.map(r => ({ id: r.id, data: r.data as ReceiptData }));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="receipts.${format}"`);
    res.type(format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(format === "csv" ? receiptCsv(rows) : await receiptExcel(rows));
  } catch (error) { return fail(res, error); }
});

router.get("/work-hub/channels/:channelId/receipts/:receiptId", async (req, res) => {
  try {
    const actor = await actorFor(req), channelId = uuid.parse(req.params.channelId);
    const { access } = await resolveChannelAccess(actor, channelId, "channel.read");
    const [row] = await db.select().from(library).where(and(receiptScope(channelId), eq(library.id, uuid.parse(req.params.receiptId)))).limit(1);
    if (!row) throw new WorkHubAccessError("not_found");
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ ...row, canEdit: row.createdBy === actor.userId || access.capabilities.has("channel.manage") });
  } catch (error) { return fail(res, error); }
});

async function saveReceipt(req: Request, res: Response) {
  try {
    const actor = await actorFor(req), channelId = uuid.parse(req.params.channelId);
    const id = req.params.receiptId ? uuid.parse(req.params.receiptId) : undefined;
    const envelope = workHubCommandEnvelopeSchema.parse(req.body), input = receiptInput.parse(envelope.payload);
    const fingerprint = createHash("sha256").update(JSON.stringify({ channelId, id, input, version: envelope.expectedVersion })).digest("hex");
    const result = await executeWorkHubCommand({ userId: actor.userId, source: "web" }, "receipt.save", envelope, async tx => {
      const { access } = await resolveChannelAccess(actor, channelId, "channel.write", tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`receipt:${id ?? envelope.operationId}`}))`);
      const [photo] = await tx.select().from(library).where(eq(library.id, input.photoDocumentId)).limit(1);
      if (!photo || photo.kind !== "document" || photo.data.channelId !== channelId || photo.data.scope !== "channel" || photo.data.state !== "active" || !photo.data.currentFileId || photo.orgId !== envelope.owner.id || photo.orgType !== envelope.owner.type) throw new WorkHubAccessError("not_found");
      const [image] = await tx.select().from(files).where(eq(files.id, String(photo.data.currentFileId))).limit(1);
      if (!image || image.state !== "managed" || !["image/jpeg", "image/png", "image/webp"].includes(image.contentType)) throw Object.assign(new Error("Save a JPEG, PNG, or WebP receipt photo first."), { status: 400 });
      let prior: typeof library.$inferSelect | undefined;
      if (id) {
        [prior] = await tx.select().from(library).where(and(receiptScope(channelId), eq(library.id, id))).limit(1);
        if (!prior) throw new WorkHubAccessError("not_found");
        if (prior.createdBy !== actor.userId && !access.capabilities.has("channel.manage")) throw new WorkHubAccessError("forbidden");
        if (prior.data.version !== envelope.expectedVersion) throw Object.assign(new Error("This receipt changed. Reopen it before editing."), { status: 409 });
        if (prior.data.photoDocumentId !== input.photoDocumentId) throw Object.assign(new Error("The original receipt photo cannot be replaced."), { status: 400 });
        await tx.insert(library).values({ orgType: prior.orgType, orgId: prior.orgId, kind: "receipt_revision", recordKey: `${id}:${prior.data.version}`, createdBy: actor.userId, data: prior.data });
      }
      const version = Number(prior?.data.version ?? 0) + 1;
      const data: ReceiptData = { schemaVersion: 1, channelId, photoDocumentId: photo.id, photoFileId: String(prior?.data.photoFileId ?? image.id), fields: input.fields, version, reviewedBy: actor.userId, reviewedAt: new Date().toISOString() };
      const [record] = prior ? await tx.update(library).set({ data, updatedAt: new Date() }).where(eq(library.id, prior.id)).returning() : await tx.insert(library).values({ orgType: envelope.owner.type, orgId: envelope.owner.id, kind: "receipt", recordKey: envelope.operationId, createdBy: actor.userId, data }).returning();
      if (!prior) await tx.insert(messages).values({ channelId, authorUserId: actor.userId, body: `Receipt: ${input.fields.merchant}\n/work-hub/chat?channel=${channelId}&receipt=${record.id}`, kind: "text", clientOperationId: envelope.operationId });
      await appendWorkHubAudit({ actorUserId: actor.userId, owner: envelope.owner, action: prior ? "receipt.updated" : "receipt.created", subjectType: "receipt", subjectId: record.id, priorVersion: version - 1, newVersion: version, source: "web", operationId: envelope.operationId }, tx);
      return { ...record, fingerprint };
    }, async tx => {
      const { channel } = await resolveChannelAccess(actor, channelId, "channel.write", tx);
      if (channel.ownerOrgId !== envelope.owner.id || channel.ownerOrgType !== envelope.owner.type) throw new WorkHubAccessError("forbidden");
    });
    if (result.resource.fingerprint !== fingerprint) throw new WorkHubAccessError("forbidden");
    return res.status(result.replayed || id ? 200 : 201).json(result);
  } catch (error) { return fail(res, error); }
}
router.post("/work-hub/channels/:channelId/receipts", saveReceipt);
router.patch("/work-hub/channels/:channelId/receipts/:receiptId", saveReceipt);
export default router;
