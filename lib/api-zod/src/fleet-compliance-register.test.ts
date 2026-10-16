import { describe, expect, it } from "vitest";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";
const id = "11111111-1111-4111-8111-111111111111";
function schema(name: string) {
  const value = (contracts as unknown as Record<string, ZodType>)[name];
  expect(value, name).toBeDefined();
  return value;
}
const record = () => ({
  evidence: {
    id,
    revision: 1,
    subject: { kind: "driver", id: 7 },
    requirementId: "driver-license",
    requirementVersion: 1,
    status: "document_received",
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    verifiedAt: null,
    verifiedByUserId: null,
    source: "User reported upload",
    privateDocumentRef: null,
    restrictions: {},
  },
  attributes: {
    kind: "driver_license",
    issuingState: "OK",
    licenseNumber: "SYNTHETIC-PRIVATE-123456789",
    licenseClass: "A",
    endorsements: ["N"],
    restrictions: [],
    licenseStatus: "active",
    sourceRecordId: null,
  },
  retentionClass: "qualification",
  retainUntil: null,
  legalHold: false,
});
describe("Fleet private compliance records", () => {
  it("keeps the operational register strict and excludes full private identifiers", () => {
    const entry = {
      id,
      revision: 1,
      subject: { kind: "driver", id: 7 },
      requirementId: "driver-license",
      requirementVersion: 1,
      kind: "driver_license",
      verification: "document_received",
      status: "red",
      reasons: ["unverified"],
      validUntil: null,
      evaluatedAt: "2026-10-16T12:00:00Z",
      maskedIdentifier: "••••6789",
      mayReview: false,
    };
    expect(
      schema("FleetComplianceRegisterPageSchema").safeParse({
        entries: [entry],
        nextCursor: null,
        mode: "warn_only",
      }).success,
    ).toBe(true);
    expect(
      schema("FleetComplianceRegisterPageSchema").safeParse({
        entries: [{ ...entry, licenseNumber: "private-full-number" }],
        nextCursor: null,
        mode: "warn_only",
      }).success,
    ).toBe(false);
  });
  it("keeps full license data in a separate strict reviewer record", () => {
    expect(
      schema("FleetComplianceRecordSchema").safeParse(record()).success,
    ).toBe(true);
    expect(
      schema("FleetComplianceRecordSchema").safeParse({
        ...record(),
        rawMedicalLeak: "not allowed",
      }).success,
    ).toBe(false);
  });
  it("binds driver private records to actual driver subjects", () => {
    const value = record();
    expect(
      schema("FleetComplianceRecordSchema").safeParse({
        ...value,
        evidence: { ...value.evidence, subject: { kind: "carrier", id: 7 } },
      }).success,
    ).toBe(false);
  });
  it("accepts an ordinary evidence save only as an unverified new revision", () => {
    const input = {
      operationId: "22222222-2222-4222-8222-222222222222",
      expectedVersion: 0,
      record: record(),
    };
    expect(schema("FleetComplianceSaveSchema").safeParse(input).success).toBe(
      true,
    );
    const forged = {
      ...record(),
      evidence: {
        ...record().evidence,
        status: "verified",
        verifiedAt: "2026-10-16T12:00:00Z",
        verifiedByUserId: 1,
      },
    };
    expect(
      schema("FleetComplianceSaveSchema").safeParse({
        ...input,
        record: forged,
      }).success,
    ).toBe(false);
    expect(
      schema("FleetComplianceSaveSchema").safeParse({
        ...input,
        expectedVersion: 2,
      }).success,
    ).toBe(false);
  });
  it("requires an explicit source for review and has no checkbox waiver decision", () => {
    const request = {
      operationId: "22222222-2222-4222-8222-222222222222",
      evidenceId: id,
      expectedVersion: 1,
      decision: "verified",
      source: {
        kind: "government_registry",
        reference: "Synthetic agency record",
        url: "https://example.gov/record",
      },
      reviewedAt: "2026-10-16T12:00:00Z",
    };
    expect(
      schema("FleetComplianceVerifySchema").safeParse(request).success,
    ).toBe(true);
    expect(
      schema("FleetComplianceVerifySchema").safeParse({
        ...request,
        decision: "waive",
      }).success,
    ).toBe(false);
    expect(
      schema("FleetComplianceVerifySchema").safeParse({
        ...request,
        source: null,
      }).success,
    ).toBe(false);
  });
  it("does not accept a forged private review block on ordinary uploads", () => {
    expect(
      schema("FleetComplianceSaveSchema").safeParse({
        operationId: "22222222-2222-4222-8222-222222222222",
        expectedVersion: 0,
        record: {
          ...record(),
          review: {
            source: {
              kind: "government_registry",
              reference: "private",
              url: null,
            },
            reviewedAt: "2026-10-16T12:00:00Z",
            reportedReviewedAt: "2026-10-16T12:00:00Z",
            reviewerUserId: 1,
            filingSource: null,
          },
        },
      }).success,
    ).toBe(false);
  });
});
