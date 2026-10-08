import { describe, expect, it } from "vitest";
import { buildVReviewInput, hasUsableVReview, isAnthropicVConfigured, requestOptionalVReview, selectVReviewedRound, type VModelRound } from "./cooperative-v-providers";
import { VProviderError } from "./cooperative-v";

const draft: VModelRound = { model: "draft", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } as VModelRound["usage"], content: [{ type: "text", text: "A successful fictional greeting.", citations: null }] };

describe("cooperative V review completion", () => {
  it("ends review input with a user request rather than an Anthropic assistant prefill", () => {
    const input = { system: "Authorized context", messages: [{ role: "user" as const, content: "Fictional greeting" }], tools: [{ name: "save", input_schema: { type: "object" as const } }], maxTokens: 100 };
    const review = buildVReviewInput(input, draft);
    expect(review.messages.slice(-2)).toEqual([{ role: "assistant", content: draft.content }, { role: "user", content: expect.stringContaining("complete final answer") }]);
    expect(review.tools).toEqual([]);
    expect(input.messages).toHaveLength(1);
    expect(review.messages[0]).toEqual(input.messages[0]);
  });
  it("retains the successful draft when a review is empty, whitespace, or requests a tool", () => {
    expect(hasUsableVReview({ ...draft, content: [] })).toBe(false);
    expect(hasUsableVReview({ ...draft, content: [{ type: "text", text: " \n", citations: null }] })).toBe(false);
    expect(hasUsableVReview({ ...draft, stop_reason: "tool_use" })).toBe(false);
    expect(hasUsableVReview(draft)).toBe(true);
    expect(selectVReviewedRound(draft, { ...draft, content: [] })).toBe(draft);
    const corrected = { ...draft, content: [{ type: "text" as const, text: "Reviewed complete greeting.", citations: null }] };
    expect(selectVReviewedRound(draft, corrected)).toBe(corrected);
  });
  it("reports the actual Anthropic integration configuration rather than a separate API key", () => {
    expect(isAnthropicVConfigured({ ANTHROPIC_API_KEY: "unrelated" })).toBe(false);
    expect(isAnthropicVConfigured({ AI_INTEGRATIONS_ANTHROPIC_API_KEY: "configured" })).toBe(false);
    expect(isAnthropicVConfigured({ AI_INTEGRATIONS_ANTHROPIC_API_KEY: "configured", AI_INTEGRATIONS_ANTHROPIC_BASE_URL: "https://provider.invalid" })).toBe(true);
  });
  it("retains the completed draft after one optional provider failure without retrying", async () => {
    let calls = 0;
    const result = await requestOptionalVReview(draft, async () => { calls++; throw new VProviderError("Provider unavailable", true); });
    expect(result.answer).toBe(draft);
    expect(result.reviewUnavailable).toBe(true);
    expect(result.review).toBeNull();
    expect(calls).toBe(1);
    await expect(requestOptionalVReview(draft, async () => { throw new VProviderError("Provider authentication failed", false); })).resolves.toMatchObject({ answer: draft, reviewUnavailable: true });
  });
  it("propagates current authority failure rather than exposing the draft after permission changes", async () => {
    const authorityError = new Error("Company provider permission changed");
    await expect(requestOptionalVReview(draft, async () => { throw authorityError; })).rejects.toBe(authorityError);
  });
});
