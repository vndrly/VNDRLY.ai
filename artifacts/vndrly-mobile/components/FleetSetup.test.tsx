import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetSetup from "./FleetSetup";
const fleetId = "10000000-0000-4000-8000-000000000001";
const configuration = { expectedVersion: 5, enabled: true, fleets: [{ id: fleetId, name: "North Fleet", siteIds: [392], requiredCertifications: ["CDL"] }], grants: [{ userId: 1069, fleetIds: [fleetId], siteIds: [392], roles: ["driver"], financeRead: true, safetyRelease: false }], members: [{ userId: 1069, name: "Synthetic Reviewer" }], sites: [{ siteId: 392, name: "Fictional site" }] };
afterEach(() => { cleanup(); mocks.api.mockReset(); });
describe("mobile Fleet setup", () => {
  it("preserves existing qualifications and separate finance flags when adding an operational role", async () => {
    mocks.api.mockResolvedValueOnce(configuration).mockResolvedValue({ version: 6 });
    const saved = vi.fn();
    render(<FleetSetup onSaved={saved} />);
    fireEvent.click(await screen.findByText("North Fleet · sites 392"));
    fireEvent.click(screen.getByText("Synthetic Reviewer"));
    fireEvent.click(screen.getByText("dispatcher"));
    fireEvent.click(screen.getByText("Add grant to draft"));
    fireEvent.click(screen.getByText("Save Fleet setup"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const body = JSON.parse(mocks.api.mock.calls[1][1].body);
    expect(body.expectedVersion).toBe(5);
    expect(body.fleets[0].requiredCertifications).toEqual(["CDL"]);
    expect(body.grants[0]).toMatchObject({ roles: ["driver", "dispatcher"], financeRead: true, safetyRelease: false });
  });
  it("does not show member or site configuration when server denies setup", async () => {
    mocks.api.mockRejectedValue(new Error("Company administrator required"));
    render(<FleetSetup onSaved={vi.fn()} />);
    expect(await screen.findByText("Company administrator required")).toBeTruthy();
    expect(screen.queryByText("Save Fleet setup")).toBeNull();
  });
});
