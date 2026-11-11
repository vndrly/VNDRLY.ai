import { describe, expect, it } from "vitest";
import { selectDocs, selectSignupDocs, getSignupPublicDocIds } from "./index";
describe("role-aware bilingual procedural retrieval", () => {
  it("does not fill an unrelated turn with zero-score procedures", () => {
    expect(selectDocs("vendor", "please tell me about xyzzyqwerty")).toEqual([]);
  });
  it("finds Gate procedures for Spanish vocabulary", () => {
    const docs = selectDocs("vendor", "mapa puerta");
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.some(doc => /gate|map/i.test(doc.title + doc.body))).toBe(true);
    expect(docs.every(doc => doc.roles.includes("vendor") || doc.roles.includes("any"))).toBe(true);
  });
  it("never expands the public signup corpus when vocabulary matches private features", () => {
    expect(selectSignupDocs("vendor", "facturas safety crew permisos").every(doc => getSignupPublicDocIds().has(doc.id))).toBe(true);
  });
});
