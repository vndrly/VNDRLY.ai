import { describe, expect, it } from "vitest";
import { voiceMutationHint } from "./voice-mutation";
describe("voice mutation refresh hints", () => {
  it("refreshes both Gate views after committed visitor writes, including safe replays", () => {
    expect(
      voiceMutationHint(
        "confirm_visitor_check_in",
        { siteLocationId: 9 },
        '{"ok":true,"visitId":44}',
        true,
        true,
      ),
    ).toEqual({
      name: "confirm_visitor_check_in",
      siteLocationId: 9,
      visitId: 44,
      refresh: ["gate", "visits"],
      replayed: true,
    });
  });
  it("does not claim mutations for pending, failed, read-only or draft operations", () => {
    expect(
      voiceMutationHint("confirm_visitor_check_in", {}, "{}", false, false),
    ).toBeUndefined();
    expect(
      voiceMutationHint("draft_safety_report", {}, '{"ok":true}', true, false),
    ).toBeUndefined();
    expect(
      voiceMutationHint("query_tickets", {}, "[]", true, false),
    ).toBeUndefined();
  });
});
