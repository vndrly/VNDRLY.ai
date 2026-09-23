import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Work Hub home cards", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/work-hub.tsx"), "utf8");

  it("keeps the canonical header while replacing the module button list with live summary cards", () => {
    expect(source).toContain('<WorkHubPageTitle title="Work Hub" />');
    expect(source).toContain('title={myWorkTitle}');
    expect(source).toContain('title="Activity"');
    expect(source).toContain('title="Chat"');
    expect(source).toContain('title="Calendar"');
    expect(source).toContain('title="Tasks & Forms"');
    expect(source).toContain('title="Calls & Meetings"');
    expect(source).toContain('title="Site & Safety"');
    expect(source).toContain('title="Files & Inventory"');
  });

  it("labels sponsored workers as My Hours instead of exposing payroll documents", () => {
    expect(source).toContain('user?.managedSubcontractor ? "My Hours" : "My Work"');
  });
});
