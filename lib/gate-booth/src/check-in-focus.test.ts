import { expect, it } from "vitest";
import { createGateCheckInFocus } from "./check-in-focus";

it("preserves checkout approval while the Gate check-in form is visible", () => {
  const focus = createGateCheckInFocus();
  const result = { ok: false, requiresConfirmation: true, idempotencyKey: "checkout-test", message: "Check out John Smith?" };
  expect(focus.staged({ path: "/gate", gateDraft: { voiceMode: "check-in", siteLocationId: 9 } }, result)).toEqual(result);
});
