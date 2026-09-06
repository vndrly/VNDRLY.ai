import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { sendResponse } from "../lib/typed-response";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { getSessionFromRequest } from "../lib/session";
import { getObjectStore, UPLOAD_ROUTE } from "../lib/objectStore";
import { absoluteUploadUrl } from "../lib/uploadUrl";
import { db, siteLocationsTable, siteVisitsTable, siteWorkAssignmentsTable, ticketNoteLogsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { canReadTicketAttachment, ticketAttachmentReference } from "../lib/ticket-attachment-access";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function hasValidImageSignature(contentType: string, body: Buffer): boolean {
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (!type.startsWith("image/")) return true;
  if (type === "image/jpeg" || type === "image/jpg") return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (type === "image/png") return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/gif") return body.subarray(0, 6).toString("ascii") === "GIF87a" || body.subarray(0, 6).toString("ascii") === "GIF89a";
  if (type === "image/webp") return body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
  if (type === "image/heic" || type === "image/heif") return body.subarray(4, 12).toString("ascii").includes("ftyp");
  return true;
}

async function canReadVisitEvidence(session: ReturnType<typeof getSessionFromRequest>, objectPath: string): Promise<boolean> {
  if (!session?.userId) return false;
  const [visit] = await db
    .select({
      siteLocationId: siteVisitsTable.siteLocationId,
      hostVendorId: siteVisitsTable.hostVendorId,
      sitePartnerId: siteLocationsTable.partnerId,
    })
    .from(siteVisitsTable)
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, siteVisitsTable.siteLocationId))
    .where(or(eq(siteVisitsTable.platePhotoUrl, objectPath), eq(siteVisitsTable.vehiclePhotoUrl, objectPath)))
    .limit(1);
  if (!visit) return false;
  if (session.role === "admin") return true;
  if (session.role === "partner") return session.partnerId === visit.sitePartnerId;
  if (session.role !== "vendor" || !session.vendorId) return false;
  if (session.vendorRole !== "gatekeeper") return session.vendorId === visit.hostVendorId;
  const [assignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(and(
      eq(siteWorkAssignmentsTable.vendorId, session.vendorId),
      eq(siteWorkAssignmentsTable.siteLocationId, visit.siteLocationId),
    ))
    .limit(1);
  return Boolean(assignment);
}

