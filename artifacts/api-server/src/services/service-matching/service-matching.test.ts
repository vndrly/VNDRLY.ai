import { describe, expect, it } from "vitest";
import { createServiceMatching, createModelServiceClassifier, createPostgresCandidateProvider, normalizeServiceText } from "./index";
import type { MappingRepository, MappingTransaction, RecordedClassificationInput, ServiceCandidate, ServiceClassification, ServiceSubjectInput, StoredServiceMapping } from "./types";
import { PgDialect } from "drizzle-orm/pg-core";

const subject: ServiceSubjectInput = { subjectType: "partner_work_type", subjectId: 11, name: "Gatekeeping", description: "Controlled entry, visitor logging and vehicle verification" };
const gate: ServiceCandidate = { id: 1, code: "gate_perimeter_security", name: "Gate and perimeter security", category: "Security", definition: "Controlled entry, visitor logging and vehicle verification", inclusionGuidance: "Staffed site access", exclusionGuidance: "Equipment repair", aliases: ["Gatekeeping", "Perimeter Security", "Gate Services"] };
const repair: ServiceCandidate = { ...gate, id: 2, code: "gate_equipment_repair", name: "Gate equipment repair", definition: "Repair gate actuators", aliases: ["Gate Repair"] };
const classification = (overrides: Partial<ServiceClassification> = {}): ServiceClassification => ({ outcome: "matched", canonicalServiceId: 1, confidence: 0.98, explanation: "Both cover controlled access and visitor verification", evidence: { source: "operational_scope" }, modelVersion: "fake:v1", subjectFingerprint: "", ...overrides });

// The database boundary is external. This fake preserves transactional rollback and
// subject serialization so tests exercise the actual activation/history policy.
class MemoryRepository implements MappingRepository {
  rows: StoredServiceMapping[] = [];
  savedSubject = { ...subject };
  archived = false;
  private tail: Promise<unknown> = Promise.resolve();
  async withSubjectLock<T>(_subject: ServiceSubjectInput, run: (tx: MappingTransaction) => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const before = structuredClone(this.rows);
      try {
        return await run({
          loadSubject: async () => ({ ...this.savedSubject, active: true }),
          listMappings: async () => structuredClone(this.rows),
          isCanonicalServiceActive: async (id) => [1, 2].includes(id) && !this.archived,
          supersede: async (id, at) => { const row = this.rows.find((r) => r.id === id)!; row.status = "superseded"; row.supersededAt = at; },
          insert: async (row) => { const saved = { ...structuredClone(row), id: this.rows.length + 1, createdAt: new Date() }; this.rows.push(saved); return structuredClone(saved); },
        });
      } catch (error) { this.rows = before; throw error; }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}

function setup(result = classification(), candidates = [gate, repair]) {
  const repository = new MemoryRepository();
  const engine = createServiceMatching({ repository, candidateProvider: { findCandidates: async () => candidates }, classifier: { classify: async () => result }, activationThreshold: 0.9 });
  const classify = () => engine.classifyServiceSubject(subject);
  const record = (value: ServiceClassification, overrides: Partial<RecordedClassificationInput> = {}) => engine.recordClassification({ subject, classification: value, actorProcess: "catalog-classifier", ...overrides });
  return { repository, engine, classify, record };
}

describe("semantic service matching", () => {
  it.each(["Gatekeeping", "Perimeter Security", "Gate Services"])("classifies %s through the replaceable model boundary", async (name) => {
    const classifier = createModelServiceClassifier({ modelVersion: "evaluation:v1", complete: async () => JSON.stringify({ outcome: "matched", canonicalServiceId: 1, confidence: 0.98, explanation: "Controlled site access", evidence: { tasks: ["visitor verification"] } }) });
    const result = await classifier.classify({ ...subject, name }, [gate, repair]);
    expect(result).toMatchObject({ outcome: "matched", canonicalServiceId: 1, modelVersion: "evaluation:v1" });
  });

  it("does not collapse operationally different near names", async () => {
    const classifier = createModelServiceClassifier({ modelVersion: "evaluation:v1", complete: async () => JSON.stringify({ outcome: "rejected", canonicalServiceId: null, confidence: 0.97, explanation: "Gate actuator maintenance is not staffed security", evidence: { excluded: "equipment repair" } }) });
    expect(await classifier.classify({ ...subject, name: "Gate Actuator Repair" }, [gate])).toMatchObject({ outcome: "rejected", canonicalServiceId: null });
  });

  it("retrieves bounded normalized aliases and lexical candidates without SQL interpolation", async () => {
    let queryText = "";
    let parameters: unknown[] = [];
    const provider = createPostgresCandidateProvider(async (query) => { const built = new PgDialect().sqlToQuery(query); queryText = built.sql; parameters = built.params; return { rows: [gate] }; });
    expect(normalizeServiceText("  PERIMETER—Security  ")).toBe("perimeter security");
    expect(await provider.findCandidates({ ...subject, name: "Gate's Security" }, 5)).toEqual([gate]);
    expect(queryText).toContain("plainto_tsquery");
    expect(queryText).toContain("canonical_service_aliases");
    expect(queryText).not.toContain("Gate's Security");
    expect(parameters).toContain(5);
    await expect(provider.findCandidates(subject, 100)).rejects.toThrow();
  });

  it("activates a high confidence existing concept and saves evidence", async () => {
    const { classify, record, repository } = setup();
    const result = await record(await classify());
    expect(result.mapping).toMatchObject({ status: "active", canonicalServiceId: 1, mappingVersion: 1, modelVersion: "fake:v1", confidence: "0.98" });
    expect(repository.rows[0].evidence).toMatchObject({ source: "operational_scope" });
  });

  it("uses a configured inclusive confidence threshold", async () => {
    const { classify, record } = setup(classification({ confidence: 0.9 }));
    expect((await record(await classify())).mapping?.status).toBe("active");
    const low = setup(classification({ confidence: 0.89999 }));
    expect((await low.record(await low.classify())).mapping?.status).toBe("review_required");
  });

  it("sends a conflicting concept to review and preserves the current mapping", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    const result = await record({ ...first, canonicalServiceId: 2, modelVersion: "fake:v2" });
    expect(result.mapping?.status).toBe("review_required");
    expect(result.currentMapping?.id).toBe(1);
    expect(repository.rows[0].status).toBe("active");
  });

  it("preserves a manually reviewed current mapping during an automated rerun", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    repository.rows[0].reviewedAt = new Date(); repository.rows[0].actorUserId = 9;
    const result = await record({ ...first, modelVersion: "fake:v2" });
    expect(result.mapping?.status).toBe("review_required");
    expect(repository.rows[0].status).toBe("active");
  });

