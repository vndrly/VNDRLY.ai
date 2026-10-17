import { describe, expect, it } from "vitest";
import {
  evaluateFleetInsuranceCoverage,
  projectFleetInsuranceCoverage,
} from "./fleet-coverage";
const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const policy = () => ({
  id: id(1),
  revision: 1,
  policyNumber: "PRIVATE-POLICY-987654321",
  insuredLegalEntity: "Synthetic Carrier",
  privateDocumentRef: "private-medical-and-policy-store",
  coverageType: "auto_liability",
  state: "verified",
  reviewedByUserId: 9,
  reviewedAt: "2026-10-16T10:00:00Z",
  validFrom: "2026-01-01T00:00:00Z",
  validUntil: "2027-01-01T00:00:00Z",
  carrierIds: [7],
  states: ["OK", "TX"],
  cargoCodes: ["synthetic-crude"],
  equipmentIds: [id(9)],
  scopesReviewed: true,
  limitUSD: "750000",
  filingStatus: "accepted",
  filingVerifiedAt: "2026-10-16T10:00:00Z",
  underlyingPolicyId: null,
  attachmentPointUSD: null,
  followFormReviewed: false,
});
const work = () => ({
  carrierId: 7,
  insuredLegalEntity: "Synthetic Carrier",
  states: ["OK"],
  cargoCode: "synthetic-crude",
  equipmentIds: [id(9)],
  coverageType: "auto_liability",
  requiredLimitUSD: "750000",
  requirementReference: "synthetic-reviewed-rule-v1",
  filingRequired: true,
  startAt: "2026-10-16T12:00:00Z",
  endAt: "2026-10-16T18:00:00Z",
  evaluatedAt: "2026-10-16T11:00:00Z",
});
describe("Fleet insurance coverage assessment", () => {
  it("retains unread policy identity or limits as unknown rather than requiring invented zero values", () => {
    for (const unknown of [
      { policyNumber: null },
      { insuredLegalEntity: null },
      { limitUSD: null },
    ])
      expect(
        evaluateFleetInsuranceCoverage({
          work: work(),
          records: [{ ...policy(), state: "document_received", ...unknown }],
        }),
      ).toMatchObject({
        status: "red",
        limitUSD: null,
        reasons: expect.arrayContaining(["unverified"]),
      });
  });
  it("matches the actual insured legal entity, not only a carrier number supplied on a policy record", () => {
    expect(
      evaluateFleetInsuranceCoverage({
        work: { ...work(), insuredLegalEntity: "A different legal entity" },
        records: [policy()],
      }),
    ).toMatchObject({
      status: "red",
      reasons: expect.arrayContaining(["insured_entity_mismatch"]),
    });
  });
  it("does not infer the intended legal entity and keeps a known zero limit distinct from an unread limit", () => {
    const { insuredLegalEntity: _entity, ...unknownEntity } = work();
    expect(
      evaluateFleetInsuranceCoverage({
        work: unknownEntity,
        records: [policy()],
      }),
    ).toMatchObject({
      status: "red",
      limitUSD: null,
      reasons: expect.arrayContaining(["unverified"]),
    });
    expect(
      evaluateFleetInsuranceCoverage({
        work: work(),
        records: [{ ...policy(), limitUSD: "0" }],
      }),
    ).toMatchObject({
      status: "red",
      limitUSD: "0",
      reasons: expect.arrayContaining(["insufficient_limit"]),
    });
  });
  it("keeps excess-layer intermediate precision beyond an individual stored limit", () => {
    const primary = { ...policy(), limitUSD: "900000000000000" },
      excess = {
        ...policy(),
        id: id(2),
        coverageType: "excess",
        limitUSD: "900000000000000",
        underlyingPolicyId: primary.id,
        attachmentPointUSD: primary.limitUSD,
        followFormReviewed: true,
      };
    expect(
      evaluateFleetInsuranceCoverage({
        work: { ...work(), requiredLimitUSD: "999999999999999" },
        records: [primary, excess],
      }),
    ).toMatchObject({ status: "green", limitUSD: "1800000000000000" });
  });
  it("separates document receipt, actual coverage review and verified regulatory filing", () => {
    for (const state of ["document_received", "reviewed"]) {
      expect(
        evaluateFleetInsuranceCoverage({
          work: work(),
          records: [{ ...policy(), state }],
        }),
      ).toMatchObject({
        status: "red",
        reasons: expect.arrayContaining(["unverified"]),
      });
    }
    expect(
      evaluateFleetInsuranceCoverage({
        work: work(),
        records: [
          { ...policy(), filingStatus: "pending", filingVerifiedAt: null },
        ],
      }).status,
    ).toBe("red");
    expect(
      evaluateFleetInsuranceCoverage({ work: work(), records: [policy()] }),
    ).toMatchObject({ status: "green", limitUSD: "750000" });
  });
  it.each([
    { carrierIds: [8] },
    { states: ["CA"] },
    { cargoCodes: ["other"] },
    { equipmentIds: [id(8)] },
    { validUntil: "2026-10-16T15:00:00Z" },
    { scopesReviewed: false },
  ])(
    "retains a warning for a mismatched or insufficient run scope %j",
    (change) => {
      expect(
        evaluateFleetInsuranceCoverage({
          work: work(),
          records: [{ ...policy(), ...change }],
        }).status,
      ).toBe("red");
    },
  );
  it("does not add unrelated policies or accept an unreviewed excess layer", () => {
    const primary = { ...policy(), limitUSD: "500000" },
      excess = {
        ...policy(),
        id: id(2),
        coverageType: "excess",
        limitUSD: "250000",
        underlyingPolicyId: primary.id,
        attachmentPointUSD: "500000",
        followFormReviewed: false,
      };
    expect(
      evaluateFleetInsuranceCoverage({
        work: work(),
        records: [primary, { ...primary, id: id(3) }],
      }).status,
    ).toBe("red");
    expect(
      evaluateFleetInsuranceCoverage({
        work: work(),
        records: [primary, excess],
      }).status,
    ).toBe("red");
    expect(
      evaluateFleetInsuranceCoverage({
        work: work(),
        records: [primary, { ...excess, followFormReviewed: true }],
      }),
    ).toMatchObject({
      status: "green",
      limitUSD: "750000",
      recordIds: [id(1), id(2)],
    });
  });
  it("does not infer clearance for an unscheduled window or lose fractional coverage precision", () => {
    expect(
      evaluateFleetInsuranceCoverage({
        work: { ...work(), endAt: null },
        records: [policy()],
      }).status,
    ).toBe("red");
    expect(
      evaluateFleetInsuranceCoverage({
        work: { ...work(), requiredLimitUSD: "750000.000000001" },
        records: [policy()],
      }).status,
    ).toBe("red");
  });
  it("projects operational evidence without legal names, full numbers or private paths", () => {
    const assessment = evaluateFleetInsuranceCoverage({
      work: work(),
      records: [policy()],
    });
    const projected = projectFleetInsuranceCoverage(policy(), assessment);
    expect(projected).toMatchObject({ recordId: id(1), status: "green" });
    expect(JSON.stringify(projected)).not.toMatch(
      /987654321|private-medical|Synthetic Carrier/,
    );
    expect(projected).not.toHaveProperty("policyNumber");
    expect(projected).not.toHaveProperty("privateDocumentRef");
  });
  it("does not project another policy or a changed revision as green", () => {
    const assessment = evaluateFleetInsuranceCoverage({
      work: work(),
      records: [policy()],
    });
    expect(
      projectFleetInsuranceCoverage({ ...policy(), id: id(8) }, assessment)
        .status,
    ).toBe("red");
    expect(
      projectFleetInsuranceCoverage({ ...policy(), revision: 2 }, assessment)
        .status,
    ).toBe("red");
  });
});
