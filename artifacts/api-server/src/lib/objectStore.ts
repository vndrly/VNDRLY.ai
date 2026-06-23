import fsp from "node:fs/promises";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import type { ObjectAclPolicy } from "./objectAcl";
import {
  localGetObject,
  localPutObject,
  localSetAclPolicy,
  localWriteUpload,
} from "./localObjectStorage";

/**
 * Backend-agnostic object storage. Two implementations:
 *
 *  - SupabaseObjectStore  → durable, used in every environment once
 *    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. Files + their ACL
 *    sidecar live in a single private Supabase Storage bucket.
 *  - FilesystemObjectStore → zero-config local dev fallback when the
 *    service key isn't set; persists under .local/object-storage.
 *
 * The client upload flow is unchanged: POST request-url → PUT the bytes to
 * the returned URL → POST finalize. Uploads always PUT to OUR API
 * (`/api/storage/upload/:id`), which writes through to the active backend —
 * so there's no browser↔Supabase coupling or CORS to manage.
 */

/** Our own proxy endpoint the client PUTs raw bytes to. */
export const UPLOAD_ROUTE = "/api/storage/upload";
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

export interface StoredObject {
  contentType: string;
  size: number;
  acl: ObjectAclPolicy | null;
  body: Buffer;
}

export interface ObjectStore {
  readonly kind: "supabase" | "filesystem";
  /** Issue an upload URL (our proxy) + the canonical /objects path. */
  getUploadDescriptor(): { uploadURL: string; objectPath: string };
  /** Validate a signed upload URL before accepting raw bytes. */
  validateUploadURL(uploadId: string, expires: string | undefined, signature: string | undefined): boolean;
  /** Persist uploaded bytes for an `upload/:id` PUT. */
  putUpload(uploadId: string, contentType: string, body: Buffer): Promise<void>;
  /** Map the upload URL echoed at finalize-time back to the object path. */
  uploadUrlToObjectPath(uploadURL: string): string;
  /** Stamp owner/visibility onto the object; returns the object path. */
  setAcl(objectPath: string, acl: ObjectAclPolicy): Promise<string>;
  /** Fetch an object by `/objects/...` path, or null if absent. */
  getObject(objectPath: string): Promise<StoredObject | null>;
  /** Fetch a public branding asset (no auth). Key is relative to `public/`. */
  getPublicObject(relativePath: string): Promise<StoredObject | null>;
  /** Write a public branding asset; returns the API path clients store in DB. */
  putPublicObject(
    relativePath: string,
    contentType: string,
    body: Buffer,
  ): Promise<string>;
  /** Write bytes + ACL at an arbitrary `/objects/...` path (deterministic
   *  keys for seeds, not upload ids). */
  putObject(
    objectPath: string,
    contentType: string,
    body: Buffer,
    acl: ObjectAclPolicy,
  ): Promise<void>;
}

// ── Shared path helpers ───────────────────────────────────────────────

function uploadIdToObjectPath(uploadId: string): string {
  return `/objects/uploads/${uploadId}`;
}

function uploadSigningSecret(): string {
  const secret = process.env.UPLOAD_URL_SECRET || process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("UPLOAD_URL_SECRET or SESSION_SECRET is required for signed uploads");
  }
  return "dev-upload-url-secret";
}

function signUploadURL(uploadId: string, expires: number): string {
  return createHmac("sha256", uploadSigningSecret())
    .update(`${uploadId}.${expires}`)
    .digest("hex");
}

function signedUploadURL(uploadId: string): string {
  const expires = Date.now() + UPLOAD_URL_TTL_MS;
  const signature = signUploadURL(uploadId, expires);
  return `${UPLOAD_ROUTE}/${uploadId}?expires=${expires}&signature=${signature}`;
}

