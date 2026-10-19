import { asc, desc, eq, gt, and } from "drizzle-orm";
import { workTypesTable, serviceMappingsTable } from "@workspace/db/schema";
import { classifyServiceSubject, recordClassification } from "./index";
import { subjectFingerprint } from "./candidates";
import type { ServiceSubjectInput, StoredServiceMapping } from "./types";
import { logger } from "../../lib/logger";

type CatalogSubject = ServiceSubjectInput & { subjectType: "partner_work_type" };
export interface CatalogClassificationStore {
  load(id: number): Promise<{ subject: CatalogSubject; latest: StoredServiceMapping | null } | null>;
  page(afterId: number, limit: number): Promise<number[]>;
}

export function createCatalogClassificationStore(): CatalogClassificationStore {
  return {
    async load(id) {
      const { db } = await import("@workspace/db");
      const [row] = await db.select().from(workTypesTable).where(eq(workTypesTable.id, id));
      if (!row) return null;
      const [latest] = await db.select().from(serviceMappingsTable).where(and(
        eq(serviceMappingsTable.subjectType, "partner_work_type"), eq(serviceMappingsTable.subjectId, id),
      )).orderBy(desc(serviceMappingsTable.mappingVersion)).limit(1);
      return { subject: { subjectType: "partner_work_type", subjectId: id, name: row.name, description: row.description, category: row.category }, latest: latest ?? null };
    },
    async page(afterId, limit) {
      const { db } = await import("@workspace/db");
      return (await db.select({ id: workTypesTable.id }).from(workTypesTable)
        .where(gt(workTypesTable.id, afterId)).orderBy(asc(workTypesTable.id)).limit(limit)).map(row => row.id);
    },
  };
}

/** Saved catalog rows are the durable outbox: missing/stale decisions are retried
 * after provider failure or process restart. A review/rejection for the current
 * fingerprint is terminal; automation never overrides that human boundary. */
export function createCatalogClassificationRunner(
  store: CatalogClassificationStore,
  matching = { classifyServiceSubject, recordClassification },
) {
  return async (id: number) => {
    try {
      const saved = await store.load(id);
      if (!saved) return "missing" as const;
      const metadata = saved.latest?.evidence.serviceMatching as Record<string, unknown> | undefined;
      if (saved.latest && ["active", "review_required", "rejected"].includes(saved.latest.status)
          && metadata?.subjectFingerprint === subjectFingerprint(saved.subject)) return "current" as const;
      const classification = await matching.classifyServiceSubject(saved.subject);
      const result = await matching.recordClassification({ subject: saved.subject, classification, actorProcess: "catalog-classification-retry" });
      return result.status;
    } catch (err) {
      // The catalog mutation remains durable and fail-closed; the next scan
      // retries exactly this saved subject. Never fabricate an active match.
      logger.warn({ err, workTypeId: id }, "Catalog classification pending retry");
      return "pending" as const;
    }
  };
}

const store = createCatalogClassificationStore();
const run = createCatalogClassificationRunner(store);
export async function classifySavedWorkType(id: number) {
  if (process.env.SEMANTIC_SERVICE_MARKETPLACE_ENABLED !== "true") return;
  return run(id);
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let cursor = 0;
export function startCatalogClassificationWorker() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const ids = await store.page(cursor, 100);
      for (const id of ids) await run(id);
      cursor = ids.length === 100 ? ids[ids.length - 1] : 0;
    } catch (err) {
      logger.warn({ err }, "Catalog classification scan failed; will retry");
    } finally { running = false; }
  };
  timer = setInterval(() => void tick(), 60000);
  timer.unref();
  void tick();
}
export function stopCatalogClassificationWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
