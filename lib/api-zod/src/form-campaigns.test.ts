import { describe, expect, it } from "vitest";
import { FormCampaignConfigSchema, FormCampaignPublicConfigSchema } from "./form-campaigns";

describe("form campaign poll question", () => {
  it("preserves a dedicated question while remaining compatible with older polls", () => {
    const legacy = FormCampaignConfigSchema.parse({
      kind: "poll",
      title: "Lunch",
      choices: [
        { id: "a", label: "Tacos" },
        { id: "b", label: "BBQ" },
      ],
    });
    expect(legacy.question).toBe("");
    const current = FormCampaignPublicConfigSchema.parse({
      ...legacy,
      question: "Where should we eat?",
    });
    expect(current.question).toBe("Where should we eat?");
  });
});
