import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ api: vi.fn(), uuid: 0, language: "en" }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `90000000-0000-4000-8000-${String(++env.uuid).padStart(12, "0")}` }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", mutedForeground: "silver", card: "#222", border: "#555", primary: "#137c49", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", async importOriginal => { const actual = await importOriginal<typeof import("@/lib/fleet-copy")>(); return { useFleetCopy: () => (value: string) => actual.fleetCopy(value, env.language) }; });
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, vendorId: 3, activeMembershipId: 5 }, activeMembershipId: 5, activeMembership: { orgId: 3, orgType: "vendor" } }) }));
vi.mock("@/components/FleetInventory", () => ({ default: () => <div>Inventory intake form</div> }));
vi.mock("@/components/FleetDetailsLibrary", () => ({ default: () => <div>Reusable Details library</div> }));

import AssetWorkspace from "./AssetWorkspace";
const assetId = "30000000-0000-4000-8000-000000000001";
const yardA = "20000000-0000-4000-8000-000000000001";
const yardB = "20000000-0000-4000-8000-000000000002";
function network({ capabilities = ["yard", "driver"], foreignYard = false, assetMissingFromPage = false, attached = false }: { capabilities?: string[]; foreignYard?: boolean; assetMissingFromPage?: boolean; attached?: boolean } = {}) {
  let observation = { id: "40000000-0000-4000-8000-000000000001", companyId: 3, assetId, state: attached ? "attached" : "at_yard", method: "manual", observedAt: "2026-10-20T12:00:00Z", observedByUserId: 7, yardId: yardA, runId: null, detailId: attached ? "60000000-0000-4000-8000-000000000001" : null, latitude: null, longitude: null, notes: "" };
  let version = 1;
  env.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return { accountScope: { companyId: 3, userId: 7, membershipId: 5, sessionVersion: 1 }, fleets: [], runs: [] };
    if (path === "/api/fleet/capabilities") return { companyId: 3, userId: 7, capabilities };
    if (path === "/api/fleet/yards") return { yards: [{ id: yardA, name: "North Yard", companyId: 3, version: 1, timeZone: "America/Chicago", destinationId: null, isHomeBase: true, active: true }, { id: yardB, name: "South Yard", companyId: foreignYard ? 4 : 3, version: 1, timeZone: "America/Chicago", destinationId: null, isHomeBase: false, active: true }] };
    if (path === "/api/fleet/yard-assets" || path === `/api/fleet/yard-assets?assetId=${assetId}`) return { canManage: capabilities.includes("yard"), version: 1, fleets: [{ id: "80000000-0000-4000-8000-000000000001", name: "Assigned Fleet" }], nextCursor: null, assets: assetMissingFromPage && path === "/api/fleet/yard-assets" ? [] : [{ id: assetId, name: "Pump 4", manufacturer: "", model: "", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [], fleetIds: ["80000000-0000-4000-8000-000000000001"] }] };
    if (path.startsWith("/api/fleet/yard-assembly-targets?assetId=")) return { canManage: false, nextCursor: null, details: [] };
    if (path === "/api/fleet/custody" || path === `/api/fleet/custody?assetId=${assetId}`) return { custody: [{ version, observation, location: { yardId: observation.yardId, inheritedFromAssetId: observation.state === "attached" ? "70000000-0000-4000-8000-000000000001" : null } }] };
    if (path === "/api/fleet/custody/operations" && init?.method === "POST") {
      const body = JSON.parse(init.body!); observation = { ...body.observation, id: observation.id }; version++;
      return { operationId: body.operationId, version, observation };
    }
    throw Error(`Unexpected ${path}`);
  });
}
afterEach(() => { cleanup(); env.api.mockReset(); env.uuid = 0; env.language = "en"; });

