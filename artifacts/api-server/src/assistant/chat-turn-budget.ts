/** Nine tool-capable model rounds, followed by one read-only reporting round. */
export const CHAT_TURN_ROUNDS = 10;

export function isChatReportingRound(round: number): boolean {
  return round === CHAT_TURN_ROUNDS - 1;
}

/** The compact panel shows the result, not tool-selection narration. */
export function exposeChatRoundText(focused: boolean, stopReason: string | null): boolean {
  return !focused || stopReason !== "tool_use";
}

export function chatExecutionBoundary(pending: string[], observed: Array<{ name: string; status: "success" | "failure" | "requires_confirmation" }>): string {
  const names = [...new Set(pending)].slice(0, 8);
  const recent = observed.slice(-8).map(call => `${call.name} (${call.status})`);
  return `This turn reached its execution limit. Not executed: ${names.length ? names.join(", ") : "the model's final tool request"}. Earlier tool results: ${recent.length ? recent.join(", ") : "none"}. Continue by checking the recorded outcomes before resuming.`;
}