function validateSignedUploadURL(
  uploadId: string,
  expiresRaw: string | undefined,
  signature: string | undefined,
): boolean {
  if (!expiresRaw || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = signUploadURL(uploadId, expires);
  try {
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function uploadUrlToObjectPathShared(uploadURL: string): string {
  const noQuery = uploadURL.split("?")[0];
  const id = noQuery.split("/").filter(Boolean).pop() ?? "";
  return `/objects/uploads/${id}`;
}

function objectPathToKey(objectPath: string): string | null {
  if (!objectPath.startsWith("/objects/")) return null;
  return objectPath.slice("/objects/".length);
}

const PUBLIC_PREFIX = "public/";

function publicKey(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `${PUBLIC_PREFIX}${clean}`;
}

function publicApiPath(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `/api/storage/public-objects/${clean}`;
}

// ── Supabase Storage backend ──────────────────────────────────────────

class SupabaseObjectStore implements ObjectStore {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;
  private bucket: string;
  private bucketReady: Promise<void> | null = null;

  constructor(url: string, serviceKey: string, bucket: string) {
    // Node < 22 has no native WebSocket; @supabase/realtime-js throws on
    // createClient without an explicit transport (breaks storage uploads on
    // local dev where the API runs on Node 20 LTS).
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws as unknown as typeof WebSocket },
    });
    this.bucket = bucket;
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const { data } = await this.client.storage.getBucket(this.bucket);
        if (!data) {
          // Private bucket: reads always flow through our ACL-checked route.
          await this.client.storage.createBucket(this.bucket, {
            public: false,
          });
        }
      })().catch((err) => {
        // Reset so a transient failure can be retried on the next call.
        this.bucketReady = null;
        throw err;
      });
    }
    return this.bucketReady;
  }

  getUploadDescriptor(): { uploadURL: string; objectPath: string } {
    const id = randomUUID();
    return {
      uploadURL: signedUploadURL(id),
      objectPath: uploadIdToObjectPath(id),
    };
  }

  validateUploadURL(uploadId: string, expires: string | undefined, signature: string | undefined): boolean {
    return validateSignedUploadURL(uploadId, expires, signature);
  }

  uploadUrlToObjectPath(uploadURL: string): string {
    return uploadUrlToObjectPathShared(uploadURL);
  }

  async putUpload(
    uploadId: string,
    contentType: string,
    body: Buffer,
  ): Promise<void> {
    await this.ensureBucket();
    const key = `uploads/${uploadId}`;
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, body, {
        contentType: contentType || "application/octet-stream",
        upsert: true,
      });
    if (error) throw error;
  }

  async setAcl(objectPath: string, acl: ObjectAclPolicy): Promise<string> {
    await this.ensureBucket();
    const key = objectPathToKey(objectPath);
    if (!key) return objectPath;
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(`${key}.acl.json`, Buffer.from(JSON.stringify(acl), "utf8"), {
        contentType: "application/json",
        upsert: true,
      });
    if (error) throw error;
    return objectPath;
  }

  async putObject(
    objectPath: string,
    contentType: string,
    body: Buffer,
    acl: ObjectAclPolicy,
  ): Promise<void> {
    await this.ensureBucket();
    const key = objectPathToKey(objectPath);
    if (!key) throw new Error("Invalid object path");
    const fileRes = await this.client.storage
      .from(this.bucket)
      .upload(key, body, {
        contentType: contentType || "application/octet-stream",
        upsert: true,
      });
    if (fileRes.error) throw fileRes.error;
    const aclRes = await this.client.storage
      .from(this.bucket)
      .upload(`${key}.acl.json`, Buffer.from(JSON.stringify(acl), "utf8"), {
        contentType: "application/json",
        upsert: true,
      });
    if (aclRes.error) throw aclRes.error;
  }

  async getObject(objectPath: string): Promise<StoredObject | null> {
    await this.ensureBucket();
    const key = objectPathToKey(objectPath);
    if (!key) return null;

    const { data: fileBlob, error: fileErr } = await this.client.storage
      .from(this.bucket)
      .download(key);
    if (fileErr || !fileBlob) return null;

    let acl: ObjectAclPolicy | null = null;
    const { data: aclBlob } = await this.client.storage
      .from(this.bucket)
      .download(`${key}.acl.json`);
    if (aclBlob) {
      try {
        acl = JSON.parse(await aclBlob.text()) as ObjectAclPolicy;
      } catch {
        acl = null;
      }
    }

    const body = Buffer.from(await fileBlob.arrayBuffer());
    return {
      contentType: fileBlob.type || "application/octet-stream",
      size: body.length,
      acl,
      body,
    };
  }

  async getPublicObject(relativePath: string): Promise<StoredObject | null> {
    await this.ensureBucket();
    const key = publicKey(relativePath);
    const { data: fileBlob, error } = await this.client.storage
      .from(this.bucket)
      .download(key);
    if (error || !fileBlob) return null;
    const body = Buffer.from(await fileBlob.arrayBuffer());
    return {
      contentType: fileBlob.type || "application/octet-stream",
      size: body.length,
      acl: { owner: "system", visibility: "public" },
      body,
    };
  }

  async putPublicObject(
    relativePath: string,
    contentType: string,
    body: Buffer,
  ): Promise<string> {
    await this.ensureBucket();
    const key = publicKey(relativePath);
    const { error } = await this.client.storage.from(this.bucket).upload(key, body, {
      contentType: contentType || "application/octet-stream",
      upsert: true,
    });
    if (error) throw error;
    return publicApiPath(relativePath);
  }
}

