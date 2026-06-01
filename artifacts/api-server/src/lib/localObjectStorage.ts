import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ObjectAclPolicy } from "./objectAcl";

/**
 * Filesystem primitives for the zero-config local-dev storage backend
 * (see objectStore.ts `FilesystemObjectStore`). Used when no Supabase
 * service key is configured. Nothing here touches Replit.
 *
 * Files persist under `.local/object-storage/` (git-ignored), with each
 * object's owner/visibility ACL stored in a `<file>.meta.json` sidecar.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function baseDir(): string {
  if (process.env.LOCAL_OBJECT_DIR) return process.env.LOCAL_OBJECT_DIR;
  return path.join(findRepoRoot(process.cwd()), ".local", "object-storage");
}

/** Resolve an `entityId` (e.g. `uploads/<uuid>`) to an absolute on-disk path,
 *  guarding against path traversal escaping the storage root. */
function resolveEntityFile(entityId: string): string {
  const root = baseDir();
  const clean = entityId.replace(/^\/+/, "");
  const full = path.resolve(root, clean);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error("Invalid object path");
  }
  return full;
}

interface LocalMeta {
  contentType: string;
  size?: number;
  acl?: ObjectAclPolicy;
}

function metaFile(file: string): string {
  return `${file}.meta.json`;
}

async function readMeta(file: string): Promise<LocalMeta | null> {
  try {
    const raw = await fsp.readFile(metaFile(file), "utf8");
    return JSON.parse(raw) as LocalMeta;
  } catch {
    return null;
  }
}

async function writeMeta(file: string, meta: LocalMeta): Promise<void> {
  await fsp.writeFile(metaFile(file), JSON.stringify(meta), "utf8");
}

function objectPathToEntityId(objectPath: string): string | null {
  if (!objectPath.startsWith("/objects/")) return null;
  return objectPath.slice("/objects/".length);
}

/** Persist uploaded bytes for an `upload/:id` PUT. */
export async function localWriteUpload(
  uploadId: string,
  contentType: string,
  body: Buffer,
): Promise<void> {
  const entityId = `uploads/${path.basename(uploadId)}`;
  const file = resolveEntityFile(entityId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, body);
  await writeMeta(file, {
    contentType: contentType || "application/octet-stream",
    size: body.length,
  });
}

/** Write an object at an arbitrary `/objects/...` path with its ACL in one
 *  shot (used by seeds, which need deterministic keys rather than upload ids). */
export async function localPutObject(
  objectPath: string,
  contentType: string,
  body: Buffer,
  acl: ObjectAclPolicy,
): Promise<void> {
  const entityId = objectPathToEntityId(objectPath);
  if (!entityId) throw new Error("Invalid object path");
  const file = resolveEntityFile(entityId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, body);
  await writeMeta(file, {
    contentType: contentType || "application/octet-stream",
    size: body.length,
    acl,
  });
}

/** Stamp owner/visibility onto the object's sidecar metadata. */
export async function localSetAclPolicy(
  objectPath: string,
  acl: ObjectAclPolicy,
): Promise<string> {
  const entityId = objectPathToEntityId(objectPath);
  if (!entityId) return objectPath;
  const file = resolveEntityFile(entityId);
  if (!fs.existsSync(file)) {
    throw new Error(`Object not found: ${entityId}`);
  }
  const meta = (await readMeta(file)) ?? {
    contentType: "application/octet-stream",
  };
  meta.acl = acl;
  await writeMeta(file, meta);
  return objectPath;
}

export interface LocalObject {
  filePath: string;
  contentType: string;
  size: number;
  acl: ObjectAclPolicy | null;
}

/** Locate a stored object by its `/objects/...` path. Returns null if absent. */
export async function localGetObject(
  objectPath: string,
): Promise<LocalObject | null> {
  const entityId = objectPathToEntityId(objectPath);
  if (!entityId) return null;
  const file = resolveEntityFile(entityId);
  if (!fs.existsSync(file)) return null;
  const meta = await readMeta(file);
  const stat = await fsp.stat(file);
  return {
    filePath: file,
    contentType: meta?.contentType ?? "application/octet-stream",
    size: stat.size,
    acl: meta?.acl ?? null,
  };
}
