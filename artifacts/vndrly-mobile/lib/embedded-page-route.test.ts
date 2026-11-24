import { describe, expect, it } from "vitest";
import { embeddedPageRoute } from "./embedded-page-route";

describe("embedded navigation boundary", () => {
  it("preserves selected account, gate and handoff across the app boundary", () => {
    expect(embeddedPageRoute("/work-hub/chat?view=connected&accountId=mail-1")).toBe("/work-hub/chat?view=connected&accountId=mail-1");
    expect(embeddedPageRoute("/gate/shift-notes?siteId=7&stationId=east&handoffId=note-1")).toBe("/shift-notes?siteId=7&stationId=east&handoffId=note-1");
  });
  it("does not forward bridge identity or embed controls into a new page", () => {
    expect(embeddedPageRoute("/gate/history?gateVoiceChannel=old&gateDashboardEmbed=1&range=24h&gateId=east")).toBe("/gate-history?range=24h&gateId=east");
  });
  it.each([undefined, {}, "https://other.test/work-hub", "//other.test/work-hub", "/\\other.test/work-hub", "/admin/users", "/work-hub/../../admin/users"])("rejects destinations outside the embedded workspace: %s", value => {
    expect(embeddedPageRoute(value)).toBeNull();
  });
});
