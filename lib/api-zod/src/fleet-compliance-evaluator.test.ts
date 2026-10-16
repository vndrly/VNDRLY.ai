import { describe, expect, it } from "vitest";
import * as contracts from "./index";

const subject = { kind: "vehicle", id: "11111111-1111-4111-8111-111111111111" };
const requirement = { id: "periodic_inspection", version: 1, category: "vehicle_inspection", label: "Periodic inspection", subjectKinds: ["vehicle"], jurisdiction: "federal", classification: "legal", effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, applicability: { anyOf: [{ allOf: [{ fact: "interstate", operator: "eq", value: true }] }] }, renewalDays: 365, dueSoonDays: 30, source: { url: "https://www.ecfr.gov/current/title-49/part-396", section: "396.17", reviewedAt: "2026-10-16T00:00:00Z", reviewedByUserId: 7 } };
const evidence = { id: "22222222-2222-4222-8222-222222222222", revision: 1, subject, requirementId: requirement.id, requirementVersion: 1, status: "verified", validFrom: "2026-01-01T00:00:00Z", validUntil: "2026-10-16T12:00:00Z", verifiedAt: "2026-01-01T00:00:00Z", verifiedByUserId: 7, source: "Carrier reviewer", privateDocumentRef: "private-review-only", restrictions: { states: ["OK", "TX"], cargoCodes: ["crude"], carrierIds: [11], equipmentIds: [subject.id] } };
const input = { facts: { interstate: true, state: "OK", cargoCode: "crude", carrierId: 11 }, members: [{ subject, facts: {} }], requirements: [requirement], evidence: [evidence], at: "2026-10-16T11:59:59Z", freshness: "current" };
type Assessment = { subject: typeof subject; status: string; evaluatedAt: string; findings: Array<{ reason: string; explanation: string }>; dueSoon: unknown[] };
function call(name: string, value: unknown): unknown {
  const fn = (contracts as unknown as Record<string, (input: unknown) => unknown>)[name];
  expect(fn, name).toBeTypeOf("function");
  return fn(value);
}
function evaluate(value: unknown): Assessment[] { return call("evaluateFleetCompliance", value) as Assessment[]; }

