import { describe, expect, it } from "vitest";
import {
  FLEET_REQUIREMENT_TEMPLATES,
  draftFleetRequirement,
  verifyFleetRequirementAdoption,
} from "./fleet-requirement-templates";
import {
  FleetComplianceRequirementAdoptSchema,
  FleetComplianceFactsSchema,
} from "./fleet-compliance-register";
import { evaluateFleetCompliance } from "./fleet-compliance-evaluator";

describe("review-required Federal/OK/TX requirement references", () => {
  it("requires exact immutable version readback and the prepared source, not just a successful save", () => {
    const requirement = draftFleetRequirement("tx-carrier-registration", {
      version: 2,
      effectiveFrom: "2026-10-16T12:00:00Z",
    });
    const saved = {
      ...requirement,
      source: {
        ...requirement.source,
        reviewedAt: "2026-10-16T12:30:00Z",
        reviewedByUserId: 7,
      },
    };
    expect(
      verifyFleetRequirementAdoption(requirement, saved, {
        requirements: [saved],
        canAdopt: true,
        mode: "warn_only",
      }),
    ).toEqual(saved);
    expect(() =>
      verifyFleetRequirementAdoption(requirement, saved, {
        requirements: [{ ...saved, version: 3 }],
        canAdopt: true,
        mode: "warn_only",
      }),
    ).toThrow();
    expect(() =>
      verifyFleetRequirementAdoption(
        requirement,
        { ...saved, source: { ...saved.source, section: "Different source" } },
        { requirements: [saved], canAdopt: true, mode: "warn_only" },
      ),
    ).toThrow();
  });
  it("makes an unsigned adoption draft, never a verified requirement or enforcement", () => {
    const draft = draftFleetRequirement("tx-carrier-registration", {
      version: 2,
      effectiveFrom: "2026-10-16T12:00:00Z",
    });
    expect(draft).toMatchObject({
      id: "tx-carrier-registration",
      version: 2,
      jurisdiction: "TX",
      classification: "legal",
      renewalDays: null,
    });
    expect(draft.source).not.toHaveProperty("reviewedByUserId");
    expect(draft).not.toHaveProperty("mode");
    expect(
      FleetComplianceRequirementAdoptSchema.safeParse({
        operationId: "00000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        requirement: draft,
      }).success,
    ).toBe(true);
    expect(() =>
      draftFleetRequirement("guessed-regulation", {
        version: 1,
        effectiveFrom: "2026-10-16T12:00:00Z",
      }),
    ).toThrow();
  });
  it("supplies primary sources, a research date and explicit scope-review guidance for every reference", () => {
    expect(
      new Set(FLEET_REQUIREMENT_TEMPLATES.map((row) => row.jurisdiction)),
    ).toEqual(new Set(["federal", "OK", "TX"]));
    for (const row of FLEET_REQUIREMENT_TEMPLATES) {
      expect(new URL(row.source.url).hostname).toMatch(
        /(^|\.)(fmcsa\.dot\.gov|ecfr\.gov|oklahoma\.gov|txdmv\.gov)$/,
      );
      expect(row.researchedAt).toBe("2026-10-16");
      expect(row.guidance.en.length).toBeGreaterThan(40);
      expect(row.guidance.es.length).toBeGreaterThan(40);
      expect(
        FleetComplianceFactsSchema.safeParse({ [row.applicabilityFact]: null })
          .success,
      ).toBe(true);
    }
  });
  it("never treats unknown applicability as exemption or infers legal classification from crude", () => {
    const draft = draftFleetRequirement("tx-carrier-registration", {
      version: 1,
      effectiveFrom: "2026-10-16T12:00:00Z",
    });
    const input = {
      facts: { cargoCode: "crude", state: "TX", gvwrLb: 30000 },
      members: [{ subject: { kind: "carrier", id: 1 }, facts: {} }],
      requirements: [
        {
          ...draft,
          source: {
            ...draft.source,
            reviewedAt: "2026-10-16T12:00:00Z",
            reviewedByUserId: 1,
          },
        },
      ],
      evidence: [],
      at: "2026-10-16T13:00:00Z",
    };
    expect(evaluateFleetCompliance(input)[0].findings[0].reason).toBe(
      "unverified",
    );
    expect(
      evaluateFleetCompliance({
        ...input,
        facts: { ...input.facts, txCarrierRegistrationRequired: true },
      })[0].findings[0].reason,
    ).toBe("missing");
    expect(
      evaluateFleetCompliance({
        ...input,
        facts: { ...input.facts, txCarrierRegistrationRequired: false },
      })[0].findings,
    ).toEqual([]);
  });
  it("uses source expiry for calendar-based inspection and individual licenses, never fixed-day legal renewal", () => {
    for (const key of ["federal-periodic-inspection", "driver-license"]) {
      const draft = draftFleetRequirement(key, {
        version: 1,
        effectiveFrom: "2026-10-16T12:00:00Z",
      });
      expect(draft.expiryRequired).toBe(true);
      expect(draft.renewalDays).toBeNull();
    }
  });
});
