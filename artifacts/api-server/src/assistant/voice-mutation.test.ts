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
  it("refreshes the active clients after every committed typed Work Hub action", () => {
    for (const name of [
      "send_work_hub_message",
      "manage_work_hub_task",
      "manage_work_hub_calendar_item",
      "manage_work_hub_file",
      "set_work_hub_language",
      "confirm_asset_custody_action",
    ]) {
      expect(voiceMutationHint(name, {}, '{"ok":true}', true, false), name).toEqual({
        name,
        refresh: ["work-hub"],
        replayed: false,
      });
    }
  });
});
