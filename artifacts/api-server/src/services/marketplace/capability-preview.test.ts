import { describe, expect, it } from "vitest";
import { createCapabilityPreview } from "./capability-preview";
import {
  createModelServiceClassifier,
  type ServiceCandidate,
} from "../service-matching";

const gate: ServiceCandidate = {
  id: 5,
  code: "gate_security",
  name: "Gate and perimeter security",
  category: "Security",
  definition: "Controlled entry and visitor logs",
  inclusionGuidance: "Staffed access",
  exclusionGuidance: "Equipment repair",
  aliases: ["Gate Services"],
};
function setup(
  overrides: {
    confidence?: number;
    selectedId?: number;
    threshold?: number;
    fail?: boolean;
    outage?: boolean;
  } = {},
) {
  const counts: number[] = [];
  const preview = createCapabilityPreview({
    activationThreshold: overrides.threshold ?? 0.9,
    candidateProvider: {
      findCandidates: async () => {
        if (overrides.fail) throw new Error("Provider secret");
        return [gate];
      },
    },
    classifier: createModelServiceClassifier({
      modelVersion: "preview-test:v1",
      complete: async () => {
        if (overrides.outage) throw new Error("Provider credential");
        return JSON.stringify({
          outcome: "matched",
          canonicalServiceId: overrides.selectedId ?? 5,
          confidence: overrides.confidence ?? 0.98,
          explanation: "Controlled entry and visitor verification.",
          evidence: { internal: "Never projected" },
        });
      },
    }),
    countMatchingDemand: async (id) => {
      counts.push(id);
      return 2;
    },
  });
  return { preview, counts };
}
describe("unsaved capability preview", () => {
  it("classifies through candidate policy and counts matching demand without a persisted subject", async () => {
    const { preview, counts } = setup();
    expect(
      await preview({
        name: "Gate Services",
        description: "Log site visitors",
      }),
    ).toEqual({
      provisional: true,
      status: "matched",
      canonicalServiceId: 5,
      canonicalServiceName: "Gate and perimeter security",
      explanation: "Controlled entry and visitor verification.",
      confidence: 0.98,
      matchingPartnerCount: 2,
    });
    expect(counts).toEqual([5]);
  });
  it("keeps below-threshold matches provisional and does not count commercial matches", async () => {
    const { preview, counts } = setup({ confidence: 0.899 });
    expect(await preview({ name: "Gate Services" })).toMatchObject({
      status: "review_required",
      matchingPartnerCount: null,
    });
    expect(counts).toEqual([]);
  });
  it("uses an inclusive calibrated threshold", async () => {
    expect(
      await setup({ confidence: 0.9 }).preview({ name: "Gate Services" }),
    ).toMatchObject({ status: "matched", matchingPartnerCount: 2 });
  });
  it.each([
    { selectedId: 999 },
    { fail: true },
    { outage: true },
    { threshold: NaN },
  ])(
    "fails closed for provider, policy, or candidate failures: %j",
    async (options) => {
      const { preview, counts } = setup(options);
      const result = await preview({ name: "Gate Services" });
      expect(result).toMatchObject({
        status: "pending",
        canonicalServiceId: null,
        canonicalServiceName: null,
        matchingPartnerCount: null,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /secret|credential|Never projected/,
      );
      expect(counts).toEqual([]);
    },
  );
});