it("moves an asset between two authorized yards and reads the canonical location", async () => {
  network();
  render(<AssetWorkspace initialAssetId={assetId} />);
  expect(await screen.findByText("North Yard")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Transfer asset" }));
  fireEvent.click(screen.getByRole("button", { name: "South Yard" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  await waitFor(() => expect(screen.getByText("South Yard")).toBeTruthy());
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")![1].body);
  expect(body).toMatchObject({ expectedVersion: 1, observation: { assetId, state: "transferred", yardId: yardB, companyId: 3 } });
});

it("shows inherited truck location and records a detach from the rig Detail", async () => {
  network({ attached: true });
  render(<AssetWorkspace initialAssetId={assetId} />);
  expect(await screen.findByText(/Location inherited from attached truck/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Detach rigging" }));
  fireEvent.click(screen.getByRole("button", { name: "Record custody" }));
  await waitFor(() => expect(screen.queryByText(/Location inherited from attached truck/)).toBeNull());
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")![1].body);
  expect(body.observation).toMatchObject({ assetId, state: "at_yard", detailId: null, yardId: yardA });
});

it("loads a deep-linked asset from its canonical detail when it is absent from the first page", async () => {
  network({ assetMissingFromPage: true });
  render(<AssetWorkspace initialAssetId={assetId} />);
  expect(await screen.findByText("Pump 4")).toBeTruthy();
  expect(screen.queryByText("Asset is unavailable in this company.")).toBeNull();
});

it("uses Driver app evidence for self-check-in when no Yard staff is available", async () => {
  network({ capabilities: ["driver"] });
  const runId = "50000000-0000-4000-8000-000000000001";
  render(<AssetWorkspace initialAssetId={assetId} initialRunId={runId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Self-check-in" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm check-in" }));
  await waitFor(() => expect(screen.getByText("Custody recorded. Current location refreshed.")).toBeTruthy());
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")![1].body);
  expect(body.observation).toMatchObject({ state: "returned", method: "driver_app", runId, observedByUserId: 7 });
});

it("rejects a Yard from another company before offering a transfer", async () => {
  network({ foreignYard: true });
  render(<AssetWorkspace initialAssetId={assetId} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Yard company scope mismatch"));
  expect(screen.queryByRole("button", { name: "Transfer asset" })).toBeNull();
});

it("removes protected custody actions after access is revoked", async () => {
  network();
  render(<AssetWorkspace initialAssetId={assetId} />);
  expect(await screen.findByRole("button", { name: "Transfer asset" })).toBeTruthy();
  env.api.mockRejectedValueOnce(Object.assign(Error("Access revoked"), { status: 403 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh assets" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Access revoked");
  expect(screen.queryByRole("button", { name: "Transfer asset" })).toBeNull();
});

it("loads assets beyond the first fifty and supports name search", async () => {
  network({ capabilities: ["yard"] });
  const baseApi = env.api.getMockImplementation()!;
  const fleetId = "80000000-0000-4000-8000-000000000001";
  const assets = Array.from({ length: 51 }, (_, index) => ({ id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `Pump ${index + 1}`, manufacturer: "", model: "", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [], fleetIds: [fleetId] }));
  env.api.mockImplementation((path: string, init?: any) => path === "/api/fleet/yard-assets" ? { canManage: true, version: 1, fleets: [{ id: fleetId, name: "Assigned Fleet" }], assets: assets.slice(0, 50), nextCursor: assets[49].id }
    : path.startsWith("/api/fleet/yard-assets?after=") ? { canManage: true, version: 1, fleets: [{ id: fleetId, name: "Assigned Fleet" }], assets: assets.slice(50), nextCursor: null }
    : path === `/api/fleet/yard-assets?assetId=${assets[50].id}` ? { canManage: true, version: 1, fleets: [{ id: fleetId, name: "Assigned Fleet" }], assets: [assets[50]], nextCursor: null }
    : path === `/api/fleet/custody?assetId=${assets[50].id}` ? { custody: [{ version: 7, observation: { id: "40000000-0000-4000-8000-000000000051", companyId: 3, assetId: assets[50].id, state: "at_yard", method: "manual", observedAt: "2026-10-20T12:00:00Z", observedByUserId: 7, yardId: yardA, runId: null, detailId: null, latitude: null, longitude: null, notes: "" }, location: { yardId: yardA } }] }
    : baseApi(path, init));
  render(<AssetWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more assets" }));
  fireEvent.change(screen.getByLabelText("Search assets"), { target: { value: "Pump 51" } });
  expect(await screen.findByRole("button", { name: "Open asset Pump 51" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open asset Pump 1" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open asset Pump 51" }));
  expect(await screen.findByRole("button", { name: "Transfer asset" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh assets" }));
  expect(await screen.findByRole("button", { name: "Transfer asset" })).toBeTruthy();
  expect(screen.getByText("Pump 51")).toBeTruthy();
  expect(screen.queryByText("Asset is unavailable in this company.")).toBeNull();
});

it("ignores a late exact custody response for an asset that is no longer selected", async () => {
  network();
  const baseApi = env.api.getMockImplementation()!;
  const otherId = "30000000-0000-4000-8000-000000000002";
  const firstAsset = (await baseApi("/api/fleet/yard-assets") as any).assets[0];
  let releaseFirst!: (value: any) => void;
  const firstRead = new Promise(resolve => { releaseFirst = resolve; });
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/yard-assets") return { canManage: true, version: 1, fleets: [{ id: firstAsset.fleetIds[0], name: "Assigned Fleet" }], assets: [firstAsset, { ...firstAsset, id: otherId, name: "Pump 2" }], nextCursor: null };
    if (path === `/api/fleet/custody?assetId=${assetId}`) return firstRead;
    if (path === `/api/fleet/custody?assetId=${otherId}`) return { custody: [{ version: 9, observation: { id: "40000000-0000-4000-8000-000000000002", companyId: 3, assetId: otherId, state: "at_yard", method: "manual", observedAt: "2026-10-20T12:00:00Z", observedByUserId: 7, yardId: yardB, runId: null, detailId: null, latitude: null, longitude: null, notes: "" }, location: { yardId: yardB } }] };
    return baseApi(path, init);
  });
  render(<AssetWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Open asset Pump 4" }));
  fireEvent.click(screen.getByRole("button", { name: "All assets" }));
  fireEvent.click(screen.getByRole("button", { name: "Open asset Pump 2" }));
  expect(await screen.findByText("South Yard")).toBeTruthy();
  releaseFirst({ custody: [{ version: 1, observation: { id: "40000000-0000-4000-8000-000000000001", companyId: 3, assetId, state: "at_yard", method: "manual", observedAt: "2026-10-20T12:00:00Z", observedByUserId: 7, yardId: yardA, runId: null, detailId: null, latitude: null, longitude: null, notes: "" }, location: { yardId: yardA } }] });
  await waitFor(() => expect(screen.getByText("South Yard")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Transfer asset" }));
  fireEvent.click(screen.getByRole("button", { name: "North Yard" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  await waitFor(() => expect(env.api.mock.calls.some(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")).toBe(true));
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")![1].body);
  expect(body).toMatchObject({ expectedVersion: 9, observation: { assetId: otherId } });
});

it("uses selected asset's exact older custody version rather than treating list omission as zero", async () => {
  network();
  const baseApi = env.api.getMockImplementation()!;
  let savedObservation: any = null;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/custody") return { custody: [] };
    if (path === "/api/fleet/custody/operations" && init?.method === "POST") { const body = JSON.parse(init.body); savedObservation = { ...body.observation, id: "40000000-0000-4000-8000-000000000001" }; return { operationId: body.operationId, version: 18, observation: savedObservation }; }
    if (path === `/api/fleet/custody?assetId=${assetId}`) { const observed = baseApi(path, init) as any; return Promise.resolve(observed).then((value: any) => ({ custody: value.custody.map((row: any) => ({ ...row, version: savedObservation ? 18 : 17, observation: savedObservation ?? row.observation, location: { yardId: savedObservation?.yardId ?? row.observation.yardId } })) })); }
    return baseApi(path, init);
  });
  render(<AssetWorkspace initialAssetId={assetId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Transfer asset" }));
  fireEvent.click(screen.getByRole("button", { name: "South Yard" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  await waitFor(() => expect(env.api.mock.calls.some(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")).toBe(true));
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")![1].body);
  expect(body.expectedVersion).toBe(17);
  expect(await screen.findByText("Custody recorded. Current location refreshed.")).toBeTruthy();
  expect(screen.getByText("South Yard")).toBeTruthy();
});

it.each(["POST 502 after commit", "canonical GET 503 after POST"])("recovers the original custody receipt after %s", async failure => {
  network();
  const baseApi = env.api.getMockImplementation()!;
  let receipt: any, failed = false;
  env.api.mockImplementation(async (path: string, init?: any) => {
    if (path === "/api/fleet/custody/operations" && init?.method === "POST") {
      receipt = await baseApi(path, init);
      if (failure.startsWith("POST") && !failed) { failed = true; throw Object.assign(Error("Gateway failure"), { status: 502 }); }
      return receipt;
    }
    if (path === `/api/fleet/custody?assetId=${assetId}` && receipt && failure.startsWith("canonical") && !failed) { failed = true; throw Object.assign(Error("Readback failed"), { status: 503 }); }
    if (path === `/api/fleet/custody/operations/${receipt?.operationId}`) return { operationId: receipt.operationId, result: receipt };
    return baseApi(path, init);
  });
  render(<AssetWorkspace initialAssetId={assetId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Transfer asset" }));
  fireEvent.click(screen.getByRole("button", { name: "South Yard" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  expect(await screen.findByText("Custody recorded. Current location refreshed.")).toBeTruthy();
  expect(env.api.mock.calls.filter(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")).toHaveLength(1);
  expect(env.api.mock.calls.some(([path]) => path === `/api/fleet/custody/operations/${receipt.operationId}`)).toBe(true);
});

it.each(["POST 502 after commit", "canonical GET 503 after POST"])("recovers the original asset-intake receipt after %s", async failure => {
  network({ capabilities: ["yard"] });
  const baseApi = env.api.getMockImplementation()!;
  const receivedId = "30000000-0000-4000-8000-000000000099";
  let operationId = "", failed = false, posted = false;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/yard-assets" && init?.method === "POST") { operationId = JSON.parse(init.body).asset.operationId; posted = true; if (failure.startsWith("POST") && !failed) { failed = true; throw Object.assign(Error("Gateway failure"), { status: 502 }); } return { assetId: receivedId }; }
    if (path === `/api/fleet/yard-assets/operations/${operationId}` && posted) return { assetId: receivedId };
    if (path === `/api/fleet/yard-assets?assetId=${receivedId}`) { if (failure.startsWith("canonical") && !failed) { failed = true; throw Object.assign(Error("Readback failed"), { status: 503 }); } return { canManage: true, version: 2, fleets: [{ id: "80000000-0000-4000-8000-000000000001", name: "Assigned Fleet" }], nextCursor: null, assets: [{ id: receivedId, name: "New pump", manufacturer: "", model: "", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [{ kind: "asset_tag", value: "P-99" }], fleetIds: ["80000000-0000-4000-8000-000000000001"] }] }; }
    if (path === `/api/fleet/custody?assetId=${receivedId}`) return { custody: [] };
    return baseApi(path, init);
  });
  render(<AssetWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Receive new asset" }));
  fireEvent.change(screen.getByLabelText("Asset name"), { target: { value: "New pump" } });
  fireEvent.change(screen.getByLabelText("Legal owner"), { target: { value: "Example" } });
  fireEvent.change(screen.getByLabelText("Asset tag"), { target: { value: "P-99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save asset intake" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Recover asset intake" }));
  expect(await screen.findByText("Asset received in the selected Fleet group.")).toBeTruthy();
  expect(env.api.mock.calls.filter(([path, init]) => path === "/api/fleet/yard-assets" && init?.method === "POST")).toHaveLength(1);
});

it("rebases a rejected custody conflict, keeping the worker's reason for reviewed reapplication", async () => {
  network();
  const baseApi = env.api.getMockImplementation()!;
  let conflict = true, version = 1, savedObservation: any = null;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/custody/operations" && init?.method === "POST") {
      if (conflict) { conflict = false; version = 2; return Promise.reject(Object.assign(Error("Version conflict"), { status: 409 })); }
      const body = JSON.parse(init.body); version = 3; savedObservation = { ...body.observation, id: "40000000-0000-4000-8000-000000000001" }; return { operationId: body.operationId, version, observation: savedObservation };
    }
    if (path === `/api/fleet/custody?assetId=${assetId}`) { const observed = baseApi(path, init) as any; return Promise.resolve(observed).then((value: any) => ({ custody: value.custody.map((row: any) => ({ ...row, version, observation: savedObservation ?? row.observation, location: { yardId: savedObservation?.yardId ?? row.observation.yardId } })) })); }
    return baseApi(path, init);
  });
  render(<AssetWorkspace initialAssetId={assetId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Transfer asset" }));
  fireEvent.click(screen.getByRole("button", { name: "South Yard" }));
  fireEvent.change(screen.getByLabelText("Custody reason"), { target: { value: "Moved for repair" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  expect(await screen.findByText(/Custody changed/)).toBeTruthy();
  expect(screen.getByLabelText("Custody reason")).toHaveProperty("value", "Moved for repair");
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  expect(await screen.findByText("Custody recorded. Current location refreshed.")).toBeTruthy();
  expect(screen.getByText("South Yard")).toBeTruthy();
  await waitFor(() => expect(env.api.mock.calls.filter(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")).toHaveLength(2));
  const actions = env.api.mock.calls.filter(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(actions[1].expectedVersion).toBe(2);
  expect(actions[1].operationId).not.toBe(actions[0].operationId);
  expect(actions[1].observation.notes).toBe("Moved for repair");
});

it("shows Yard intake and custody actions in Spanish", async () => {
  env.language = "es";
  network({ capabilities: ["yard"] });
  render(<AssetWorkspace initialAssetId={assetId} />);
  expect(await screen.findByRole("button", { name: "Trasladar activo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Recibir activo nuevo" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Trasladar activo" }));
  expect(screen.getByRole("button", { name: "Confirmar traslado" })).toBeTruthy();
  expect(screen.getByText(/registro manual ·/)).toBeTruthy();
});

it("translates a custody receipt error and driver-app evidence in Spanish", async () => {
  env.language = "es";
  network({ capabilities: ["driver"] });
  const baseApi = env.api.getMockImplementation()!;
  let posted = false;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/custody/operations" && init?.method === "POST") { posted = true; return baseApi(path, init); }
    if (path === `/api/fleet/custody?assetId=${assetId}`) {
      if (posted) return { custody: [] };
      return Promise.resolve(baseApi(path, init)).then((value: any) => ({ custody: value.custody.map((row: any) => ({ ...row, observation: { ...row.observation, method: "driver_app" } })) }));
    }
    return baseApi(path, init);
  });
  render(<AssetWorkspace initialAssetId={assetId} initialRunId="50000000-0000-4000-8000-000000000001" />);
  fireEvent.click(await screen.findByRole("button", { name: "Registrar mi llegada" }));
  expect(screen.getByText(/aplicación del conductor ·/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar llegada" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("La lectura de custodia no coincide"));
});

it("lets a Yard-only worker receive an asset into a granted Fleet group", async () => {
  network({ capabilities: ["yard"] });
  const baseApi = env.api.getMockImplementation()!;
  const receivedId = "30000000-0000-4000-8000-000000000099";
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/yard-assets" && init?.method === "POST") return { assetId: receivedId };
    if (path === `/api/fleet/yard-assets?assetId=${receivedId}`) return { canManage: true, version: 2, fleets: [{ id: "80000000-0000-4000-8000-000000000001", name: "Assigned Fleet" }], nextCursor: null, assets: [{ id: receivedId, name: "New pump", manufacturer: "", model: "", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [{ kind: "asset_tag", value: "P-99" }], fleetIds: ["80000000-0000-4000-8000-000000000001"] }] };
    if (path === `/api/fleet/custody?assetId=${receivedId}`) return { custody: [] };
    return baseApi(path, init);
  });
  render(<AssetWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Receive new asset" }));
  fireEvent.change(screen.getByLabelText("Asset name"), { target: { value: "New pump" } });
  fireEvent.change(screen.getByLabelText("Legal owner"), { target: { value: "Example" } });
  fireEvent.change(screen.getByLabelText("Asset tag"), { target: { value: "P-99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save asset intake" }));
  await waitFor(() => expect(env.api.mock.calls.some(([path, init]) => path === "/api/fleet/yard-assets" && init?.method === "POST")).toBe(true));
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/yard-assets" && init?.method === "POST")![1].body);
  expect(body).toMatchObject({ fleetId: "80000000-0000-4000-8000-000000000001", asset: { name: "New pump", identifier: { value: "P-99" } } });
});

it.each([["Yard-only", ["yard"]], ["Driver + Yard", ["driver", "yard"]]])("selects a driver-free assembly Detail and reads back attachment for %s", async (_role, capabilities) => {
  network({ capabilities });
  const baseApi = env.api.getMockImplementation()!;
  const detailId = "60000000-0000-4000-8000-000000000001";
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/details") throw Object.assign(Error("Dispatcher Details only"), { status: 403 });
    if (path === `/api/fleet/yard-assembly-targets?assetId=${assetId}`) return { canManage: false, nextCursor: null, details: [{ id: detailId, companyId: 3, version: 1, name: "Rig Detail", vehicleAssetId: "70000000-0000-4000-8000-000000000001", rigPackageId: "70000000-0000-4000-8000-000000000002", rigPackageVersion: 1, driverUserId: null, accessGroupIds: ["80000000-0000-4000-8000-000000000001"], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null }] };
    return baseApi(path, init);
  });
  render(<AssetWorkspace initialAssetId={assetId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Attach rigging" }));
  fireEvent.click(screen.getByRole("button", { name: "Current Detail" }));
  fireEvent.click(await screen.findByRole("button", { name: "Rig Detail" }));
  fireEvent.click(screen.getByRole("button", { name: "Record custody" }));
  expect(await screen.findByText(/Location inherited from attached truck/)).toBeTruthy();
  const body = JSON.parse(env.api.mock.calls.find(([path, init]) => path === "/api/fleet/custody/operations" && init?.method === "POST")![1].body);
  expect(body.observation).toMatchObject({ assetId, state: "attached", detailId });
});
