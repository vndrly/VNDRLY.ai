import { expect, it } from "vitest";
import { checkoutSpeech } from "./checkout-speech";

it("speaks only the confirmation for an actual staged checkout", () => {
  expect(checkoutSpeech("confirm_visitor_check_out", { requiresConfirmation: true, message: "Long generated instructions" })).toBe("Say yes to check out.");
});
it("announces checkout only after canonical saved proof", () => {
  expect(checkoutSpeech("confirm_visitor_check_out", { ok: true, action: "visitor_checked_out", verification: "canonical_readback", displayName: "John Smith" })).toBe("John Smith is checked out.");
  expect(checkoutSpeech("confirm_visitor_check_out", { ok: true, action: "visitor_checked_out", displayName: "John Smith" })).toBeNull();
});
it("does not turn a failure or unrelated tool into checkout success", () => {
  expect(checkoutSpeech("confirm_visitor_check_out", { ok: false, error: "Long failure explanation" })).toBe("Checkout was not confirmed.");
  expect(checkoutSpeech("query_gate_visits", { requiresConfirmation: true })).toBeNull();
});
