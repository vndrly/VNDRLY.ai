import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn(), stored: vi.fn(), saveVisibility: vi.fn(), role: "admin", companyId: 3, membershipId: 9 }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, role: mocks.role }, activeMembershipId: mocks.membershipId, activeMembership: { orgId: mocks.companyId, role: mocks.role } }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mocks.stored, setItem: mocks.saveVisibility } }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetSetup from "./FleetSetup";
const fleetId = "10000000-0000-4000-8000-000000000001";
const configuration = { expectedVersion: 5, enabled: true, fleets: [{ id: fleetId, name: "North Fleet", siteIds: [392], requiredCertifications: ["CDL"] }], grants: [{ userId: 1069, fleetIds: [fleetId], siteIds: [392], roles: ["driver"], financeRead: true, safetyRelease: false }], members: [{ userId: 1069, name: "Synthetic Reviewer" }], sites: [{ siteId: 392, name: "Fictional site" }] };
const southConfiguration = { ...configuration, expectedVersion: 6, fleets: [{ ...configuration.fleets[0], name: "South Fleet" }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.stored.mockReset(); mocks.saveVisibility.mockReset(); mocks.role = "admin"; mocks.companyId = 3; mocks.membershipId = 9; });
describe("mobile Fleet setup", () => {
  it("clears a loaded draft and reloads Setup when company membership changes", async () => {
    mocks.api.mockResolvedValueOnce(configuration).mockResolvedValueOnce(southConfiguration).mockResolvedValue({ version: 7 });
    const view = render(<FleetSetup onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByText("North Fleet · sites 392"));
    fireEvent.change(screen.getByLabelText("Resource pool name"), { target: { value: "Old draft" } });
    mocks.companyId = 4; mocks.membershipId = 10;
    view.rerender(<FleetSetup onSaved={vi.fn()} />);
    expect(await screen.findByText("South Fleet · sites 392")).toBeTruthy();
    expect(screen.queryByDisplayValue("Old draft")).toBeNull();
    fireEvent.click(screen.getByText("Save Fleet access settings"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
    expect(JSON.parse(mocks.api.mock.calls[2][1].body).expectedVersion).toBe(6);
  });

  it("ignores an old company's read when it resolves after the new context", async () => {
    const oldRead = deferred<typeof configuration>();
    mocks.api.mockImplementationOnce(() => oldRead.promise).mockResolvedValueOnce(southConfiguration);
    const view = render(<FleetSetup onSaved={vi.fn()} />);
    mocks.companyId = 4; mocks.membershipId = 10;
    view.rerender(<FleetSetup onSaved={vi.fn()} />);
    expect(await screen.findByText("South Fleet · sites 392")).toBeTruthy();
    await act(async () => oldRead.resolve(configuration));
    expect(screen.queryByText("North Fleet · sites 392")).toBeNull();
  });

  it("does not report a stale save as complete after an account switch", async () => {
    const oldSave = deferred<{ version: number }>();
    mocks.api.mockResolvedValueOnce(configuration).mockImplementationOnce(() => oldSave.promise).mockResolvedValueOnce(southConfiguration);
    const onSaved = vi.fn();
    const view = render(<FleetSetup onSaved={onSaved} />);
    fireEvent.click(await screen.findByText("Save Fleet access settings"));
    mocks.companyId = 4; mocks.membershipId = 10;
    view.rerender(<FleetSetup onSaved={onSaved} />);
    await act(async () => oldSave.resolve({ version: 6 }));
    expect(await screen.findByText("South Fleet · sites 392")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("lets an Admin hide an eligible Home module on this device", async () => {
    mocks.api.mockResolvedValue(configuration);
    mocks.stored.mockResolvedValue(null);
    render(<FleetSetup onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide Fleet Map on Home" }));
    await waitFor(() => expect(mocks.saveVisibility).toHaveBeenCalledWith("fleet-home-visibility:3:7:9", expect.stringContaining('"map":false')));
  });
  it("lets an independent Admin explicitly expose Dispatch in one action", async () => {
    mocks.api.mockResolvedValue(configuration);
    mocks.stored.mockResolvedValue(null);
    render(<FleetSetup onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show Dispatch Board on Home" }));
    await waitFor(() => expect(mocks.saveVisibility).toHaveBeenCalledWith("fleet-home-visibility:3:7:9", expect.stringContaining('"dispatch":true')));
  });
  it("does not offer Home visibility controls to an Office user", async () => {
    mocks.role = "office";
    mocks.api.mockResolvedValue(configuration);
    render(<FleetSetup onSaved={vi.fn()} />);
    expect(await screen.findByText("Save Fleet access settings")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show Fleet Map on Home" })).toBeNull();
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
