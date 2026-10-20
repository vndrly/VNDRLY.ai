import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn(), stored: vi.fn(), saveVisibility: vi.fn(), role: "admin" }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, role: mocks.role }, activeMembershipId: 9, activeMembership: { orgId: 3, role: mocks.role } }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mocks.stored, setItem: mocks.saveVisibility } }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetSetup from "./FleetSetup";
const fleetId = "10000000-0000-4000-8000-000000000001";
const configuration = { expectedVersion: 5, enabled: true, fleets: [{ id: fleetId, name: "North Fleet", siteIds: [392], requiredCertifications: ["CDL"] }], grants: [{ userId: 1069, fleetIds: [fleetId], siteIds: [392], roles: ["driver"], financeRead: true, safetyRelease: false }], members: [{ userId: 1069, name: "Synthetic Reviewer" }], sites: [{ siteId: 392, name: "Fictional site" }] };
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.stored.mockReset(); mocks.saveVisibility.mockReset(); mocks.role = "admin"; });
describe("mobile Fleet setup", () => {
  it("lets an Admin hide an eligible Home module on this device", async () => {
    mocks.api.mockResolvedValue(configuration);
    mocks.stored.mockResolvedValue(null);
    render(<FleetSetup onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Show Fleet Map on Home" }));
    await waitFor(() => expect(mocks.saveVisibility).toHaveBeenCalledWith("fleet-home-visibility:3:7:9", expect.stringContaining('"map":false')));
  });
  it("does not offer Home visibility controls to an Office user", async () => {
    mocks.role = "office";
    mocks.api.mockResolvedValue(configuration);
    render(<FleetSetup onSaved={vi.fn()} />);
    expect(await screen.findByText("Save Fleet access settings")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Show Fleet Map on Home" })).toBeNull();
  });
  it("drops obsolete pure-driver sites while preserving mixed office authority",async()=>{
    mocks.api.mockResolvedValueOnce({...configuration,grants:[...configuration.grants,{...configuration.grants[0],userId:1070,roles:["driver","dispatcher"]}]}).mockResolvedValue({version:6});
    render(<FleetSetup onSaved={vi.fn()}/>);fireEvent.click(await screen.findByText("Save Fleet access settings"));
    await waitFor(()=>expect(mocks.api.mock.calls).toHaveLength(2));const body=JSON.parse(mocks.api.mock.calls[1][1].body);
    expect(body.grants[0]).toMatchObject({roles:["driver"],siteIds:[],financeRead:true});expect(body.grants[1]).toMatchObject({roles:["driver","dispatcher"],siteIds:[392]});
  });
  it("adds company resources before customer sites and does not assign a pure driver to sites",async()=>{
    mocks.api.mockResolvedValueOnce({...configuration,fleets:[],grants:[],sites:[]}).mockResolvedValue({version:6});const saved=vi.fn();render(<FleetSetup onSaved={saved}/>);
    fireEvent.change(await screen.findByLabelText("New resource pool name"),{target:{value:"Company resources"}});fireEvent.click(screen.getByText("Add resource pool to draft"));fireEvent.click(screen.getByText("Save Fleet access settings"));await waitFor(()=>expect(saved).toHaveBeenCalled());expect(JSON.parse(mocks.api.mock.calls[1][1].body).fleets[0]).toMatchObject({name:"Company resources",siteIds:[]});
  });
  it("preserves existing qualifications and separate finance flags when adding an operational role", async () => {
    mocks.api.mockResolvedValueOnce(configuration).mockResolvedValue({ version: 6 });
    const saved = vi.fn();
    render(<FleetSetup onSaved={saved} />);
    fireEvent.click(await screen.findByText("North Fleet · sites 392"));
    fireEvent.click(screen.getByText("Synthetic Reviewer"));
    fireEvent.click(screen.getByText("dispatcher"));
    fireEvent.click(screen.getByText("Add grant to draft"));
    fireEvent.click(screen.getByText("Save Fleet access settings"));
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
    expect(screen.queryByText("Save Fleet access settings")).toBeNull();
  });
  it("edits a resource pool name and assigns canonical equipment using branded checks while preserving support grants", async () => {
    const assetId = "20000000-0000-4000-8000-000000000001";
    const supportGrants = [{ userId: 1, fleetIds: [fleetId], siteIds: [392], expiresAt: "2026-12-01T00:00:00Z", reason: "Synthetic support", financeRead: false }];
    mocks.api.mockResolvedValueOnce({ ...configuration, equipment: [{ assetId, name: "Canonical rig", category: "truck" }], supportGrants }).mockResolvedValue({ version: 6 });
    render(<FleetSetup onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByText("North Fleet · sites 392"));
    fireEvent.change(screen.getByLabelText("Resource pool name"), { target: { value: "North Detail" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Canonical rig" }));
    expect(screen.getByRole("checkbox", { name: "Canonical rig" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("Save Fleet access settings"));
    await waitFor(() => expect(mocks.api.mock.calls).toHaveLength(2));
    const body = JSON.parse(mocks.api.mock.calls[1][1].body);
    expect(body.fleets[0]).toMatchObject({ name: "North Detail", equipmentAssetIds: [assetId] });
    expect(body.supportGrants).toEqual(supportGrants);
  });
});
