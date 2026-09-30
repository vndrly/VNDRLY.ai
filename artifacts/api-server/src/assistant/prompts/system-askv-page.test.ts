import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system";

const promptFor = (path: string) => buildSystemPrompt({
  user: { userId: 1, role: "vendor", displayName: "Operator", partnerId: null, vendorId: 42, preferredLanguage: "en" },
  docs: [],
  onboarding: { active: true, orgType: "vendor", currentStep: "work-types", completedSteps: [], skippedSteps: [] },
  pageContext: { path },
});

describe("AskV page focused answers", () => {
  it.each(["/work-hub/askv", "/work-hub/askv/", "/work-hub/askv?chat=12"])("suppresses proactive onboarding context on %s", (path) => {
    const prompt = promptFor(path);
    expect(prompt).not.toContain("ONBOARDING MODE");
    expect(prompt).not.toContain("The user is currently mid-onboarding");
    expect(prompt).toContain("Do not append onboarding reminders");
    expect(prompt).toContain("Only discuss onboarding when the user explicitly asks");
    expect(prompt).toContain("get_stock_quote");
    expect(prompt).toContain("supported market-data questions");
  });
  it("preserves onboarding elsewhere and handles later voice navigation", () => {
    const prompt = promptFor("/onboarding/vendor");
    expect(prompt).toContain("ONBOARDING MODE");
    expect(prompt).toContain("Use the latest app navigation context");
  });
});
