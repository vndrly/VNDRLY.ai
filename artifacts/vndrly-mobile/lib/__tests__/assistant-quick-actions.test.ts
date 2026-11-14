import { describe, expect, it } from "vitest";
import { quickActionsForUser } from "@/lib/assistant-quick-actions";
import type { StoredUser } from "@/lib/auth";
describe("Gate release quick actions", () => {
  it.each(["gatekeeper", "gate_supervisor", "admin", "field", "foreman"])(
    "keeps %s in the Gate release",
    (vendorRole) => {
      const chips = quickActionsForUser({ id: 1, vendorRole } as StoredUser);
      expect(chips.map((c) => c.labelKey)).toEqual([
        "askv.quickActions.gateWatch",
        "askv.quickActions.gateLog",
        "askv.quickActions.gateMap",
        "askv.quickActions.gateProfile",
      ]);
    },
  );
  it("has no signed-out actions", () =>
    expect(quickActionsForUser(null)).toEqual([]));
});
