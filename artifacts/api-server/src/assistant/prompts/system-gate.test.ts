import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system";

describe("Gate Ask V operating rules", () => {
  it("is tool-first, concise, and executes explicit Gate commands", () => {
    const prompt = buildSystemPrompt({
      user: { userId: 1, role: "vendor", displayName: "Gatekeeper", partnerId: null, vendorId: 42, preferredLanguage: "en" },
      docs: [],
      onboarding: { active: false, orgType: null, currentStep: null, completedSteps: [], skippedSteps: [] },
      pageContext: { path: "/gate" },
    });

    expect(prompt).toContain("GATE FAST-LANE RULES");
    expect(prompt).toContain("call the Gate resolver immediately");
    expect(prompt).toContain("Do not speak after a successful prefill");
    expect(prompt).toContain("An imperative check-in or check-out command is the user's authorization");
    expect(prompt).toContain("Ask at most one short question");
    expect(prompt).toContain("Do not ask for optional fields");
    expect(prompt).toContain("Keep a success acknowledgment under ten words");
    expect(prompt).not.toContain("Never submit or confirm a Gate check-in or check-out");
    expect(prompt).toContain("Never ask for Host");
  });
});
