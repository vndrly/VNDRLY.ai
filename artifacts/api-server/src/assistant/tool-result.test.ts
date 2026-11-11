import { describe, expect, it } from "vitest";
import { classifyToolResult } from "./tool-result";

describe("classifyToolResult", () => {
  it.each(["not JSON: service failed", "null", "[]", "{}", '{"status":"failed"}', '{"status":"outcome_unknown"}'])("never reports invalid mutation receipt %s as success", output => {
    expect(classifyToolResult(output, true)).toBe("failure");
  });
  it("preserves empty read results and canonical no-content write receipts", () => {
    expect(classifyToolResult("[]", false)).toBe("success");
    expect(classifyToolResult('{"ok":true,"status":"applied"}', true)).toBe("success");
  });
  it("uses structured requiresConfirmation for mutating tool refusals", () => {
    const output = JSON.stringify({
      error: "Please say yes first.",
      requiresConfirmation: true,
    });

    expect(classifyToolResult(output, true)).toBe("requires_confirmation");
  });

  it("treats ordinary tool errors as failures", () => {
    expect(classifyToolResult(JSON.stringify({ error: "Ticket not found." }), true)).toBe("failure");
  });
});
