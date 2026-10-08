import { describe, expect, it } from "vitest";
import { estimateVCost, vUsageAlert } from "./cooperative-v-usage";
describe("company V usage and cost alerts", () => {
  it("estimates known model usage including caching and never invents prices for unknown models", () => {
    expect(estimateVCost("gpt-4.1-2025-04-14", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200 })).toBeCloseTo(0.0025);
    expect(estimateVCost("claude-sonnet-4-5", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 })).toBeCloseTo(0.004935);
    expect(estimateVCost("unpriced", { input_tokens: 1000, output_tokens: 100 })).toBeNull();
  });
  it("reports alerts as informational and keeps tasks allowed", () => {
    expect(vUsageAlert({ tokens: 1000001, estimatedCostUsd: 26, unpricedRounds: 0 }, { usageAlertTokens: 1000000, usageAlertUsd: 25 })).toMatchObject({ alert: true, reason: "tokens_and_cost", tasksAllowed: true, hardSpendCap: false });
    expect(vUsageAlert({ tokens: 3, estimatedCostUsd: 0, unpricedRounds: 1 }, { usageAlertTokens: 10, usageAlertUsd: 25 })).toMatchObject({ alert: false, costsComplete: false, tasksAllowed: true });
  });
});
