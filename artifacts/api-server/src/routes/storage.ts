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

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * PUT /storage/upload/:id
 *
 * Receives raw upload bytes from the browser. The upload id is an unguessable
 * UUID issued by request-url; no session required (same security model as a
 * presigned URL). Onboarding field employees use this before they have login.
 */
router.put(
  "/storage/upload/:id",
  express.raw({ type: "*/*", limit: "25mb" }),
  async (req: Request, res: Response) => {
    const uploadId = String(req.params.id ?? "").trim();
    if (!uploadId || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
      res.status(400).json({ error: "Invalid upload id" });
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
      },
    );
    res.json({ objectPath });
  } catch (error) {
    console.error("Error finalizing upload ACL", error);
    res.status(500).json({ error: "Failed to finalize upload" });
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
 * Serve private objects through ACL-checked proxy (Supabase bucket stays private).
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session || !session.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const obj = await objectStorageService.getStoredObject(objectPath);

    const canAccess = await objectStorageService.canAccessStoredObject({
      userId: String(session.userId),
      object: obj,
      requestedPermission: ObjectPermission.READ,
    });
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
