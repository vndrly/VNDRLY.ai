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
}));
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
    t: (key: string) => key.split(".").reduce((v: any, k) => v?.[k], en) ?? key,
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
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
import GateLocationsCard from "./GateLocationsCard";
describe("Gate Locations profile card", () => {
  beforeEach(() => {
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
    fireEvent.click(await screen.findByText("Gate Locations"));
    fireEvent.click(await screen.findByText("Partner wellhead"));
    fireEvent.click(await screen.findByText("Add gate"));
    fireEvent.change(screen.getByLabelText("Gate name"), {
      target: { value: "West gate" },
    });
    fireEvent.click(screen.getByText("Use my current location"));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Latitude") as HTMLInputElement).value,
      ).toBe("35.2"),
    );
    fireEvent.click(screen.getByText("Review gate"));
    await screen.findByText("Confirm gate");
    expect(
      mocks.api.mock.calls.filter((c) => c[0] === "/api/gate-locations"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByText("Confirm gate"));
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
    fireEvent.click(await screen.findByText("Gate Locations"));
    fireEvent.click(await screen.findByText("Partner wellhead"));
    fireEvent.click(await screen.findByText("Edit gate: West gate"));
    fireEvent.click(screen.getByText("Deactivate gate"));
    fireEvent.click(screen.getByText("Review gate"));
    fireEvent.click(await screen.findByText("Confirm gate"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("Confirm gate"));
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
