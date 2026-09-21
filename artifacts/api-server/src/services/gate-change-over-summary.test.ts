import { beforeEach, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create } },
}));
import { summarizeShiftFacts } from "./gate-change-over-summary";
const facts = [
  { id: "metrics:events", text: "2 check-ins and 1 check-out." },
  { id: "metrics:occupancy", text: "1 visitor record remains on site." },
  { id: "item:barrier", text: "Inspect north barrier." },
];
beforeEach(() => {
  create.mockReset();
});
it("reconstructs an AI-selected briefing exclusively from recorded facts", async () => {
  create.mockResolvedValue({
    content: [
      {
        type: "text",
        text: JSON.stringify([
          "metrics:events",
          "metrics:occupancy",
          "item:barrier",
        ]),
      },
    ],
  });
  expect(await summarizeShiftFacts(facts)).toEqual({
    source: "ai_selected_facts",
    facts,
  });
});
it("falls back when the provider invents a source or omits occupancy", async () => {
  for (const ids of [
    ["metrics:events", "invented"],
    ["metrics:events", "item:barrier"],
  ]) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(ids) }],
    });
    expect(await summarizeShiftFacts(facts)).toEqual({
      source: "structured_facts",
      facts,
    });
  }
});
it("keeps handoff preparation available when the AI provider fails", async () => {
  create.mockRejectedValue(new Error("Provider unavailable"));
  expect(await summarizeShiftFacts(facts)).toEqual({
    source: "structured_facts",
    facts,
  });
});