function maxUploadBytes(): number {
  const configured = Number(process.env.SUPABASE_STORAGE_MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_UPLOAD_BYTES;
}

/**
 * PUT /storage/upload/:id
 *
 * Receives raw upload bytes from the browser. The upload id is an unguessable
 * UUID issued by request-url; no session required (same security model as a
 * presigned URL). Onboarding field employees use this before they have login.
 */
router.put(
  "/storage/upload/:id",
  express.raw({ type: "*/*", limit: maxUploadBytes() }),
  async (req: Request, res: Response) => {
    const uploadId = String(req.params.id ?? "").trim();
    if (!uploadId || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
      res.status(400).json({ error: "Invalid upload id" });
      return;
    }
    if (
      !getObjectStore().validateUploadURL(
        uploadId,
        typeof req.query.expires === "string" ? req.query.expires : undefined,
        typeof req.query.signature === "string" ? req.query.signature : undefined,
      )
    ) {
      res.status(403).json({ error: "Invalid or expired upload URL" });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    const contentType =
      typeof req.headers["content-type"] === "string"
        ? req.headers["content-type"]
        : "application/octet-stream";
    if (!hasValidImageSignature(contentType, body)) {
      res.status(415).json({ error: "Uploaded bytes do not match a supported image type" });
      return;
    }
    try {
      await getObjectStore().putUpload(uploadId, contentType, body);
      res.status(204).end();
    } catch (error) {
      console.error("Error storing upload", error);
      res.status(500).json({ error: "Failed to store upload" });
    }
  },
);

/**
 * POST /storage/uploads/request-url
 *
 * Request an upload URL on our API. Client PUTs bytes to uploadURL, then
 * calls finalize to stamp ACL metadata.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (!session || !session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  if (parsed.data.size < 0 || parsed.data.size > maxUploadBytes()) {
    res.status(413).json({ error: "File exceeds the upload size limit" });
    return;
  }

  try {
    const descriptor = objectStorageService.getUploadDescriptor();
    sendResponse(res, RequestUploadUrlResponse, {
      uploadURL: absoluteUploadUrl(req, descriptor.uploadURL),
      objectPath: descriptor.objectPath,
    });
  } catch (error) {
    console.error("Error generating upload URL", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * POST /storage/uploads/finalize
 *
 * After the client PUTs the file, stamp an ACL policy on the object.
 */
router.post("/storage/uploads/finalize", async (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (!session || !session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const objectURL = String(req.body?.objectURL ?? "");
  const visibility =
    req.body?.visibility === "private" ? "private" : "public";
  if (!objectURL) {
    res.status(400).json({ error: "objectURL is required" });
    return;
  }

  try {
    const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
      objectURL,
      {
        owner: String(session.userId),
        visibility,
        ...(req.body?.purpose === "gate-evidence" ? { purpose: "gate-evidence" as const } : {}),
      },
    );
    res.json({ objectPath });
  } catch (error) {
    console.error("Error finalizing upload ACL", error);
    res.status(500).json({ error: "Failed to finalize upload" });
  }
});

router.delete("/storage/uploads", async (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const objectPath = String(req.body?.objectPath ?? "").trim();
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath)) {
    res.status(400).json({ error: "Invalid object path" });
    return;
  }
  try {
    const object = await objectStorageService.getStoredObject(objectPath);
    if (object.acl?.owner !== String(session.userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [reference] = await db
      .select({ id: siteVisitsTable.id })
      .from(siteVisitsTable)
      .where(or(eq(siteVisitsTable.platePhotoUrl, objectPath), eq(siteVisitsTable.vehiclePhotoUrl, objectPath)))
      .limit(1);
    if (reference) {
      res.status(409).json({ error: "Object is attached to a visit" });
      return;
    }
    const [ticketReference] = await db.select({ id: ticketNoteLogsTable.id })
      .from(ticketNoteLogsTable).where(ticketAttachmentReference(objectPath)).limit(1);
    if (ticketReference) {
      res.status(409).json({ error: "Object is attached to a ticket" });
      return;
    }
    await objectStorageService.deleteStoredObject(objectPath);
    res.status(204).end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(204).end();
      return;
    }
    res.status(500).json({ error: "Failed to delete upload" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public branding assets (logos seeded under `public/`).
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const obj = await objectStorageService.getPublicObject(filePath);
    if (!obj) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Length", String(obj.size));
    res.send(obj.body);
  } catch (error) {
    console.error("Error serving public object", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve uploaded objects through ACL-checked proxy (Supabase bucket stays
 * private). Public ACL objects (e.g. partner/vendor logos) are readable
 * without a session so the sign-in page can show the last org brand after
 * logout.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const session = getSessionFromRequest(req);
    const userId = session?.userId ? String(session.userId) : undefined;

    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const obj = await objectStorageService.getStoredObject(objectPath);

    const aclAccess = await objectStorageService.canAccessStoredObject({
      userId,
      object: obj,
      requestedPermission: ObjectPermission.READ,
    });
    const canAccess = aclAccess || await canReadVisitEvidence(session, objectPath) ||
      await canReadTicketAttachment(session, objectPath, obj.acl?.owner);
    if (!canAccess) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const isPublic = obj.acl?.visibility === "public";
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader(
      "Cache-Control",
      `${isPublic ? "public" : "private"}, max-age=3600`,
    );
    res.setHeader("Content-Length", String(obj.size));
    res.send(obj.body);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export { UPLOAD_ROUTE };
export default router;
