/**
 * Backfill ACL policies on private object-storage entities that were uploaded
 * before the upload flow learned to call /api/storage/uploads/finalize.
 *
 * Without an ACL, GET /api/storage/objects/* returns 403, so every
 * vendor / partner logo, employee photo, comment attachment, and
 * certification document uploaded prior to the fix appears as a broken
 * image in the UI.
 *
 * This walks every column that may reference a private object, locates the
 * underlying file in GCS, and stamps it with `{visibility: "public"}` if
 * it currently has no ACL.
 *
 * Usage: pnpm --filter @workspace/scripts run backfill:object-acls
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateDir(): string {
  const d = process.env.PRIVATE_OBJECT_DIR;
  if (!d) throw new Error("PRIVATE_OBJECT_DIR not set");
  return d.endsWith("/") ? d : `${d}/`;
}

function parsePath(path: string): { bucketName: string; objectName: string } {
  const p = path.startsWith("/") ? path : `/${path}`;
  const parts = p.split("/");
  if (parts.length < 3) throw new Error(`Invalid path: ${path}`);
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function toBucketObject(stored: string): { bucketName: string; objectName: string } | null {
  const idx = stored.indexOf("/api/storage/objects/");
  if (idx === -1) return null;
  const objectPath = stored.slice(idx + "/api/storage".length);
  if (!objectPath.startsWith("/objects/")) return null;
  const entityId = objectPath.slice("/objects/".length);
  return parsePath(`${privateDir()}${entityId}`);
}

interface Source {
  table: string;
  column: string;
  unnest?: boolean;
}

const SOURCES: Source[] = [
  { table: "vendors", column: "logo_url" },
  { table: "partners", column: "logo_url" },
  { table: "vendor_people", column: "photo_url" },
  { table: "partner_contacts", column: "photo_url" },
  { table: "employee_certifications", column: "document_url" },
  { table: "hotlist_comments", column: "attachments", unnest: true },
  { table: "ticket_note_logs", column: "attachments", unnest: true },
];

async function processOne(
  stored: string,
  counts: { ok: number; already: number; missing: number; failed: number },
) {
  const ref = toBucketObject(stored);
  if (!ref) return;
  const file = storage.bucket(ref.bucketName).file(ref.objectName);
  try {
    const [exists] = await file.exists();
    if (!exists) {
      counts.missing += 1;
      console.warn(`  - missing: ${ref.objectName}`);
      return;
    }
    const [meta] = await file.getMetadata();
    const existing = meta?.metadata?.[ACL_POLICY_METADATA_KEY];
    if (existing) {
      counts.already += 1;
      return;
    }
    await file.setMetadata({
      metadata: {
        [ACL_POLICY_METADATA_KEY]: JSON.stringify({
          owner: "system-backfill",
          visibility: "public",
        }),
      },
    });
    counts.ok += 1;
    console.log(`  + stamped ${ref.objectName}`);
  } catch (err) {
    counts.failed += 1;
    console.error(`  ! ${ref.objectName}:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const counts = { ok: 0, already: 0, missing: 0, failed: 0 };

  for (const src of SOURCES) {
    console.log(`\n>>> ${src.table}.${src.column}${src.unnest ? " (array)" : ""}`);
    const rows = src.unnest
      ? await db.execute(
          sql.raw(
            `SELECT unnest(${src.column}) AS v FROM ${src.table} WHERE ${src.column} IS NOT NULL AND array_length(${src.column}, 1) > 0`,
          ),
        )
      : await db.execute(
          sql.raw(
            `SELECT ${src.column} AS v FROM ${src.table} WHERE ${src.column} IS NOT NULL AND ${src.column} <> ''`,
          ),
        );

    const values = (rows as unknown as { rows: Array<{ v: string }> }).rows;
    for (const r of values) {
      if (typeof r.v === "string" && r.v) {
        await processOne(r.v, counts);
      }
    }
  }

  console.log("\n=== Backfill complete ===");
  console.log(`  stamped:    ${counts.ok}`);
  console.log(`  already ok: ${counts.already}`);
  console.log(`  missing:    ${counts.missing}`);
  console.log(`  failed:     ${counts.failed}`);
  process.exit(counts.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Backfill crashed:", err);
  process.exit(1);
});
