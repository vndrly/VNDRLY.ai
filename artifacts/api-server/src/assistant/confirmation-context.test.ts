import { describe, expect, it } from "vitest";
import { confirmationContext } from "./confirmation-context";
describe("stable confirmation context", () => {
  it("ignores transient observations, retaining the selected surface and entity", () => {
    const observed = { path: "/gate/map", entityId: 2, currentLocation: { capturedAt: "now", accuracy: 10 } };
    expect(confirmationContext(observed)).toBe(confirmationContext({ path: observed.path, entityId: 2 }));
    expect(confirmationContext(observed)).not.toBe(confirmationContext({ path: observed.path, entityId: 3 }));
    expect(confirmationContext(observed)).not.toBe(confirmationContext({ path: "/gate", entityId: 2 }));
  });
});
