import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system";

describe("Gate Ask V operating rules", () => {
  it("is tool-first, silent after successful drafts, and leaves submission to the gatekeeper", () => {
    const prompt = buildSystemPrompt({
      user: { userId: 1, role: "vendor", displayName: "Gatekeeper", partnerId: null, vendorId: 42, preferredLanguage: "en" },
      docs: [],
      onboarding: { active: false, orgType: null, currentStep: null, completedSteps: [], skippedSteps: [] },
      pageContext: { path: "/gate" },
    });

    expect(prompt).toContain("GATE FAST-LANE RULES");
    expect(prompt).toContain("call the Gate resolver immediately");
    expect(prompt).toContain("Do not speak after a successful prefill");
    expect(prompt).toContain("gatekeeper always performs the final submit");
    expect(prompt).toContain("one short clarification");
    expect(prompt).toContain("Never ask for Host");
  });
});
