type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
/** Standard non-batch price estimates reviewed October 7, 2026. Provider invoices
 * remain authoritative. Unknown configured models report unpriced usage rather
 * than inventing a cost. OpenAI input includes cache hits; Anthropic input does not.
 * https://developers.openai.com/api/docs/models/gpt-4.1
 * https://platform.claude.com/docs/en/about-claude/pricing
 */
export function estimateVCost(model: string, usage: Usage): number | null {
  const input = Math.max(0, usage.input_tokens), output = Math.max(0, usage.output_tokens);
  const hits = Math.max(0, usage.cache_read_input_tokens ?? 0), writes = Math.max(0, usage.cache_creation_input_tokens ?? 0);
  if (/^gpt-4\.1(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return (Math.max(0, input - hits) * 2 + hits * 0.5 + output * 8) / 1_000_000;
  if (/^claude-sonnet-4-5(?:-\d{8})?$/.test(model)) {
    const long = input + hits + writes > 200_000;
    return (input * (long ? 6 : 3) + writes * (long ? 7.5 : 3.75) + hits * (long ? 0.6 : 0.3) + output * (long ? 22.5 : 15)) / 1_000_000;
  }
  return null;
}
export function vUsageAlert(usage: { tokens: number; estimatedCostUsd: number; unpricedRounds: number }, policy: { usageAlertTokens: number; usageAlertUsd: number }) {
  const tokenAlert = usage.tokens >= policy.usageAlertTokens;
  const costAlert = usage.estimatedCostUsd >= policy.usageAlertUsd;
  return { ...usage, alert: tokenAlert || costAlert, reason: tokenAlert && costAlert ? "tokens_and_cost" : tokenAlert ? "tokens" : costAlert ? "cost" : null,
    costsComplete: usage.unpricedRounds === 0, tasksAllowed: true, hardSpendCap: false, estimatesOnly: true };
}
