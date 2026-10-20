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

const nav = vi.hoisted(() => ({ push: vi.fn(), width: 390, params: {} as Record<string, string> }));
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
  useColors: () => ({ card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", primary: "#f90", destructive: "#f33" }),
}));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button> }));
vi.mock("@/components/FleetLegacyWorkspace", () => ({ default: ({ initialMode, initialAssetId }: { initialMode: string; initialAssetId?: string }) => <Text>{`${initialMode}:${initialAssetId ?? "none"}`}</Text> }));

afterEach(() => { cleanup(); nav.push.mockReset(); nav.width = 390; nav.params = {}; });

describe("FleetShell", () => {
  it.each([390, 1024])("uses one Fleet workspace and module links at width %i", (width) => {
    nav.width = width;
    render(<FleetShell module="home" />);
    expect(screen.getByRole("heading", { name: "Fleet Ops" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dispatch" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(nav.push).toHaveBeenCalledWith("/(tabs)/fleet?module=map");
    expect(screen.getByTestId("fleet-module-grid").style.flexDirection).toBe(width >= 768 ? "row" : "column");
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
    expect(await screen.findByText("inventory:asset-42")).toBeTruthy();
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
