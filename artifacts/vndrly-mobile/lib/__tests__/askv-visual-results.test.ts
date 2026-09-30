import { describe, expect, it } from "vitest";

import { shouldOfferAskVVisualResult } from "@workspace/api-client-react/askv-visual-results";

describe("shouldOfferAskVVisualResult", () => {
  it.each([
    "| Employee | Status |\n| --- | --- |\n| Jordan | Current |",
    "## Meeting agenda\n- Safety review\n- Crew handoff",
    "Employee certification details for the assigned crew",
    "A".repeat(240),
  ])("opens rich AskV output for %s", (content) => {
    expect(shouldOfferAskVVisualResult(content)).toBe(true);
  });

  it("keeps concise conversational answers in the message bubble", () => {
    expect(shouldOfferAskVVisualResult("Your next ticket starts at 8:00 AM.")).toBe(false);
  });
});
