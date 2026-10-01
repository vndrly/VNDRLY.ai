import { describe, expect, it } from "vitest";

import { buildSystemPrompt, buildVoiceModeInstructions } from "./prompts/system";
import { TOOLS } from "./tools";

function tool(name: string) {
  const found = TOOLS.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

function onboardingPrompt() {
  return buildSystemPrompt({
    user: {
      userId: 1,
      role: "partner",
      displayName: "Alex",
      partnerId: 1,
      vendorId: null,
      preferredLanguage: "en",
    },
    docs: [],
    onboarding: {
      active: true,
      orgType: "partner",
      currentStep: "company-basics",
      completedSteps: [],
      skippedSteps: [],
    },
  });
}

describe("Ask V tool-routing contracts", () => {
  it("sends in-flight / still-open ticket lists to lookup_open_tickets, not query_tickets", () => {
    expect(tool("lookup_open_tickets").description).toMatch(/in[- ]flight/i);
    expect(tool("lookup_open_tickets").description).toMatch(
      /not query_tickets/i,
    );
    expect(tool("query_tickets").description).toMatch(/lookup_open_tickets/);
    expect(tool("query_tickets").description).not.toMatch(/['"]list open['"]/i);
    expect(onboardingPrompt()).toMatch(
      /lookup_open_tickets[\s\S]*in[- ]flight|in[- ]flight[\s\S]*lookup_open_tickets/i,
    );
  });

  it("requires deep_link_to for take-me-to navigation instead of a hand-written markdown path", () => {
    expect(tool("deep_link_to").description).toMatch(/take me to/i);
    expect(tool("deep_link_to").description).toMatch(
      /must call|you must call|always call/i,
    );
    expect(onboardingPrompt()).toMatch(/take me to/i);
    expect(onboardingPrompt()).toMatch(
      /deep_link_to[\s\S]*must|must[\s\S]*deep_link_to/i,
    );
  });

  it("calls lookup_user_progress before answering an onboarding progress question", () => {
    const prompt = onboardingPrompt();
    expect(prompt).toMatch(/snapshot/i);
    expect(prompt).toMatch(/not the answer/i);
    expect(prompt).toMatch(/where they are in onboarding/i);
    expect(prompt).toMatch(/what step they are on/i);
    expect(prompt).toMatch(/what is left/i);
    expect(prompt).toMatch(/what is already saved/i);
    expect(prompt).toMatch(/lookup_user_progress before answering/i);

    const lookup = tool("lookup_user_progress").description;
    expect(lookup).toMatch(/snapshot/i);
    expect(lookup).toMatch(/not the answer/i);
    expect(lookup).toMatch(/where they are in onboarding/i);
    expect(lookup).toMatch(/what step they are on/i);
    expect(lookup).toMatch(/what is left/i);
    expect(lookup).toMatch(/already saved/i);
    expect(lookup).toMatch(/before answering/i);

    const voice = buildVoiceModeInstructions("en");
    expect(voice).toMatch(/where they are in onboarding/i);
    expect(voice).toMatch(/what step they are on/i);
    expect(voice).toMatch(/what is left/i);
    expect(voice).toMatch(/what is already saved/i);
    expect(voice).toMatch(/lookup_user_progress before answering/i);
    expect(voice).toMatch(/snapshot/i);
    expect(voice).toMatch(/not the answer/i);
    expect(voice).toMatch(/company name/i);
    expect(voice).toMatch(/set_onboarding_field/);
  });

  it("writes an explicit onboarding value this turn without a progress lookup first", () => {
    expect(tool("set_onboarding_field").description).toMatch(
      /already provided|already supplied|explicit/i,
    );
    expect(tool("set_onboarding_field").description).toMatch(
      /do not call lookup_user_progress|skip lookup_user_progress/i,
    );
    expect(tool("lookup_user_progress").description).toMatch(
      /already provided|already supplied|explicit write/i,
    );
    expect(onboardingPrompt()).toMatch(/set_onboarding_field/);
    expect(onboardingPrompt()).toMatch(
      /already supplied|already provided|concrete field value/i,
    );
  });
});
