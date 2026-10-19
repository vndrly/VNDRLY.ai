import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { canonicalServicesTable, serviceMappingsTable, vendorCapabilitiesTable, workTypesTable } from "@workspace/db/schema";
import { subjectFingerprint, validateSubject } from "./candidates";
import { validateClassification } from "./classifier";
import type { CurrentServiceMapping, MappingRepository, RecordedClassificationInput, StoredServiceMapping } from "./types";

type Database = typeof import("@workspace/db").db;

export function createPostgresMappingRepository(database?: Database): MappingRepository {
  return {
    async withSubjectLock(subject, run) {
      const db = database ?? (await import("@workspace/db")).db;
      return db.transaction(async (tx) => {
        // A row lock alone cannot protect the first classification, which has no
        // mapping row yet. Every writer must acquire this subject-scoped lock.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`service-mapping:${subject.subjectType}:${subject.subjectId}`}, 0))`);
        const scoped = and(eq(serviceMappingsTable.subjectType, subject.subjectType), eq(serviceMappingsTable.subjectId, subject.subjectId));
        return run({
          async loadSubject() {
            if (subject.subjectType === "partner_work_type") {
              const [row] = await tx.select().from(workTypesTable).where(eq(workTypesTable.id, subject.subjectId)).for("update");
              return row ? { subjectType: subject.subjectType, subjectId: row.id, name: row.name, description: row.description, category: row.category, active: true } : null;
            }
            const [row] = await tx.select().from(vendorCapabilitiesTable).where(eq(vendorCapabilitiesTable.id, subject.subjectId)).for("update");
            return row ? { subjectType: subject.subjectType, subjectId: row.id, name: row.name, description: row.description, active: row.active } : null;
          },
          async listMappings() { return tx.select().from(serviceMappingsTable).where(scoped).for("update"); },
          async isCanonicalServiceActive(id) {
            const [row] = await tx.select({ active: canonicalServicesTable.active }).from(canonicalServicesTable).where(eq(canonicalServicesTable.id, id)).for("share");
            return row?.active === true;
          },
          async supersede(id, at) {
            await tx.update(serviceMappingsTable).set({ status: "superseded", supersededAt: at }).where(and(scoped, eq(serviceMappingsTable.id, id), eq(serviceMappingsTable.status, "active")));
          },
          async insert(row) { const [saved] = await tx.insert(serviceMappingsTable).values(row).returning(); return saved; },
        });
      });
    },
  };
}

function metadata(row: StoredServiceMapping): Record<string, unknown> {
  const value = row.evidence.serviceMatching;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function createClassificationRecorder(repository: MappingRepository, activationThreshold: number) {
  return async (input: RecordedClassificationInput): Promise<CurrentServiceMapping> => {
    validateSubject(input.subject);
    if (!input.actorProcess?.trim()) throw new Error("Classification requires process identity");
    const value = input.classification;
    if (value.outcome !== "pending") validateClassification(value);
    return repository.withSubjectLock(input.subject, async (tx) => {
      const rows = await tx.listMappings();
      const current = rows.find((r) => r.status === "active" && r.supersededAt === null) ?? null;
      const pending = (): CurrentServiceMapping => ({ status: "pending", mapping: null, currentMapping: current, retryable: true });
      if (value.outcome === "pending") return pending();
      const savedSubject = await tx.loadSubject();
      const fingerprint = subjectFingerprint(input.subject);
      if (!savedSubject?.active || subjectFingerprint(savedSubject) !== fingerprint || value.subjectFingerprint !== fingerprint) return pending();
      // A model+prompt revision defines a classification run. Concurrent model
      // completions for the same run are first-writer-wins, including old retries.
      const runKey = createHash("sha256").update(JSON.stringify([fingerprint, value.modelVersion, activationThreshold])).digest("hex");
      const existing = rows.find((r) => metadata(r).runKey === runKey);
      if (existing) return { status: "recorded", mapping: existing, currentMapping: current, retryable: false };

      const latestVersion = Math.max(0, ...rows.map((r) => r.mappingVersion));
      const concurrentChange = value.observedMappingVersion !== latestVersion;
      const conflict = concurrentChange || (current !== null && (current.canonicalServiceId !== value.canonicalServiceId || current.reviewedAt !== null || current.actorUserId !== null));
      const priorRejection = rows.some((r) => r.status === "rejected" && metadata(r).subjectFingerprint === fingerprint);
      const conceptActive = value.canonicalServiceId !== null && await tx.isCanonicalServiceActive(value.canonicalServiceId);
      const activate = value.outcome === "matched" && value.confidence >= activationThreshold && conceptActive && !conflict && !priorRejection;
      const confidentRejection = value.outcome === "rejected" && value.confidence >= activationThreshold && !conflict;
      const status = activate ? "active" : confidentRejection ? "rejected" : "review_required";
      if (activate && current) await tx.supersede(current.id, new Date());
      const mapping = await tx.insert({
        subjectType: input.subject.subjectType, subjectId: input.subject.subjectId,
        workTypeId: input.subject.subjectType === "partner_work_type" ? input.subject.subjectId : null,
        vendorCapabilityId: input.subject.subjectType === "vendor_capability" ? input.subject.subjectId : null,
        canonicalServiceId: value.canonicalServiceId, status, confidence: String(value.confidence),
        explanation: value.explanation, modelVersion: value.modelVersion,
        evidence: { ...value.evidence, serviceMatching: { runKey, subjectFingerprint: fingerprint, outcome: value.outcome, activationThreshold, conflict, concurrentChange, priorRejection, conceptActive, ...(value.proposedService ? { proposedService: value.proposedService } : {}) } },
        mappingVersion: latestVersion + 1,
        actorUserId: input.actorUserId ?? null, actorProcess: input.actorProcess,
        reviewedAt: null, supersededAt: null,
      });
      return { status: "recorded", mapping, currentMapping: activate ? mapping : current, retryable: false };
    });
  };
}
