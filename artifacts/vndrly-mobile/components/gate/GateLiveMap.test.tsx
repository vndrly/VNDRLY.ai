import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readVoicePageContext } from "@workspace/gate-booth";

const recent = (minutesAgo: number) => ({ latitude: 35.5, longitude: -97.5, accuracy: 8, capturedAt: new Date(Date.now() - minutesAgo * 60000).toISOString() });
const m = vi.hoisted(() => ({
  map: null as any, params: {} as Record<string, string>, stored: new Map<string, string>(), permission: "granted", query: { isError: false, error: null as Error | null },
  refetch: vi.fn(), push: vi.fn(), tools: vi.fn(), data: null as any,
}));
vi.mock("expo-router", () => ({ router: { push: m.push }, useLocalSearchParams: () => m.params, useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, []) }));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: async () => ({ status: m.permission }), requestForegroundPermissionsAsync: async () => ({ status: m.permission }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => m.stored.get(key) ?? null, setItem: async (key: string, value: string) => { m.stored.set(key, value); } } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: m.data, dataUpdatedAt: 1, refetch: m.refetch, ...m.query }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "cyan", text: "white" }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 2 }, activeMembershipId: 7 }) }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: vi.fn() }));
vi.mock("@/lib/gate-selection", () => ({ useGateSelection: () => ({ selection: null, save: vi.fn() }) }));
vi.mock("./GateHeaderActions", () => ({ useGateHeaderActions: () => null }));
vi.mock("@/components/MapboxNativeMap", () => ({ default: (props: any) => { m.map = props; return <div data-testid="map" />; } }));
import GateLiveMap from "./GateLiveMap";

const coverage = () => ({
  gates: [{ id: "g1", name: "Main gate", siteId: 9, siteName: "Demo site", latitude: 35.4, longitude: -97.4 }],
  duties: [{ id: "d1", userId: 1, stationId: "g1" }],
  staff: [
    { userId: 1, name: "Ana Live", assignment: "Demo site | Main gate", locationReason: "current", fresh: true, onWatch: true, phone: "405-555-0100", location: recent(0), lastKnownLocation: null },
    { userId: 2, name: "Bo Last", assignment: "No active assignment recorded", locationReason: "stale_or_inaccurate", fresh: false, onCall: true, location: null, lastKnownLocation: recent(14) },
    { userId: 3, name: "Cy Off", assignment: "No active assignment recorded", locationReason: "sharing_off", fresh: false, location: null, lastKnownLocation: null },
  ],
});
const key = "gate-live-map:2:7";
const mounted = async () => { render(<GateLiveMap onOpenTools={m.tools} />); await waitFor(() => expect(screen.getByTestId("map")).toBeTruthy()); };
beforeEach(() => { m.map = null; m.params = {}; m.stored.clear(); m.permission = "granted"; m.query = { isError: false, error: null }; m.data = coverage(); vi.clearAllMocks(); });
afterEach(cleanup);

it("keeps a person with an older report on the map, marked by age instead of removed", async () => {
  await mounted();
  expect(m.map.points.map((point: any) => [point.id, point.color])).toEqual([["gate:g1", "#0f766e"], ["staff:1", "#22a565"], ["staff:2", "#d97706"]]);
  expect(m.map.points.find((point: any) => point.id === "staff:2").fullLabel).toBe("Bo · 14 min ago");
  expect(screen.getByText("1 live · 1 last seen")).toBeTruthy();
  expect(screen.getByText("Your last report was 14 min ago")).toBeTruthy();
});

it("shows the phone's own position from the device and never moves the camera on a refresh", async () => {
  await mounted();
  await waitFor(() => expect(m.map.userLocation).toBe(true));
  const before = { viewKey: m.map.viewKey, center: m.map.center };
  m.data = coverage();
  m.data.staff[0].location = { ...recent(0), latitude: 35.6 };
  act(() => m.map.onUserLocation([-97.45, 35.45]));
  expect(m.map.points.find((point: any) => point.id === "staff:1").latitude).toBe(35.6);
  expect({ viewKey: m.map.viewKey, center: m.map.center }).toEqual(before);
});

