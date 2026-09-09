import { describe, expect, it } from "vitest";
import { getWorkHubNavItems, getWorkHubReturnPath, isWorkHubPath } from "./work-hub-nav";

describe("Work Hub navigation", () => {
  it("recognizes module routes and deep links", () => {
    expect(isWorkHubPath("/work-hub/channels/dispatch/messages/42")).toBe(true);
    expect(isWorkHubPath("/tickets/42")).toBe(false);
  });

  it("provides the focused modules to every authenticated role", () => {
    for (const role of ["admin", "partner", "vendor", "field_employee"]) {
      expect(getWorkHubNavItems(role).map((item) => item.key)).toEqual([
        "activity", "chat", "channels", "calendar", "calls", "files", "tasks", "meetings", "finance", "askv", "settings", "administration", "search",
      ]);
    }
  });

  it("restores a safe prior app location", () => {
    expect(getWorkHubReturnPath("/tickets/8")).toBe("/tickets/8");
    expect(getWorkHubReturnPath("/work-hub/tasks")).toBe("/");
    expect(getWorkHubReturnPath("https://evil.example")).toBe("/");
  });
});
