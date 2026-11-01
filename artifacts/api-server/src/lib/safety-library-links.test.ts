import { describe, it, expect } from "vitest";
import { SAFETY_LIBRARY_REQUIREMENTS, SAFETY_LIBRARY_RESOURCE_TYPES, SafetyMaturitySummarySchema, projectSafetyMaturity } from "@workspace/api-zod";
import { safetyRequirementLinks } from "./safety-library-links";
const resources = SAFETY_LIBRARY_REQUIREMENTS.flatMap(r => SAFETY_LIBRARY_RESOURCE_TYPES.map(type => ({
  id: `${r.id}:${type}`, metadata: {
    kind: type === "training" ? "training" : type === "form" ? "form" : "policy",
    seriesId: "00000000-0000-4000-8000-000000000001", contentVersion: 1, state: "published",
    safetyResource: { familyId: r.id, categoryId: r.category, resourceType: type, sourceVersion: "1.0", sourceSha256: "a".repeat(64) },
  },
})));
describe("safety requirement Library links", () => {
  it("links all 59 requirements to four distinct original resource types without granting credit", () => {
    const maturity = projectSafetyMaturity(null);
    const response = SafetyMaturitySummarySchema.parse({ ...maturity, categories: maturity.categories.map(c => ({...c, requirements:safetyRequirementLinks(c.id,resources)})) });
    expect(response.score).toBe(0); expect(response.incomplete).toBe(true);
    const requirements=response.categories.flatMap(c=>c.requirements);
    expect(requirements).toHaveLength(59);
    expect(requirements.flatMap(r=>r.resources)).toHaveLength(236);
    for(const r of requirements)expect(r.resources.map(x=>x.type)).toEqual(SAFETY_LIBRARY_RESOURCE_TYPES);
  });
  it("does not link unpublished, malformed or mismatched-category resources", () => {
    const base=resources[0];
    const links=safetyRequirementLinks("leadership",[
      {...base,metadata:{...base.metadata,state:"draft"}},
      {...base,metadata:{...base.metadata,safetyResource:{...base.metadata.safetyResource,categoryId:"hazards"}}},
      {...base,metadata:null},
    ]);
    expect(links.flatMap(x=>x.resources)).toEqual([]);
  });
  it("prefers a newer published revision and does not infer extra role authorization", () => {
    const base=resources[0];
    const result=safetyRequirementLinks("leadership",[base,{...base,id:"newer",metadata:{...base.metadata,contentVersion:2}}]);
    expect(result[0].resources[0].id).toBe("newer");
    expect(result[0]).not.toHaveProperty("authorized");
  });
});
