import { describe, expect, it } from "vitest";
import { AskVPendingConfirmationStore } from "./askv-pending-confirmation";
const pending = {
  userId: 10,
  organizationKey: "vendor:22",
  sessionId: "session-a",
  contextKey: "/gate:9",
  toolName: "confirm_visitor_check_in",
  arguments: { firstName: "Bob", siteLocationId: 9 },
  idempotencyKey: "call-a",
};
describe("AskV pending confirmation binding", () => {
  it.each(["I confirm", "Yes, confirm.", "Yes, continue"])("binds natural approval %s to the exact action once", phrase => {
    const store = new AskVPendingConfirmationStore();
    expect(store.consume(phrase, pending)).toBeNull();
    store.set(pending);
    expect(store.consume(phrase, { ...pending, arguments: { firstName: "Eve", siteLocationId: 9 } })).toBeNull();
    expect(store.consume(phrase, pending)).toEqual(pending);
    expect(store.consume(phrase, pending)).toBeNull();
  });
  it("requires the exact pending action, not just yes or a matching tool name", () => {
    const store = new AskVPendingConfirmationStore();
    expect(store.consume("yes", pending)).toBeNull();
    store.set(pending);
    for (const changed of [
      { userId: 11 },
      { organizationKey: "vendor:23" },
      { sessionId: "session-b" },
      { contextKey: "/gate:10" },
      { toolName: "confirm_visitor_check_out" },
      { arguments: { firstName: "Eve", siteLocationId: 9 } },
      { idempotencyKey: "call-b" },
    ])
      expect(store.consume("yes", { ...pending, ...changed })).toBeNull();
    expect(store.consume("yes", pending)).toMatchObject(pending);
    expect(store.consume("yes", pending)).toBeNull();
  });
  it("expires pending confirmation and clears it when the session ends", () => {
    let now = 0;
    const store = new AskVPendingConfirmationStore(() => now);
    store.set(pending);
    now = 300_001;
    expect(store.consume("yes", pending)).toBeNull();
    store.set(pending);
    store.clear(pending.userId, pending.organizationKey, pending.sessionId);
    expect(store.consume("yes", pending)).toBeNull();
  });
  it("compares sorted argument keys and snapshots drafts before they can change", () => {
    const store = new AskVPendingConfirmationStore();
    const args = { siteLocationId: 9, firstName: "Bob" };
    store.set({ ...pending, arguments: args });
    args.firstName = "Eve";
    expect(store.consume("yes", pending)).toMatchObject(pending);
  });
});