it("reopens where the map was left and writes down each new resting place", async () => {
  m.stored.set(key, JSON.stringify({ camera: { center: [-97.51, 35.52], zoom: 17 }, styleKind: "street", listOpen: true }));
  await mounted();
  expect(m.map.initialCamera).toEqual({ center: [-97.51, 35.52], zoom: 17 });
  expect(m.map.styleKind).toBe("street");
  expect(screen.getByRole("button", { name: "Show Ana Live" })).toBeTruthy();
  act(() => m.map.onCameraIdle({ center: [-97.6, 35.6], zoom: 12 }));
  await waitFor(() => expect(JSON.parse(m.stored.get(key)!)).toEqual({ camera: { center: [-97.6, 35.6], zoom: 12 }, styleKind: "street", listOpen: true }));
  expect(m.map.initialCamera).toEqual({ center: [-97.51, 35.52], zoom: 17 });
});

it("flies to a person chosen from the roster and explains a person with no dot", async () => {
  await mounted();
  fireEvent.click(screen.getByRole("button", { name: "People on the map" }));
  fireEvent.click(screen.getByRole("button", { name: "Show Ana Live" }));
  expect(m.map.center).toEqual([-97.5, 35.5]);
  expect(m.map.selectedPointId).toBe("staff:1");
  expect(screen.getByTestId("gate-live-map-detail").textContent).toContain("Live · just now");
  expect(screen.getByRole("button", { name: "Call" })).toBeTruthy();
  const moved = m.map.viewKey;
  fireEvent.click(screen.getByRole("button", { name: "Show Cy Off" }));
  expect(screen.getByTestId("gate-live-map-detail").textContent).toContain("Location sharing is off");
  expect(m.map.viewKey).toBe(moved);
});

it("centers on me only when asked and fits everyone including me", async () => {
  await mounted();
  act(() => m.map.onUserLocation([-97.45, 35.45]));
  fireEvent.click(screen.getByRole("button", { name: "Center on me" }));
  expect(m.map.center).toEqual([-97.45, 35.45]);
  fireEvent.click(screen.getByRole("button", { name: "Fit everyone" }));
  expect(m.map.center).toBeUndefined();
  expect(m.map.fitPoints.map((point: any) => point.id)).toContain("me");
});

it("frames the worker on first open when there is nothing else to show, but never over a remembered view", async () => {
  m.data = { gates: [], duties: [], staff: [] };
  await mounted();
  act(() => m.map.onUserLocation([-97.45, 35.45]));
  expect(m.map.center).toEqual([-97.45, 35.45]);
  cleanup();
  m.stored.set(key, JSON.stringify({ camera: { center: [-97.51, 35.52], zoom: 17 } }));
  await mounted();
  act(() => m.map.onUserLocation([-97.45, 35.45]));
  expect(m.map.center).toBeUndefined();
});

it("tells AskV whether the person she asked for is really on the map", async () => {
  m.params = { staffUserId: "2" };
  await mounted();
  expect(readVoicePageContext("/gate/map")?.mapView).toEqual({ target: "staff:2", state: "displayed" });
  expect(m.map.selectedPointId).toBe("staff:2");
  expect(m.map.center).toEqual([-97.5, 35.5]);
  cleanup();
  m.params = { staffUserId: "3" };
  await mounted();
  expect(readVoicePageContext("/gate/map")?.mapView).toEqual({ target: "staff:3", state: "unavailable" });
  cleanup();
  expect(readVoicePageContext("/gate/map")).toBeUndefined();
});

it("keeps the last picture when a refresh fails, says so plainly, and opens the website tools", async () => {
  m.query = { isError: true, error: new Error("offline") };
  await mounted();
  expect(screen.getByText("Reconnecting · showing the last update")).toBeTruthy();
  expect(m.map.points).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
  expect(m.tools).toHaveBeenCalled();
});

it("asks for Settings instead of showing a position when location is turned off", async () => {
  m.permission = "denied";
  await mounted();
  await waitFor(() => expect(screen.getByText(/Location is off for VNDRLY Gate/)).toBeTruthy());
  expect(m.map.userLocation).toBe(false);
});
