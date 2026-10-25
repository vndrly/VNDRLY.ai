import { describe, expect, it } from "vitest";

import { GATE_PORTAL_TABS } from "./gate-portal-layout";

describe("Gate portal navigation", () => {
  it("keeps Gate Map separate from Dashboard in navigation", () => {
    expect(GATE_PORTAL_TABS.map((tab) => tab.testId)).toEqual([
      "button-gate-voice",
      "tab-gate-work-hub",
      "tab-gate-change-over",
      "tab-gate-home",
      "tab-gate-map",
      "tab-gate-history",
      "tab-gate-shift-notes",
    ]);
    expect(GATE_PORTAL_TABS.find((tab) => tab.testId === "tab-gate-map")?.href).toBe("/gate/map");
  });
});
