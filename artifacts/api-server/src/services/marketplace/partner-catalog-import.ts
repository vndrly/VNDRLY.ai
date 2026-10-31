import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { MarketplaceError } from "./vendor-store";

export const catalogImportInput = z.object({
  fileName: z.string().trim().min(1).max(240).regex(/\.csv$/i),
  sourceBase64: z.string().min(1).max(1400000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mode: z.enum(["preview", "import"]),
}).strict();
export type CatalogSourceRow = { row: number; code: string; name: string; category: string; description: string; unit: string; original: Record<string, string> };
export type CatalogImportRow = CatalogSourceRow & { outcome: "new" | "duplicate" | "conflict" | "created"; workTypeId?: number; reason?: string };
export type CatalogImportReport = { sourceHash: string; fileName: string; rows: CatalogImportRow[]; created: number; duplicates: number; conflicts: number; replayed?: boolean; importId?: number };
type Existing = { id: number; name: string; category: string; description: string | null };
const normalized = (value: string) => value.trim().toLowerCase();

/** RFC-style CSV reader: preserves quoted commas, escaped quotes and multiline source cells. */
export function parsePartnerCatalog(sourceBase64: string): { hash: string; rows: CatalogSourceRow[] } {
  const bytes = Buffer.from(sourceBase64, "base64");
  if (!bytes.length || bytes.length > 1024 * 1024 || bytes.toString("base64") !== sourceBase64)
    throw new MarketplaceError(400, "catalog.invalid_source");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new MarketplaceError(400, "catalog.utf8_required"); }
  if (source.includes("\0")) throw new MarketplaceError(400, "catalog.invalid_source");
  const records: string[][] = []; let record: string[] = [], cell = "", quoted = false, closed = false;
  const endCell = () => { record.push(cell); cell = ""; closed = false; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell.length || closed) throw new MarketplaceError(400, "catalog.invalid_csv");
      quoted = true;
    } else if (char === ',') endCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      endCell(); records.push(record); record = [];
    } else {
      if (closed) throw new MarketplaceError(400, "catalog.invalid_csv");
      cell += char;
    }
  }
  if (quoted) throw new MarketplaceError(400, "catalog.invalid_csv");
  if (cell.length || record.length || closed) { endCell(); records.push(record); }
  const headers = records.shift()?.map(normalized) ?? [];
  if (!headers.includes("name") || headers.some(header => !header) || new Set(headers).size !== headers.length)
    throw new MarketplaceError(400, "catalog.headers_required");
  if (records.length > 5000) throw new MarketplaceError(400, "catalog.too_many_rows");
  const rows: CatalogSourceRow[] = [];
  records.forEach((cells, index) => {
    if (cells.every(cell => !cell.trim())) return;
    if (cells.length !== headers.length) throw new MarketplaceError(400, "catalog.invalid_columns");
    const original = Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
    const name = original.name.trim();
    if (!name || name.length > 500 || cells.some(cell => cell.length > 10000)) throw new MarketplaceError(400, "catalog.invalid_row");
    rows.push({ row: index + 2, code: (original.code ?? "").trim(), name, category: (original.category ?? "").trim() || "Uncategorized",
      description: (original.description ?? "").trim(), unit: (original.unit ?? "").trim(), original });
  });
  if (!rows.length) throw new MarketplaceError(400, "catalog.empty");
  return { hash: createHash("sha256").update(bytes).digest("hex"), rows };
}

/** Same name is not enough to merge different service scope. Existing records are never overwritten. */
export function planPartnerCatalog(rows: CatalogSourceRow[], existing: Existing[]): CatalogImportRow[] {
  const names = new Map(existing.map(row => [normalized(row.name), { ...row, unit: null as string | null, code: null as string | null }]));
  return rows.map(row => {
    const prior = names.get(normalized(row.name));
    if (prior) {
      const equivalent = normalized(prior.category) === normalized(row.category) && (prior.description ?? "").trim() === row.description &&
        (!row.unit || prior.unit === row.unit) && (!row.code || prior.code === row.code);
      return { ...row, outcome: equivalent ? "duplicate" : "conflict", ...(prior.id ? { workTypeId: prior.id } : {}),
        reason: equivalent ? "Same normalized name and supplied scope; no change" : "Name already exists with different or unverified scope/code/unit; review required" };
    }
    names.set(normalized(row.name), { id: 0, name: row.name, category: row.category, description: row.description, unit: row.unit, code: row.code });
    return { ...row, outcome: "new" };
  });
}

