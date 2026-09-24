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
    expect(source).toContain('{ key: "files-notes", label: "Files & Inventory"');
    expect(source).toContain('{ key: "site-presence", label: "Site & Safety"');
  });

  it("orders compact tools as Search, Files and Inventory, Exports, then Site and Safety", () => {
    const search = source.indexOf('{ key: "search"');
    const files = source.indexOf('{ key: "files-notes"');
    const exportsItem = source.indexOf('{ key: "implementation-exports"');
    const safety = source.indexOf('{ key: "site-presence"');
    expect(search).toBeLessThan(files);
    expect(files).toBeLessThan(exportsItem);
    expect(exportsItem).toBeLessThan(safety);
  });

  it("delineates the Communications card into its four destinations", () => {
    expect(source).toContain("function CommunicationsCard");
    expect(source).toContain('label="Chats"');
    expect(source).toContain('label="Calls"');
    expect(source).toContain('label="Invitations"');
    expect(source).toContain('label={`${companyName} Conversations`}');
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

  it("links to audio settings without embedding the device panel in Work Hub", () => {
    expect(source).not.toContain("WorkHubDeviceSettings");
    expect(source).toContain('accessibilityLabel="Open Audio settings"');
    expect(source).toContain('pathname: "/profile"');
    expect(source).toContain('params: { openSettings: "audio" }');
  });
});
