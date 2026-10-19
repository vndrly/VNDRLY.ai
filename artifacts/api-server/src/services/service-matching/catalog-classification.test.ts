import { describe, expect, it, vi } from "vitest";
import { createCatalogClassificationRunner, type CatalogClassificationStore } from "./catalog-classification";
import { createServiceMatching } from "./index";
import { mappingMatchesSavedSubject } from "../marketplace/eligibility";
import type { MappingRepository, StoredServiceMapping } from "./types";

describe("durable catalog classification", () => {
  function setup() {
    let subject = { subjectType: "partner_work_type" as const, subjectId: 11, name: "Gatekeeping", category: "Security", description: "Visitor logs" };
    const rows: StoredServiceMapping[] = [];
    const repository: MappingRepository = { withSubjectLock: async (_subject, run) => run({
      loadSubject: async () => ({ ...subject, active: true }), listMappings: async () => rows,
      isCanonicalServiceActive: async () => true,
      supersede: async (id, at) => { Object.assign(rows.find(row => row.id === id)!, { status: "superseded", supersededAt: at }); },
      insert: async data => { const row = { ...data, id: rows.length + 1, createdAt: new Date() }; rows.push(row); return row; },
    }) };
    const provider = vi.fn(async () => [{ id: 1, code: "gate", name: "Gate security", category: "Security", definition: "Control entry", aliases: [], inclusionGuidance: null, exclusionGuidance: null }]);
    const matching = createServiceMatching({ repository, activationThreshold: .95, candidateProvider: { findCandidates: provider }, classifier: {
      classify: async () => ({ outcome: "matched", canonicalServiceId: 1, confidence: .99, explanation: "Control entry", evidence: {}, modelVersion: "test:v1", subjectFingerprint: "engine-stamped" }),
    } });
    const store: CatalogClassificationStore = { load: async () => ({ subject: { ...subject }, latest: rows.at(-1) ?? null }), page: async () => [11] };
    return { rows, provider, store, matching, subject: () => subject, edit: () => { subject = { ...subject, description: "Visitor logs and badge checks" }; }, run: createCatalogClassificationRunner(store, matching) };
  }
  it("retries saved demand after provider failure and process restart, then stops once current", async () => {
    const x = setup();
    x.provider.mockRejectedValueOnce(new Error("provider down"));
    expect(await x.run(11)).toBe("pending");
    expect(x.rows).toEqual([]);
    expect(mappingMatchesSavedSubject(null, x.subject())).toBe(false);
    const restarted = createCatalogClassificationRunner(x.store, x.matching);
    expect(await restarted(11)).toBe("recorded");
    expect(mappingMatchesSavedSubject(x.rows[0], x.subject())).toBe(true);
    expect(await restarted(11)).toBe("current");
    expect(x.provider).toHaveBeenCalledTimes(2);
  });
  it("makes edited wording ineligible until the new exact saved subject is classified", async () => {
    const x = setup();
    await x.run(11);
    x.edit();
    x.provider.mockRejectedValueOnce(new Error("provider down"));
    expect(await x.run(11)).toBe("pending");
    expect(mappingMatchesSavedSubject(x.rows[0], x.subject())).toBe(false);
    expect(await x.run(11)).toBe("recorded");
    expect(x.rows[0].status).toBe("superseded");
    expect(mappingMatchesSavedSubject(x.rows[1], x.subject())).toBe(true);
  });
  it.each(["review_required", "rejected"] as const)("does not automatically overwrite a current %s decision", async status => {
    const x = setup();
    await x.run(11);
    x.rows[0].status = status;
    expect(await x.run(11)).toBe("current");
    expect(x.provider).toHaveBeenCalledTimes(1);
  });
});