  it("records a novel-service proposal with no candidate for review", async () => {
    const { classify, record } = setup(classification({ outcome: "novel", canonicalServiceId: null, proposedService: { name: "Novel service", definition: "New operational scope" } }), []);
    expect((await record(await classify())).mapping).toMatchObject({ status: "review_required", canonicalServiceId: null });
  });

  it("supersedes the old model result without modifying its evidence", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    const priorEvidence = structuredClone(repository.rows[0].evidence);
    await record({ ...await classify(), modelVersion: "fake:v2", explanation: "Updated evaluation", evidence: { updated: true } });
    expect(repository.rows.map((r) => [r.status, r.mappingVersion])).toEqual([["superseded", 1], ["active", 2]]);
    expect(repository.rows[0]).toMatchObject({ evidence: priorEvidence, modelVersion: "fake:v1", explanation: first.explanation });
    expect(repository.rows[0].supersededAt).toBeInstanceOf(Date);
  });

  it("serializes concurrent reruns and returns the same result for duplicates", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    const rerun = { ...await classify(), modelVersion: "fake:v2" };
    const results = await Promise.all(Array.from({ length: 8 }, () => record(rerun)));
    expect(new Set(results.map((r) => r.mapping?.id)).size).toBe(1);
    expect(repository.rows).toHaveLength(2);
    expect(repository.rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("serializes concurrent first classifications when there is no mapping row to lock", async () => {
    const { classify, record, repository } = setup();
    const runs = await Promise.all(Array.from({ length: 8 }, () => classify()));
    const results = await Promise.all(runs.map((run) => record(run)));
    expect(new Set(results.map((r) => r.mapping?.id)).size).toBe(1);
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].status).toBe("active");
  });

  it("does not resurrect superseded history when an old run is retried", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    await record({ ...await classify(), modelVersion: "fake:v2" });
    const retry = await record(first);
    expect(retry.mapping?.status).toBe("superseded");
    expect(retry.currentMapping?.modelVersion).toBe("fake:v2");
    expect(repository.rows).toHaveLength(2);
  });

  it("does not let a delayed old model completion replace a newer active version", async () => {
    const { classify, record, repository } = setup();
    const oldRun = await classify();
    const newRun = { ...await classify(), modelVersion: "fake:v2" };
    await record(newRun);
    const delayed = await record(oldRun);
    expect(delayed.mapping?.status).toBe("review_required");
    expect(delayed.currentMapping?.modelVersion).toBe("fake:v2");
    expect(repository.rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("retains rejected decisions and prevents automatic reactivation", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    repository.rows[0].status = "rejected"; repository.rows[0].reviewedAt = new Date();
    const result = await record({ ...first, modelVersion: "fake:v2" });
    expect(result.mapping?.status).toBe("review_required");
    expect(repository.rows[0].status).toBe("rejected");
    expect(result.currentMapping).toBeNull();
  });

  it("routes a conflicting semantic rejection to review without superseding an active match", async () => {
    const { classify, record, repository } = setup();
    const first = await classify(); await record(first);
    const result = await record({ ...first, outcome: "rejected", canonicalServiceId: null, modelVersion: "fake:v2" });
    expect(result.mapping?.status).toBe("review_required");
    expect(repository.rows[0].status).toBe("active");
  });

  it("sends low-confidence negative classifications to review", async () => {
    const { classify, record } = setup(classification({ outcome: "rejected", canonicalServiceId: null, confidence: 0.3 }));
    expect((await record(await classify())).mapping?.status).toBe("review_required");
  });

  it("stores a confident operational rejection when there is no current conflict", async () => {
    const { classify, record } = setup(classification({ outcome: "rejected", canonicalServiceId: null }));
    expect((await record(await classify())).mapping?.status).toBe("rejected");
  });

  it("returns retryable pending on classifier outage without disturbing current history", async () => {
    const { classify, record, repository } = setup(); await record(await classify());
    const engine = createServiceMatching({ repository, activationThreshold: 0.9, candidateProvider: { findCandidates: async () => [gate] }, classifier: { classify: async () => { throw new Error("Provider secret must not leak"); } } });
    const pending = await engine.classifyServiceSubject(subject);
    expect(pending).toMatchObject({ outcome: "pending", retryable: true });
    expect(JSON.stringify(pending)).not.toContain("secret");
    const result = await engine.recordClassification({ subject, classification: pending, actorProcess: "catalog-classifier" });
    expect(result).toMatchObject({ status: "pending", retryable: true, currentMapping: { id: 1, status: "active" } });
    expect(repository.rows).toHaveLength(1);
  });

  it("blocks archived, fabricated and stale classifications", async () => {
    const { classify, record, repository } = setup(); const result = await classify();
    repository.archived = true;
    expect((await record(result)).mapping?.status).toBe("review_required");
    repository.savedSubject.description = "Completely changed scope";
    expect((await record({ ...result, modelVersion: "fake:v2" })).status).toBe("pending");
    const invalid = setup(classification({ canonicalServiceId: 999 }));
    expect(await invalid.classify()).toMatchObject({ outcome: "pending", retryable: true });
  });

  it.each(["name", "description", "category"] as const)("preserves the active mapping when a meaningful %s edit arrives during classification", async (field) => {
    const repository = new MemoryRepository();
    const original = { ...subject, [field]: "Only pressure > 5000 psi" };
    repository.savedSubject = { ...original };
    let editDuringClassification = false;
    const engine = createServiceMatching({
      repository, activationThreshold: 0.9,
      candidateProvider: { findCandidates: async () => [gate] },
      classifier: { classify: async () => {
        if (editDuringClassification) repository.savedSubject[field] = "Only pressure < 5000 psi";
        return classification({ modelVersion: editDuringClassification ? "fake:v2" : "fake:v1" });
      } },
    });
    await engine.recordClassification({ subject: original, classification: await engine.classifyServiceSubject(original), actorProcess: "catalog-classifier" });
    editDuringClassification = true;
    const stale = await engine.classifyServiceSubject(original);
    const result = await engine.recordClassification({ subject: original, classification: stale, actorProcess: "catalog-classifier" });
    expect(result).toMatchObject({ status: "pending", mapping: null, retryable: true, currentMapping: { id: 1, status: "active", modelVersion: "fake:v1" } });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].status).toBe("active");
  });

  it("cannot activate a match when the provider retrieved no candidates", async () => {
    const { classify, repository } = setup(classification(), []);
    expect(await classify()).toMatchObject({ outcome: "pending", retryable: true });
    expect(repository.rows).toHaveLength(0);
  });

  it("keeps candidate retrieval outages retryable and leaves current mapping intact", async () => {
    const { classify, record, repository } = setup(); await record(await classify());
    const engine = createServiceMatching({ repository, activationThreshold: 0.9, candidateProvider: { findCandidates: async () => { throw new Error("database unavailable"); } }, classifier: { classify: async () => classification() } });
    expect(await engine.classifyServiceSubject(subject)).toMatchObject({ outcome: "pending", retryable: true });
    expect(repository.rows[0].status).toBe("active");
    expect(repository.rows).toHaveLength(1);
  });

  it("records vendor-capability lineage separately from partner work types", async () => {
    const { repository, engine } = setup();
    const vendorSubject: ServiceSubjectInput = { ...subject, subjectType: "vendor_capability" };
    repository.savedSubject = vendorSubject;
    const result = await engine.recordClassification({ subject: vendorSubject, classification: await engine.classifyServiceSubject(vendorSubject), actorProcess: "catalog-classifier" });
    expect(result.mapping).toMatchObject({ subjectType: "vendor_capability", workTypeId: null, vendorCapabilityId: 11, status: "active" });
  });

  it("rejects invalid thresholds and malformed model output rather than activating", async () => {
    expect(() => createServiceMatching({ activationThreshold: NaN } as never)).toThrow();
    const invalid = setup(classification({ confidence: 1.2 }));
    expect((await invalid.classify()).outcome).toBe("pending");
    const classifier = createModelServiceClassifier({ modelVersion: "fake:v1", complete: async () => '{"outcome":"matched","canonicalServiceId":999,"confidence":0.99,"explanation":"invented","evidence":{}}' });
    await expect(classifier.classify(subject, [gate])).rejects.toThrow();
  });
});
