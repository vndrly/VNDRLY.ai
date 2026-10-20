import React from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FleetShell from "./FleetShell";
import FleetScreen from "@/app/(tabs)/fleet";
import FleetLogRedirect from "@/app/(tabs)/fleet-log";
import FleetMapRedirect from "@/app/(tabs)/fleet-map";
import FleetLocationsRedirect from "@/app/(tabs)/fleet-locations";
import FleetComplianceRedirect from "@/app/(tabs)/fleet-compliance";

const nav = vi.hoisted(() => ({ push: vi.fn(), retry: vi.fn(), width: 390, brand: "#137c49", params: {} as Record<string, string>, home: null as any, companyId: 3, membershipId: 9 }));
vi.mock("@expo/vector-icons", () => ({ Feather: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} /> }));
vi.mock("expo-router", () => ({
  router: { push: nav.push },
  useLocalSearchParams: () => nav.params,
  Redirect: ({ href }: { href: string }) => <Text testID="redirect-target">{href}</Text>,
}));
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native")>()),
  useWindowDimensions: () => ({ width: nav.width, height: 800, scale: 1, fontScale: 1 }),
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", primary: nav.brand, destructive: "#f33" }),
}));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, vendorId: nav.companyId }, activeMembershipId: nav.membershipId, activeMembership: { orgId: nav.companyId } }) }));
vi.mock("@/hooks/use-fleet-home", () => ({ useFleetHome: () => ({ projection: nav.home, state: nav.home ? "ready" : "unavailable", error: null, visibility: {}, retry: nav.retry }) }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button> }));
vi.mock("@/components/FleetSetup", () => ({ default: () => { const [draft, setDraft] = React.useState("new"); return <button aria-label="Edit Setup draft" onClick={() => setDraft("edited")}>{draft}</button>; } }));
vi.mock("@/components/FleetLegacyWorkspace", () => ({ default: ({ initialMode, initialAssetId, initialRunId, initialYardOrderId }: { initialMode: string; initialAssetId?: string; initialRunId?: string; initialYardOrderId?: string }) => <Text>{`${initialMode}:${initialAssetId ?? "none"}:${initialRunId ?? "none"}:${initialYardOrderId ?? "none"}`}</Text> }));

afterEach(() => { cleanup(); nav.push.mockReset(); nav.retry.mockReset(); nav.width = 390; nav.brand = "#137c49"; nav.params = {}; nav.home = null; nav.companyId = 3; nav.membershipId = 9; });

