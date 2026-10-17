import { it, expect } from "vitest";
import {
  createFleetComplianceSourceDraft,
  verifyFleetComplianceSourceReceipt,
  updateFleetComplianceSourceDraft,
  fleetComplianceSourceSupportsRequirement,
  fleetComplianceSourceRequirements,
} from "./fleet-compliance-intake";
import { draftFleetRequirement } from "./fleet-requirement-templates";
import { FleetComplianceSaveSchema } from "./fleet-compliance-register";
const id = "11111111-1111-4111-8111-111111111111",
  at = "2026-10-16T12:00:00Z";
it("does not offer an obsolete compatible revision when the latest adopted rule has changed scope",()=>{
 const prior=draftFleetRequirement("driver-license",{version:1,effectiveFrom:at});
 const next={...prior,version:2,category:"driver_medical" as const};
 expect(fleetComplianceSourceRequirements([next,prior],"driver","driver_license")).toEqual([]);
 expect(fleetComplianceSourceRequirements([prior,{...prior,version:3}],"driver","driver_license").map(row=>row.version)).toEqual([3]);
 expect(fleetComplianceSourceRequirements([prior],"vehicle","driver_license")).toEqual([]);
});
it("requires an actual source as-of time before transcribing ELD clearance instead of using capture time", () => {
  const draft = createFleetComplianceSourceDraft({
    id,
    subject: { kind: "driver", id: 7 },
    kind: "duty",
    source: "Duty source",
    at,
  });
  expect(() =>
    updateFleetComplianceSourceDraft(draft, {
      dutySource: "ELD",
      dutyStatus: "available",
    }),
  ).toThrow();
  expect(
    updateFleetComplianceSourceDraft(draft, {
      dutySource: "ELD",
      dutyStatus: "available",
      asOf: "2026-10-16T11:45:00Z",
    }).attributes,
  ).toMatchObject({ source: "ELD", asOf: "2026-10-16T11:45:00Z" });
});
it("does not use a medical or insurance source to establish a driver license requirement", () => {
  expect(
    fleetComplianceSourceSupportsRequirement(
      "driver_license",
      "driver_license",
    ),
  ).toBe(true);
  expect(
    fleetComplianceSourceSupportsRequirement(
      "driver_medical",
      "driver_license",
    ),
  ).toBe(false);
  expect(
    fleetComplianceSourceSupportsRequirement("insurance", "driver_license"),
  ).toBe(false);
  expect(
    fleetComplianceSourceSupportsRequirement(
      "credential",
      "vehicle_inspection",
    ),
  ).toBe(true);
});
it("transcribes private source fields exactly while leaving review, scope and filing unresolved", () => {
  const initial = createFleetComplianceSourceDraft({
    id,
    subject: { kind: "carrier", id: 7 },
    kind: "insurance",
    coverageType: "auto_liability",
    source: "COI",
    at,
  });
  const record = updateFleetComplianceSourceDraft(initial, {
    policyNumber: "P-1",
    insuredLegalEntity: "Synthetic Carrier",
    limitUSD: "750000.000000001",
    validUntil: "2027-01-01T12:00:00-06:00",
  });
  expect(record.attributes).toMatchObject({
    kind: "insurance",
    coverage: {
      policyNumber: "P-1",
      insuredLegalEntity: "Synthetic Carrier",
      limitUSD: "750000.000000001",
      validUntil: record.evidence.validUntil,
      scopesReviewed: false,
      filingStatus: "unverified",
    },
  });
  expect(initial.evidence.validUntil).toBeNull();
  expect(record.evidence.status).toBe("document_received");
  expect(() =>
    updateFleetComplianceSourceDraft(initial, {
      licenseNumber: "Wrong register",
    }),
  ).toThrow();
  expect(() =>
    updateFleetComplianceSourceDraft(initial, { limitUSD: "not money" }),
  ).toThrow();
  expect(
    updateFleetComplianceSourceDraft(initial, { limitUSD: "" }).attributes,
  ).toMatchObject({ coverage: { limitUSD: null } });
});
it("requires the separately read exact received revision before calling a source saved", () => {
  const record = createFleetComplianceSourceDraft({
    id,
    subject: { kind: "driver", id: 7 },
    kind: "driver_license",
    source: "Worker source",
    at,
  });
  const receipt = {
    id,
    revision: 1,
    subject: record.evidence.subject,
    status: "document_received",
    updatedAt: at,
  };
  expect(verifyFleetComplianceSourceReceipt(record, receipt, receipt)).toEqual(
    receipt,
  );
  expect(() =>
    verifyFleetComplianceSourceReceipt(record, receipt, {
      ...receipt,
      revision: 2,
    }),
  ).toThrow();
  expect(() =>
    verifyFleetComplianceSourceReceipt(
      record,
      { ...receipt, subject: { kind: "driver", id: 8 } },
      { ...receipt, subject: { kind: "driver", id: 8 } },
    ),
  ).toThrow();
});
it("captures received sources for every private register without inventing unknown facts, review, expiry or filing", () => {
  for (const kind of [
    "driver_license",
    "driver_medical",
    "driver_testing",
    "driver_qualification",
    "duty",
    "insurance",
    "credential",
  ] as const) {
    const record = createFleetComplianceSourceDraft({
      id,
      subject:
        kind === "insurance"
          ? { kind: "carrier", id: 7 }
          : { kind: "driver", id: 7 },
      kind,
      source: "User provided source",
      at,
      ...(kind === "insurance"
        ? { coverageType: "auto_liability" as const }
        : {}),
    });
    expect(record.evidence).toMatchObject({
      id,
      revision: 1,
      status: "document_received",
      validFrom: null,
      validUntil: null,
      verifiedAt: null,
      verifiedByUserId: null,
      privateDocumentRef: null,
    });
    expect(record.review).toBeUndefined();
    expect(
      FleetComplianceSaveSchema.safeParse({
        operationId: id,
        expectedVersion: 0,
        record,
      }).success,
    ).toBe(true);
    expect(record.evidence.requirementId).toBe(`unmapped:${kind}`);
    if (record.attributes.kind === "driver_license")
      expect(record.attributes).toMatchObject({
        licenseNumber: null,
        issuingState: null,
        licenseClass: null,
        licenseStatus: "unverified",
      });
    if (record.attributes.kind === "driver_testing")
      expect(record.attributes).toMatchObject({
        program: null,
        result: "unverified",
        clearinghouseConsentAt: null,
        queryReference: null,
      });
    if (record.attributes.kind === "insurance")
      expect(record.attributes.coverage).toMatchObject({
        limitUSD: null,
        policyNumber: null,
        insuredLegalEntity: null,
        scopesReviewed: false,
        filingStatus: "unverified",
        carrierIds: null,
        equipmentIds: null,
      });
  }
});
it("does not classify a received insurance source as auto liability without a selected coverage category", () => {
  expect(() =>
    createFleetComplianceSourceDraft({
      id,
      subject: { kind: "carrier", id: 7 },
      kind: "insurance",
      source: "COI",
      at,
    }),
  ).toThrow();
});
it("pins an explicitly chosen adopted requirement, leaving received source details private and unverified", () => {
  const record = createFleetComplianceSourceDraft({
    id,
    subject: { kind: "vehicle", id },
    kind: "credential",
    source: "Inspection source",
    at,
    requirement: {
      id: "federal-periodic-inspection",
      version: 3,
      label: "Periodic inspection",
    },
  });
  expect(record.evidence).toMatchObject({
    requirementId: "federal-periodic-inspection",
    requirementVersion: 3,
    status: "document_received",
  });
  expect(record.retentionClass).toBe("maintenance");
  expect(() =>
    createFleetComplianceSourceDraft({
      id,
      subject: { kind: "vehicle", id },
      kind: "driver_license",
      source: "Wrong subject",
      at,
    }),
  ).toThrow();
});