export async function importPartnerCatalog(partnerId: number, actorId: number, actorRole: string, input: z.infer<typeof catalogImportInput>): Promise<CatalogImportReport> {
  const parsed = parsePartnerCatalog(input.sourceBase64);
  const { db, workTypesTable: workTypes, assistantActionAuditTable: audit } = await import("@workspace/db");
  const result = await db.transaction(async tx => {
    // Serializes this importer without mutating existing catalog selections or billing references.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`partner-catalog-import:${partnerId}`}, 0))`);
    const [previous] = await tx.select({ id: audit.id, output: audit.toolOutput }).from(audit).where(and(
      eq(audit.partnerId, partnerId), eq(audit.targetType, "partner-catalog-import"), eq(audit.targetId, parsed.hash), eq(audit.resultStatus, "completed"))).limit(1);
    if (previous) return { ...(previous.output as CatalogImportReport), importId: previous.id, replayed: true };
    const existing = await tx.select({ id: workTypes.id, name: workTypes.name, category: workTypes.category, description: workTypes.description }).from(workTypes).where(eq(workTypes.partnerId, partnerId));
    const rows = planPartnerCatalog(parsed.rows, existing);
    if (input.mode === "import") {
      for (const row of rows.filter(row => row.outcome === "new")) {
        const [created] = await tx.insert(workTypes).values({ partnerId, name: row.name, category: row.category, description: row.description || null }).onConflictDoNothing().returning({ id: workTypes.id });
        if (created) { row.outcome = "created"; row.workTypeId = created.id; }
        else { row.outcome = "conflict"; row.reason = "Catalog changed after preview; existing record preserved"; }
      }
    }
    const linkedIds = new Map(rows.filter(row => row.workTypeId).map(row => [normalized(row.name), row.workTypeId!]));
    for (const row of rows) if (row.outcome === "duplicate" && !row.workTypeId) {
      row.workTypeId = linkedIds.get(normalized(row.name));
      if (input.mode === "import" && !row.workTypeId) { row.outcome = "conflict"; row.reason = "Matching source row could not be linked safely; existing records preserved"; }
    }
    const report: CatalogImportReport = { sourceHash: parsed.hash, fileName: input.fileName, rows,
      created: rows.filter(row => row.outcome === "created").length, duplicates: rows.filter(row => row.outcome === "duplicate").length, conflicts: rows.filter(row => row.outcome === "conflict").length };
    if (input.mode === "import") {
      // Original bytes, all source cells/codes, and source-row → work-type IDs are retained in the same transaction as new records.
      const [saved] = await tx.insert(audit).values({ userId: actorId, actorRole, partnerId, clientSurface: "partner-catalog", inputMode: "file",
        provider: "canonical", toolName: "partner_catalog_import", actionType: "catalog-import", targetType: "partner-catalog-import", targetId: parsed.hash,
        toolInput: { fileName: input.fileName, sourceBase64: input.sourceBase64, sourceHash: parsed.hash, encoding: "utf-8" }, toolOutput: report, resultStatus: "completed" }).returning({ id: audit.id });
      report.importId = saved.id;
    }
    return report;
  });
  // Saved work types are the existing classification worker's durable outbox. Never fabricate an active service mapping.
  if (input.mode === "import" && !result.replayed) {
    const { classifySavedWorkType } = await import("../service-matching/catalog-classification");
    for (const row of result.rows.filter(row => row.outcome === "created")) await classifySavedWorkType(row.workTypeId!);
  }
  return result;
}