describe("recorded Fleet compliance assessments", () => {
  it("distinguishes a missing record from a confirmed revoked credential", () => {
    expect(evaluate({ ...input, evidence: [] })[0]).toMatchObject({ status: "red", findings: [{ reason: "missing" }] });
    expect(evaluate({ ...input, evidence: [{ ...evidence, status: "revoked" }] })[0].findings[0].reason).toBe("revoked");
  });
  it("turns red exactly at expiry while retaining due-soon green before it", () => {
    expect(evaluate(input)[0]).toMatchObject({ status: "green", findings: [] });
    expect(evaluate(input)[0].dueSoon).toHaveLength(1);
    expect(evaluate({ ...input, at: "2026-10-16T12:00:00Z" })[0]).toMatchObject({ status: "red", findings: [{ reason: "expired" }] });
  });
  it("does not call an unreviewed certificate verified", () => {
    expect(evaluate({ ...input, evidence: [{ ...evidence, status: "document_received", verifiedAt: null, verifiedByUserId: null }] })[0].findings[0].reason).toBe("unverified");
  });
  it("marks excluded cargo red", () => {
    expect(evaluate({ ...input, facts: { ...input.facts, cargoCode: "waste" } })[0].findings[0].reason).toBe("excluded");
  });
  it("keeps a wrong-type applicability fact unresolved", () => {
    expect(evaluate({ ...input, facts: { ...input.facts, interstate: "true" } })[0]).toMatchObject({ status: "red", findings: [{ reason: "unverified" }] });
  });
  it("requires an actual expiry when the requirement renews", () => {
    expect(evaluate({ ...input, evidence: [{ ...evidence, validUntil: null }] })[0].findings[0].reason).toBe("unverified");
  });
  it("does not arbitrarily choose one of conflicting evidence identities", () => {
    expect(evaluate({ ...input, evidence: [evidence, { ...evidence, id: "55555555-5555-4555-8555-555555555555", status: "revoked" }] })[0].findings[0].reason).toBe("unverified");
  });
  it("keeps missing applicability facts unresolved instead of treating them as exempt", () => {
    expect(evaluate({ ...input, facts: {} })[0]).toMatchObject({ status: "red", findings: [{ reason: "unverified" }] });
    expect(evaluate({ ...input, facts: { interstate: false } })[0].status).toBe("green");
  });
  it("does not grant a green assessment when no rules are configured", () => {
    expect(evaluate({ ...input, requirements: [] })[0]).toMatchObject({ status: "red", findings: [{ reason: "unverified" }] });
  });
  it("renewal leaves the expired run snapshot untouched", () => {
    const expired = evaluate({ ...input, at: "2026-10-16T12:00:00Z" });
    const before = JSON.stringify(expired);
    const renewed = evaluate({ ...input, at: "2026-10-16T12:00:00Z", evidence: [evidence, { ...evidence, revision: 2, validUntil: "2027-01-01T00:00:00Z" }] });
    expect(renewed[0].status).toBe("green");
    expect(JSON.stringify(expired)).toBe(before);
  });
  it("evaluates every package member and exposes a red aggregate", () => {
    const component = { kind: "component", id: "33333333-3333-4333-8333-333333333333" };
    const assessments = evaluate({ ...input, requirements: [{ ...requirement, subjectKinds: ["vehicle", "component"] }], members: [...input.members, { subject: component, facts: {} }] });
    expect(assessments.map(row => row.status)).toEqual(["green", "red"]);
    expect(call("fleetDetailComplianceStatus", assessments)).toBe("red");
  });
  it("partner and dispatch projections never spread medical or raw document properties", () => {
    const assessment = evaluate({ ...input, evidence: [] })[0];
    const contaminated = { ...assessment, privateDocumentRef: "secret.pdf", licenseNumber: "SECRET", medicalResult: "PRIVATE", findings: assessment.findings.map(row => ({ ...row, explanation: "PRIVATE LAB RESULT", privateDocumentRef: "secret.pdf" })) };
    for (const name of ["projectFleetComplianceForPartner", "projectFleetComplianceForDispatch"]) {
      const rendered = JSON.stringify(call(name, contaminated));
      expect(rendered).not.toContain("PRIVATE");
      expect(rendered).not.toContain("secret.pdf");
      expect(rendered).not.toContain("SECRET");
      expect(rendered).toContain('"status":"red"');
    }
  });
  it("defaults to warning mode and ignores a future enforcement policy", () => {
    const query = { partnerId: 4, siteId: 9, contractId: null, workTypeId: 6, at: input.at, policies: [] };
    expect(call("resolveFleetCompliancePolicy", query)).toMatchObject({ mode: "warn_only" });
    expect(call("resolveFleetCompliancePolicy", { ...query, policies: [{ id: "44444444-4444-4444-8444-444444444444", version: 1, mode: "enforced", scope: { partnerId: 4, siteId: null, contractId: null, workTypeId: null }, effectiveFrom: "2027-01-01T00:00:00Z", effectiveUntil: null, checkpoints: ["dispatch", "start", "office_submit"], activatedByUserId: 7, notice: "Future reviewed contract", existingWorkTreatment: "preserve_capture_policy" }] })).toMatchObject({ mode: "warn_only" });
  });
  it("refuses ambiguous equally scoped active policy versions", () => {
    const policy = { id: "44444444-4444-4444-8444-444444444444", version: 1, mode: "enforced", scope: { partnerId: 4, siteId: 9, contractId: null, workTypeId: null }, effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, checkpoints: ["dispatch"], activatedByUserId: 7, notice: "Reviewed", existingWorkTreatment: "preserve_capture_policy" };
    expect(() => call("resolveFleetCompliancePolicy", { partnerId: 4, siteId: 9, contractId: null, workTypeId: 6, at: input.at, policies: [policy, { ...policy, id: "66666666-6666-4666-8666-666666666666", mode: "warn_only" }] })).toThrow("Ambiguous active Fleet compliance policies");
  });
});
