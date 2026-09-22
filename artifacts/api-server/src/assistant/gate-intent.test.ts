import { describe, expect, it } from "vitest";
import { classifyGateIntent, isGateMutationTool } from "./gate-intent";

describe("Ask V Gate intent", () => {
  it.each([
    "check Bob Villa in",
    "Bob Villa is coming in, same truck",
    "complete the check-in for Oklahoma ABC123",
    "go ahead and admit Sam Wilson",
  ])("treats an imperative check-in as submission evidence: %s", (utterance) => {
    expect(
      classifyGateIntent({
        utterance,
        toolName: "confirm_visitor_check_in",
      }),
    ).toMatchObject({ action: "check_in", authorization: "submit" });
  });

  it.each([
    "check Bob Villa out",
    "Oklahoma ABC123 is leaving",
    "complete Bob Villa's check-out",
    "go ahead and check Sarah Jones out",
    "check out tag ABC123",
  ])("treats an imperative check-out as submission evidence: %s", (utterance) => {
    expect(
      classifyGateIntent({
        utterance,
        toolName: "confirm_visitor_check_out",
      }),
    ).toMatchObject({ action: "check_out", authorization: "submit" });
  });

  it.each([
    "new check-in for Bob",
    "pull up Bob's gate entry",
    "start a gate entry",
    "prepare a check-out for ABC123",
  ])("prepares without submitting: %s", (utterance) => {
    expect(
      classifyGateIntent({
        utterance,
        toolName: utterance.includes("out")
          ? "confirm_visitor_check_out"
          : "confirm_visitor_check_in",
      }).authorization,
    ).toBe("prepare");
  });

  it.each(["nothing else", "no more details", "that's all", "no"])(
    "submits a pending Gate draft when the user declines more details: %s",
    (utterance) => {
      expect(
        classifyGateIntent({
          utterance,
          toolName: "confirm_visitor_check_in",
          pendingPrompt: "add_details_or_complete",
        }).authorization,
      ).toBe("submit");
    },
  );

  it("treats bare no as cancellation outside the exact add-details prompt", () => {
    expect(
      classifyGateIntent({
        utterance: "no",
        toolName: "confirm_visitor_check_in",
      }).authorization,
    ).toBe("cancel");
  });

  it.each(["check Bob in", "check David out", "admit Sam"])(
    "does not submit a new Gate action from a first name alone: %s",
    (utterance) => {
      expect(
        classifyGateIntent({
          utterance,
          toolName: utterance.includes("out")
            ? "confirm_visitor_check_out"
            : "confirm_visitor_check_in",
        }).authorization,
      ).toBe("clarify");
    },
  );

  it.each([
    {
      utterance: "check Bob Villa in",
      toolName: "confirm_visitor_check_in",
      toolArguments: { firstName: "Eve", lastName: "Smith" },
    },
    {
      utterance: "check out tag ABC123",
      toolName: "confirm_visitor_check_out",
      toolArguments: { vehiclePlate: "XYZ999", visitId: 77 },
    },
  ])("rejects a resolved target that differs from the spoken command: $utterance", (input) => {
    expect(classifyGateIntent(input).authorization).toBe("clarify");
  });

  it.each([
    "check in Bob Villa",
    "check out Bob Villa",
    "complete Bob Villa's check-out",
  ])("accepts common verb-first phrasing when the resolved person matches: %s", (utterance) => {
    expect(classifyGateIntent({
      utterance,
      toolName: utterance.includes("out")
        ? "confirm_visitor_check_out"
        : "confirm_visitor_check_in",
      toolArguments: { firstName: "Bob", lastName: "Villa" },
    }).authorization).toBe("submit");
  });

  it.each([
    "yes, but change the driver",
    "submit it but use David instead",
    "if I say submit will it go?",
    "she said check him in",
    "don't check Bob in",
  ])("does not authorize corrections, questions, quotes, or negation: %s", (utterance) => {
    expect(
      classifyGateIntent({
        utterance,
        toolName: "confirm_visitor_check_in",
      }).authorization,
    ).not.toBe("submit");
  });

  it.each(["cancel", "stop", "never mind", "do not proceed"])(
    "cancels the pending Gate action: %s",
    (utterance) => {
      expect(
        classifyGateIntent({
          utterance,
          toolName: "confirm_visitor_check_in",
        }).authorization,
      ).toBe("cancel");
    },
  );

  it("recognizes every confirmed Gate mutation tool", () => {
    expect(isGateMutationTool("confirm_visitor_check_in")).toBe(true);
    expect(isGateMutationTool("confirm_visitor_check_out")).toBe(true);
    expect(isGateMutationTool("start_paid_travel")).toBe(true);
    expect(isGateMutationTool("assume_gate_shift")).toBe(true);
    expect(isGateMutationTool("set_gate_coverage_status")).toBe(true);
    expect(isGateMutationTool("deliver_gate_report")).toBe(true);
    expect(isGateMutationTool("reconcile_stale_gate_visit")).toBe(true);
    expect(isGateMutationTool("reverse_gate_reconciliation")).toBe(true);
    expect(isGateMutationTool("prepare_visitor_check_in")).toBe(false);
    expect(isGateMutationTool("confirm_ticket_action")).toBe(false);
  });

  it.each([
    ["Morning V, start my day", "start_paid_travel"],
    ["I'm on site, start my Midcon shift", "assume_gate_shift"],
    ["Pause Main Gate until October 15 because drilling stopped", "set_gate_coverage_status"],
    ["Email last Thursday's gate log to my supervisor", "deliver_gate_report"],
    ["Mark this stale truck no longer on site", "reconcile_stale_gate_visit"],
    ["Undo that reconciliation", "reverse_gate_reconciliation"],
  ])("treats an explicit Gate operation as authorization: %s", (utterance, toolName) => {
    expect(classifyGateIntent({ utterance, toolName }).authorization).toBe("submit");
  });

  it.each([
    ["Don't pause Main Gate", "set_gate_coverage_status"],
    ["Can I email the gate report?", "deliver_gate_report"],
    ["She said start my day", "start_paid_travel"],
  ])("does not execute negated, questioned, or quoted Gate operations: %s", (utterance, toolName) => {
    expect(classifyGateIntent({ utterance, toolName }).authorization).not.toBe("submit");
  });
});
