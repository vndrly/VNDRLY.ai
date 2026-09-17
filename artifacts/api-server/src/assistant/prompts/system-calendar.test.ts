import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system";

describe("Calendar Ask V operating rules", () => {
  it("uses minimal input, real availability, privacy-safe alternatives, and one confirmation", () => {
    const prompt = buildSystemPrompt({
      user: {
        userId: 1,
        role: "vendor",
        displayName: "Scheduler",
        partnerId: null,
        vendorId: 42,
        preferredLanguage: "en",
      },
      docs: [],
      onboarding: {
        active: false,
        orgType: null,
        currentStep: null,
        completedSteps: [],
        skippedSteps: [],
      },
      pageContext: { path: "/work-hub/calendar" },
    });

    expect(prompt).toContain("default to thirty minutes");
    expect(prompt).toContain("find_work_hub_meeting_times");
    expect(prompt).toContain("Do not ask for optional details");
    expect(prompt).toContain("say only that the person is busy");
    expect(prompt).toContain("one confirmation only");
    expect(prompt).toContain("creator's device timezone");
  });
});
