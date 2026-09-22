import { describe, expect, it } from "vitest";

import { GATE_PORTAL_TABS } from "./gate-portal-layout";

describe("Gate portal navigation", () => {
  it("orders Dashboard, Work Hub, Gate, History, then Shift Notes", () => {
    expect(GATE_PORTAL_TABS.map((tab) => tab.testId)).toEqual([
      "button-gate-voice",
      "tab-gate-change-over",
      "tab-gate-work-hub",
      "tab-gate-home",
      "tab-gate-history",
      "tab-gate-shift-notes",
    ]);
  });
});
