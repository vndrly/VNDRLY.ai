import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../lib/locales/en.json";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  permission: vi.fn(),
  location: vi.fn(),
  auth: { user: { id: 33, role: "vendor", vendorId: 41, partnerId: null as number | null }, activeMembershipId: 1 },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "black",
    border: "gray",
    card: "white",
    destructive: "red",
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (key.split(".").reduce((v: any, k) => v?.[k], en) ?? key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(values?.[name] ?? "")),
  }),
}));
vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: mocks.permission,
  getCurrentPositionAsync: mocks.location,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("@/components/MapboxNativeMap", () => ({ default: () => null }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00adb5", name: "MidCon" }) }));
import GateLocationsCard from "./GateLocationsCard";
async function press(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
  fireEvent.click(button);
}
describe("Gate Locations profile card", () => {
  beforeEach(() => {
    mocks.auth.user = { id: 33, role: "vendor", vendorId: 41, partnerId: null };
    mocks.auth.activeMembershipId = 1;
    mocks.api.mockReset();
    mocks.permission.mockResolvedValue({ status: "granted" });
    mocks.location.mockResolvedValue({
      coords: { latitude: 35.2, longitude: -97.2 },
    });
    mocks.api.mockImplementation(async (path: string, init?: any) => {
      if (path === "/api/work-hub/home")
        return { capabilities: { canManageGateLocations: true } };
      if (path === "/api/gate-locations/sites")
        return { sites: [{ id: 22, name: "Partner wellhead" }] };
      if (path.startsWith("/api/gate-locations?")) return { gates: [] };
      if (path.endsWith("/preview"))
        return { values: JSON.parse(init.body), confirmation: "reviewed" };
      return { id: "gate", ...JSON.parse(init.body), version: 1 };
    });
  });
  afterEach(cleanup);
  it("immediately hides and clears a vendor draft when switching to a partner admin and back", async () => {
    const view = render(<GateLocationsCard />);
    await press("Gate Locations");
    await press("Partner wellhead");
    await press("Add gate");
    fireEvent.change(screen.getByLabelText("Gate name"), { target: { value: "Unsaved private gate" } });
    mocks.auth.user = { id: 33, role: "partner", vendorId: 0, partnerId: 41 };
    mocks.auth.activeMembershipId = 2;
    view.rerender(<GateLocationsCard />);
    expect(screen.queryByText("Gate Locations")).toBeNull();
    expect(screen.queryByDisplayValue("Unsaved private gate")).toBeNull();
    mocks.auth.user = { id: 33, role: "vendor", vendorId: 41, partnerId: null };
    mocks.auth.activeMembershipId = 1;
    view.rerender(<GateLocationsCard />);
    await screen.findByText("Gate Locations");
    expect(screen.queryByDisplayValue("Unsaved private gate")).toBeNull();
    expect(screen.queryByText("Partner wellhead")).toBeNull();
  });
  it("hides management without the server capability", async () => {
    mocks.api.mockResolvedValue({
      capabilities: { canManageGateLocations: false },
    });
    render(<GateLocationsCard />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(screen.queryByText("Gate Locations")).toBeNull();
  });
  it("captures a separate gate position, reviews exact values, and only saves after confirmation", async () => {
    render(<GateLocationsCard />);
    await press("Gate Locations");
    await press("Partner wellhead");
    await press("Add gate");
    fireEvent.change(screen.getByLabelText("Gate name"), {
      target: { value: "West gate" },
    });
    await press("Use my current location");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Latitude") as HTMLInputElement).value,
      ).toBe("35.2"),
    );
    await press("Review gate");
    await screen.findByText("Confirm gate");
    expect(
      mocks.api.mock.calls.filter((c) => c[0] === "/api/gate-locations"),
    ).toHaveLength(0);
    await press("Confirm gate");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/gate-locations",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"confirmation":"reviewed"'),
        }),
      ),
    );
  });
  it("provides a named gate map with exact position and 44-point input targets", async () => {
    render(<GateLocationsCard />);
    await press("Gate Locations");
    await press("Partner wellhead");
    await press("Add gate");
    fireEvent.change(screen.getByLabelText("Gate name"), { target: { value: "West gate" } });
    await press("Use my current location");
    expect(await screen.findByRole("img", { name: "Gate map: West gate. Latitude 35.2, longitude -97.2, radius 500 meters." })).toBeTruthy();
    for (const label of ["Gate name", "Latitude", "Longitude", "Radius in meters"]) {
      expect(Number.parseFloat(getComputedStyle(screen.getByLabelText(label)).minHeight)).toBeGreaterThanOrEqual(44);
    }
  });
  it("reviews deactivation and retries a failed save with the same operation key", async () => {
    const original = mocks.api.getMockImplementation()!;
    let attempts = 0;
    mocks.api.mockImplementation(async (path: string, init?: any) => {
      if (path.startsWith("/api/gate-locations?"))
        return {
          gates: [
            {
              id: "11111111-1111-4111-8111-111111111112",
              siteId: 22,
              name: "West gate",
              latitude: 35.2,
              longitude: -97.2,
              geofenceRadiusM: 150,
              active: true,
              version: 3,
            },
          ],
        };
      if (path === "/api/gate-locations" && attempts++ === 0)
        throw new Error("Network lost");
      return original(path, init);
    });
    render(<GateLocationsCard />);
    await press("Gate Locations");
    await press("Partner wellhead");
    const editButton = await screen.findByRole("button", { name: "Edit gate: West gate" });
    expect(editButton.getAttribute("aria-label")).toBe("Edit gate: West gate");
    await press("Edit gate: West gate");
    await press("Deactivate gate");
    await press("Review gate");
    await press("Confirm gate");
    await screen.findByRole("alert");
    await press("Confirm gate");
    await screen.findByText("Gate saved");
    const calls = mocks.api.mock.calls.filter(
      (c) => c[0] === "/api/gate-locations",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][1].body).toBe(calls[1][1].body);
    expect(JSON.parse(calls[0][1].body)).toMatchObject({
      active: false,
      version: 3,
      siteId: 22,
    });
  });
});