describe("FleetShell", () => {
  it("renders the capability-scoped Home and opens the selected next run", () => {
    nav.home = { companyId: 3, userId: 7, mode: "my_fleet_day", capabilities: ["driver", "self_dispatch"], nextAction: { kind: "start_run", label: "Start run", runId: "11111111-1111-4111-8111-111111111111" }, priorities: [], warnings: [], moduleStates: [] };
    render(<FleetShell module="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(nav.push).toHaveBeenCalledWith("/(tabs)/fleet?module=driver&runId=11111111-1111-4111-8111-111111111111");
    expect(screen.queryByRole("button", { name: "Open Dispatch" })).toBeNull();
  });
  it("opens Fleet Setup from the Admin Home", () => {
    nav.home = { companyId: 3, userId: 7, mode: "coordinated", capabilities: ["admin"], nextAction: null, priorities: [], warnings: [], moduleStates: [] };
    render(<FleetShell module="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Fleet Setup" }));
    expect(nav.push).toHaveBeenCalledWith("/(tabs)/fleet?module=setup");
  });
  it("remounts Setup when the authenticated company and membership change", () => {
    const view = render(<FleetShell module="setup" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Setup draft" }));
    expect(screen.getByText("edited")).toBeTruthy();
    nav.companyId = 4; nav.membershipId = 10;
    view.rerender(<FleetShell module="setup" />);
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.queryByText("edited")).toBeNull();
  });

  it("keeps the exact Yard Order in a Home action URL", () => {
    nav.home = { companyId: 3, userId: 7, mode: "my_fleet_day", capabilities: ["driver", "yard"], nextAction: { kind: "report_yard_order", label: "Report Yard Order", yardOrderId: "22222222-2222-4222-8222-222222222222" }, priorities: [], warnings: [], moduleStates: [] };
    render(<FleetShell module="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Report Yard Order" }));
    expect(nav.push).toHaveBeenCalledWith("/(tabs)/fleet?module=yard&yardOrderId=22222222-2222-4222-8222-222222222222");
  });
  it.each([390, 1024])("uses one Fleet workspace and module links at width %i", (width) => {
    nav.width = width;
    nav.home = { companyId: 3, userId: 7, mode: "coordinated", capabilities: ["admin"], nextAction: null, priorities: [], warnings: [], moduleStates: [] };
    render(<FleetShell module="home" />);
    expect(screen.getByRole("heading", { name: "Fleet Ops" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Dispatch Board" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Fleet Map" }));
    expect(nav.push).toHaveBeenCalledWith("/(tabs)/fleet?module=map");
    expect(screen.getByTestId("fleet-home-cards").style.flexDirection).toBe(width >= 768 ? "row" : "column");
    const card = screen.getByTestId("fleet-home-map");
    expect(card.style.borderTopWidth).toBe("2px");
    expect(card.style.borderTopColor).toBe("rgb(19, 124, 73)");
    expect(card.style.width).toBe(width >= 768 ? "48%" : "100%");
    expect(screen.getByTestId("icon-map")).toBeTruthy();
    expect(screen.getByText("Live operational locations")).toBeTruthy();
  });

  it("keeps Dispatch and Map mounted when Compliance reports a 409", () => {
    render(<FleetShell module="home" visibleModules={["dispatch", "map", "compliance"]} modules={{
      dispatch: { children: <Text>Dispatch active</Text> },
      map: { children: <Text>Map active</Text> },
      compliance: { children: <Text>Stale compliance</Text>, state: "unavailable", error: { status: 409, code: "fleet.conflict", recovery: { reloadCanonical: true, retainedWork: "unknown" } } },
    }} />);
    expect(screen.getByText("Dispatch active")).toBeTruthy();
    expect(screen.getByText("Map active")).toBeTruthy();
    expect(screen.getByText(/Compliance changed/)).toBeTruthy();
    expect(screen.queryByText("Stale compliance")).toBeNull();
  });

  it("keeps a saved inventory asset selected through the legacy view link", async () => {
    nav.params = { view: "inventory", assetId: "asset-42" };
    render(<FleetScreen />);
    expect(await screen.findByText("inventory:asset-42:none:none")).toBeTruthy();
  });

  it("opens the exact run from a Home action deep link", async () => {
    nav.params = { module: "driver", runId: "11111111-1111-4111-8111-111111111111" };
    render(<FleetScreen />);
    expect(await screen.findByText("my-day:none:11111111-1111-4111-8111-111111111111:none")).toBeTruthy();
  });

  it("retains a Yard Order deep-link parameter for the Yard module", async () => {
    nav.params = { module: "yard", yardOrderId: "22222222-2222-4222-8222-222222222222" };
    render(<FleetScreen />);
    expect(await screen.findByText("inventory:none:none:22222222-2222-4222-8222-222222222222")).toBeTruthy();
  });

  it.each([
    [FleetLogRedirect, "/(tabs)/fleet?module=history"],
    [FleetMapRedirect, "/(tabs)/fleet?module=map"],
    [FleetLocationsRedirect, "/(tabs)/fleet?module=locations"],
    [FleetComplianceRedirect, "/(tabs)/fleet?module=compliance"],
  ])("redirects a saved Fleet route to its matching module", (Route, href) => {
    render(<Route />);
    expect(screen.getByTestId("redirect-target").textContent).toBe(href);
  });
});
