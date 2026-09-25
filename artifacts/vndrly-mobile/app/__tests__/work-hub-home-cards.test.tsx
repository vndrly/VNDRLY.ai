import fs from "node:fs";
import path from "node:path";
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { response, membership } = vi.hoisted(() => ({ response: { current: {} as Record<string, unknown> }, membership: { id: 1 } }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: () => null }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ background: "#fff", card: "#fff", primary: "#f90", border: "#ccc", text: "#111", mutedForeground: "#666" }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "field_employee", activeMembershipId: membership.id, availableMemberships: [{ id: membership.id, role: "member", orgName: "MidCon" }] } }) }));
vi.mock("@/lib/api", () => ({ apiFetch: () => Promise.resolve(response.current) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key === "filesInventory.title" ? "Files & Inventory" : key }) }));

import WorkHubScreen from "../(tabs)/work-hub";

afterEach(() => { cleanup(); membership.id = 1; });

describe("Work Hub home cards", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/work-hub.tsx"), "utf8");

  it("keeps the canonical header while replacing the module button list with live summary cards", () => {
    expect(source).toContain('<WorkHubPageTitle title="Work Hub" />');
    expect(source).toContain('label={myWorkTitle}');
    expect(source).toContain('title="Today"');
    expect(source).toContain('title="Communications"');
    expect(source).toContain('{ key: "files-notes", label: t("filesInventory.title")');
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

  it("renders Files and Inventory for a gatekeeper while hiding Exports", async () => {
    response.current = { tasks: [], announcements: [], shifts: [], meetings: [], capabilities: { canViewExports: false, allowedExportDatasets: [] } };
    render(<WorkHubScreen />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Open Files & Inventory" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Exports" })).toBeNull();
  });

  it("renders Exports when the server allows a supervisor staffing export", async () => {
    response.current = { tasks: [], announcements: [], shifts: [], meetings: [], capabilities: { canViewExports: true, allowedExportDatasets: ["staffing"] } };
    render(<WorkHubScreen />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Open Files & Inventory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Exports" })).toBeTruthy();
  });

  it("hides the previous organization's Exports during a membership switch", async () => {
    response.current = { capabilities: { canViewExports: true, allowedExportDatasets: ["staffing"] } };
    const view = render(<WorkHubScreen />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Open Exports" })).toBeTruthy();

    membership.id = 2;
    response.current = { capabilities: { canViewExports: false, allowedExportDatasets: [] } };
    view.rerender(<WorkHubScreen />);
    expect(screen.queryByRole("button", { name: "Open Exports" })).toBeNull();
  });
});
