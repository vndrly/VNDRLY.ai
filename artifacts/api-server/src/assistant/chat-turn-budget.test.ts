import { describe, expect, it } from "vitest";
import { CHAT_TURN_ROUNDS, chatExecutionBoundary, exposeChatRoundText, isChatReportingRound } from "./chat-turn-budget";

describe("AskV chat turn budget", () => {
  it("allows nine tool-capable rounds before a final read-only report", () => {
    expect(CHAT_TURN_ROUNDS).toBe(10);
    expect(Array.from({ length: CHAT_TURN_ROUNDS }, (_, round) => isChatReportingRound(round)))
      .toEqual([false, false, false, false, false, false, false, false, false, true]);
  });
  it("keeps tool-selection narration in reasoning context but off the compact panel", () => {
    expect(exposeChatRoundText(true, "tool_use")).toBe(false);
    expect(exposeChatRoundText(true, "end_turn")).toBe(true);
    expect(exposeChatRoundText(false, "tool_use")).toBe(true);
  });
  it("names the unexecuted tools and observed outcomes at the hard boundary", () => {
    expect(chatExecutionBoundary(["read_gate_task", "update_gate_task"], [
      { name: "select_tool_pack", status: "success" },
      { name: "read_gate_task", status: "success" },
      { name: "update_gate_task", status: "requires_confirmation" },
    ])).toContain("Not executed: read_gate_task, update_gate_task");
    expect(chatExecutionBoundary(["save_gate"], [{ name: "prepare_gate", status: "failure" }])).toContain("prepare_gate (failure)");
  });
});
