import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Work Hub home cards", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/work-hub.tsx"), "utf8");

  it("keeps the canonical header while replacing the module button list with live summary cards", () => {
    expect(source).toContain('<WorkHubPageTitle title="Work Hub" />');
    expect(source).toContain('title={myWorkTitle}');
    expect(source).toContain('title="Activity"');
    expect(source).toContain('title="Communications"');
    expect(source).toContain('title="Calendar"');
    expect(source).toContain('title="Tasks & Forms"');
    expect(source).toContain('title="Site & Safety"');
    expect(source).toContain('title="Files & Inventory"');
  });

  it("orders the primary cards around the worker's schedule and action queue", () => {
    const calendar = source.indexOf('title="Calendar"');
    const myWork = source.indexOf('title={myWorkTitle}');
    const activity = source.indexOf('title="Activity"');
    const tasks = source.indexOf('title="Tasks & Forms"');
    expect(calendar).toBeLessThan(myWork);
    expect(myWork).toBeLessThan(activity);
    expect(activity).toBeLessThan(tasks);
  });

  it("labels sponsored workers as My Hours instead of exposing payroll documents", () => {
    expect(source).toContain('user?.managedSubcontractor ? "My Hours" : "My Work"');
  });
});
