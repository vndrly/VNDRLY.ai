import { createHash } from "node:crypto";
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, workHubFinanceRecordsTable as records, workHubFilesTable as files } from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const storage = new ObjectStorageService();
// Only trusted provider ingestion may create these records. There is deliberately
// no employee/admin upload or issue endpoint while payroll execution is unavailable.
const issuedDocument = z.object({
  recipientUserId: z.number().int().positive(),
  documentType: z.enum(["pay_statement", "w2"]),
  provider: z.string().min(1).max(80),
  providerDocumentId: z.string().min(1).max(200),
  state: z.literal("issued"),
  issuedAt: z.iso.datetime(),
  taxYear: z.number().int().min(2000).max(2200),
  fileId: z.string().uuid(),
});
const own = (userId: number) => and(eq(records.kind, "payroll_document"), sql`${records.data}->>'recipientUserId' = ${String(userId)}`);

router.get("/personal-documents", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) return res.sendStatus(401);
  const rows = await db.select().from(records).where(own(session.userId)).orderBy(desc(records.createdAt));
  const documents = [];
  for (const row of rows) {
    const parsed = issuedDocument.safeParse(row.data);
    if (!parsed.success) continue;
    const data = parsed.data;
    const [file] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, data.fileId), eq(files.ownerOrgType, row.orgType), eq(files.ownerOrgId, row.orgId), eq(files.state, "payroll_issued"), eq(files.contentType, "application/pdf"))).limit(1);
    if (file) documents.push({ id: row.id, documentType: data.documentType, issuedAt: data.issuedAt, taxYear: data.taxYear });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.json({ providerConfigured: false, documents, message: documents.length ? "Issued documents remain available. New payroll document delivery is not configured." : "Payroll document delivery is not configured. No issued pay statements or W-2s are available." });
});

router.get("/personal-documents/:id", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) return res.sendStatus(401);
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.sendStatus(404);
  const [row] = await db.select().from(records).where(and(own(session.userId), eq(records.id, id.data))).limit(1);
  const parsed = issuedDocument.safeParse(row?.data);
  if (!row || !parsed.success) return res.sendStatus(404);
  const [file] = await db.select().from(files).where(and(eq(files.id, parsed.data.fileId), eq(files.ownerOrgType, row.orgType), eq(files.ownerOrgId, row.orgId), eq(files.state, "payroll_issued"), eq(files.contentType, "application/pdf"))).limit(1);
  if (!file) return res.sendStatus(404);
  const object = await storage.getStoredObject(file.storageKey);
  if (object.body.length !== file.byteSize || createHash("sha256").update(object.body).digest("hex") !== file.checksumSha256) return res.status(409).json({ error: "Stored document failed integrity verification" });
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${parsed.data.documentType}-${parsed.data.taxYear}.pdf"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Referrer-Policy": "no-referrer" });
  return res.send(object.body);
});
export default router;
