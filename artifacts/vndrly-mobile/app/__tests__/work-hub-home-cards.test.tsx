import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Work Hub home cards", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/work-hub.tsx"), "utf8");

  it("keeps the canonical header while replacing the module button list with live summary cards", () => {
    expect(source).toContain('<WorkHubPageTitle title="Work Hub" />');
    expect(source).toContain('label={myWorkTitle}');
    expect(source).toContain('title="Today"');
    expect(source).toContain('title="Communications"');
    expect(source).toContain('title="Site & Safety"');
    expect(source).toContain('title="Files & Inventory"');
  });

  it("groups the worker's schedule and action queue into one delineated Today card", () => {
    expect(source).toContain("function TodayCard");
    expect(source).toContain('label="Calendar"');
    expect(source).toContain('label={myWorkTitle}');
    expect(source).toContain('label="Activity"');
    expect(source).toContain('label="Tasks & Forms"');
  });

  it("labels sponsored workers as My Hours instead of exposing payroll documents", () => {
    expect(source).toContain('user?.managedSubcontractor ? "My Hours" : "My Work"');
  });
});