// ── Filesystem backend (local-dev fallback) ───────────────────────────

class FilesystemObjectStore implements ObjectStore {
  readonly kind = "filesystem" as const;

  getUploadDescriptor(): { uploadURL: string; objectPath: string } {
    const id = randomUUID();
    return {
      uploadURL: signedUploadURL(id),
      objectPath: uploadIdToObjectPath(id),
    };
  }

  validateUploadURL(uploadId: string, expires: string | undefined, signature: string | undefined): boolean {
    return validateSignedUploadURL(uploadId, expires, signature);
  }

  uploadUrlToObjectPath(uploadURL: string): string {
    return uploadUrlToObjectPathShared(uploadURL);
  }

  async putUpload(
    uploadId: string,
    contentType: string,
    body: Buffer,
  ): Promise<void> {
    await localWriteUpload(uploadId, contentType, body);
  }

  async setAcl(objectPath: string, acl: ObjectAclPolicy): Promise<string> {
    return localSetAclPolicy(objectPath, acl);
  }

  async putObject(
    objectPath: string,
    contentType: string,
    body: Buffer,
    acl: ObjectAclPolicy,
  ): Promise<void> {
    await localPutObject(objectPath, contentType, body, acl);
  }

  async getObject(objectPath: string): Promise<StoredObject | null> {
    const obj = await localGetObject(objectPath);
    if (!obj) return null;
    const body = await fsp.readFile(obj.filePath);
    return {
      contentType: obj.contentType,
      size: obj.size,
      acl: obj.acl,
      body,
    };
  }

  async getPublicObject(relativePath: string): Promise<StoredObject | null> {
    const objectPath = `/objects/${publicKey(relativePath)}`;
    return this.getObject(objectPath);
  }

  async putPublicObject(
    relativePath: string,
    contentType: string,
    body: Buffer,
  ): Promise<string> {
    const objectPath = `/objects/${publicKey(relativePath)}`;
    await localPutObject(objectPath, contentType, body, {
      owner: "system",
      visibility: "public",
    });
    return publicApiPath(relativePath);
  }
}

// ── Factory (singleton) ───────────────────────────────────────────────

let store: ObjectStore | null = null;

export function getObjectStore(): ObjectStore {
  if (store) return store;
  const url = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "vndrly-objects";

  if (url && serviceKey) {
    store = new SupabaseObjectStore(url, serviceKey, bucket);
  } else {
    store = new FilesystemObjectStore();
  }
  return store;
}
