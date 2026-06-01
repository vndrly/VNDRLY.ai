/**
 * Backfill ACL policies on private object-storage entities that were uploaded
 * before the upload flow learned to call /api/storage/uploads/finalize.
 *
 * Usage: pnpm --filter @workspace/scripts run backfill:object-acls
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getObjectStore } from "../../artifacts/api-server/src/lib/objectStore.js";

function toObjectPath(stored: string): string | null {
  const idx = stored.indexOf("/api/storage/objects/");
  if (idx === -1) return null;
  const objectPath = stored.slice(idx + "/api/storage".length);
  if (!objectPath.startsWith("/objects/")) return null;
  return objectPath;
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
  const objectPath = toObjectPath(stored);
  if (!objectPath) return;
  const store = getObjectStore();
  try {
    const obj = await store.getObject(objectPath);
    if (!obj) {
      counts.missing += 1;
      console.warn(`  - missing: ${objectPath}`);
      return;
    }
    if (obj.acl) {
      counts.already += 1;
      return;
    }
    await store.setAcl(objectPath, {
      owner: "system-backfill",
      visibility: "public",
    });
    counts.ok += 1;
    console.log(`  + stamped ${objectPath}`);
  } catch (err) {
    counts.failed += 1;
    console.error(`  ! ${objectPath}:`, err instanceof Error ? err.message : err);
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
