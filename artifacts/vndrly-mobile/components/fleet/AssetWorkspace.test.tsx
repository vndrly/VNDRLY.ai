import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ api: vi.fn(), uuid: 0 }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `90000000-0000-4000-8000-${String(++env.uuid).padStart(12, "0")}` }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", mutedForeground: "silver", card: "#222", border: "#555", primary: "#137c49", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
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
    if (path === "/api/fleet/inventory") return { canManage: true, version: 1, fleets: [], nextCursor: null, assets: assetMissingFromPage ? [] : [{ id: assetId, name: "Pump 4", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [], fleetIds: [] }] };
    if (path === `/api/fleet/inventory/${assetId}`) return { canManage: true, asset: { id: assetId, name: "Pump 4", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [], fleetIds: [] }, history: [], runs: [], maintenance: [], historyLimited: false };
    if (path === "/api/fleet/custody") return { custody: [{ version, observation, location: { yardId: observation.yardId, inheritedFromAssetId: observation.state === "attached" ? "70000000-0000-4000-8000-000000000001" : null } }] };
    if (path === "/api/fleet/custody/operations" && init?.method === "POST") {
      const body = JSON.parse(init.body!); observation = { ...body.observation, id: observation.id }; version++;
      return { operationId: body.operationId, version, observation };
    }
    throw Error(`Unexpected ${path}`);
  });
}
afterEach(() => { cleanup(); env.api.mockReset(); env.uuid = 0; });

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
