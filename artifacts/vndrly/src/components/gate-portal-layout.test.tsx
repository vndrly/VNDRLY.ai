import { describe, expect, it } from "vitest";

import { GATE_PORTAL_TABS } from "./gate-portal-layout";

describe("Gate portal navigation", () => {
  it("places Work Hub below Gate and History", () => {
    expect(GATE_PORTAL_TABS.map((tab) => tab.testId)).toEqual([
      "button-gate-voice",
      "tab-gate-home",
      "tab-gate-history",
      "tab-gate-work-hub",
      "tab-gate-change-over",
      "tab-gate-shift-notes",
    ]);
  });
});
