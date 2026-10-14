import fs from "node:fs";
import path from "node:path";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/work-hub/NativeOperations", () => ({ default: () => null }));
vi.mock("@/components/work-hub/NativeJournal", () => ({ default: () => null }));

const { response, membership, daily } = vi.hoisted(() => ({ response: { current: {} as Record<string, unknown> }, membership: { id: 1 }, daily: {value: {calendarCount:2,myWorkCount:3,attentionCount:4,safetyCount:5} as any} }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: () => null }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ background: "#fff", card: "#fff", primary: "#f90", border: "#ccc", text: "#111", mutedForeground: "#666" }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "field_employee", activeMembershipId: membership.id, availableMemberships: [{ id: membership.id, role: "member", orgName: "MidCon" }] } }) }));
vi.mock("@/lib/api", () => ({ apiFetch: () => Promise.resolve(response.current) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key === "filesInventory.title" ? "Files & Inventory" : key }) }));

vi.mock("@/lib/daily-workspace",()=>({useDailySummary:()=>({data:daily.value,isError:!daily.value})}));
import {router} from "expo-router";
import WorkHubScreen from "../(tabs)/work-hub";

afterEach(() => { cleanup(); membership.id = 1; daily.value={calendarCount:2,myWorkCount:3,attentionCount:4,safetyCount:5}; vi.mocked(router.push).mockClear(); });

describe("Work Hub home cards", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/work-hub.tsx"), "utf8");

  it("keeps the canonical header while replacing the module button list with live summary cards", () => {
    expect(source).toContain('<WorkHubPageTitle title="Work Hub" />');
    expect(source).toContain('label={myWorkTitle}');
    expect(source).toContain('title="Today"');
    expect(source).toContain('title="Communications"');
    expect(source).toContain('{ key: "files-notes", label: t("filesInventory.title")');
    expect(source).toContain('{ key: "site-presence", label: "Site Presence"');
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

  it("shows three distinct Communications destinations", () => {
    expect(source).toContain("function CommunicationsCard");
    expect(source).toContain('label="Chats"');
    expect(source).toContain('label="Calls"');
    expect(source).toContain('label="Meetings"');
    expect(source).not.toContain('label={`${companyName} Conversations`}');
  });

  it("groups the worker's schedule and action queue into one delineated Today card", () => {
    expect(source).toContain("function TodayCard");
    expect(source).toContain('label="Calendar"');
    expect(source).toContain('label={myWorkTitle}');
    expect(source).toContain('label="Needs Attention"');
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

it("uses unified daily counts and routes Calendar, My Work, Needs Attention and Safety",async()=>{daily.value={calendarCount:2,myWorkCount:3,attentionCount:4,safetyCount:5};response.current={tasks:[],meetings:[]};render(<WorkHubScreen/>);await act(async()=>{});for(const[label,module]of [["Calendar","calendar"],["My Work","my-work"],["Needs Attention","attention"],["Safety","safety"]]){fireEvent.click(screen.getByRole("button",{name:`Open ${label}`}));expect(router.push).toHaveBeenLastCalledWith({pathname:"/work-hub/[module]",params:{module}});}expect(screen.getByText("2 upcoming")).toBeTruthy();expect(screen.getByText("3 items")).toBeTruthy();expect(screen.getByText("4 items")).toBeTruthy();expect(screen.getByText("5 items")).toBeTruthy();});
it("preserves unavailable daily state instead of displaying zero",async()=>{daily.value=undefined;response.current={tasks:[],meetings:[]};render(<WorkHubScreen/>);await act(async()=>{});expect(screen.getAllByText("Unavailable")).toHaveLength(4);expect(screen.getByRole("button",{name:"Open Calendar"}).textContent).toContain("Unavailable");});


it("shows unavailable for a single failed daily source without discarding healthy counts",async()=>{daily.value={calendarCount:null,myWorkCount:3,attentionCount:4,safetyCount:5};response.current={tasks:[],meetings:[]};render(<WorkHubScreen/>);await act(async()=>{});expect(screen.getByRole("button",{name:"Open Calendar"}).textContent).toContain("Unavailable");expect(screen.getByText("3 items")).toBeTruthy();expect(screen.getByText("4 items")).toBeTruthy();expect(screen.getByText("5 items")).toBeTruthy();});
