import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ api: vi.fn(), generation: 1, listeners: new Set<() => void>(), push: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: env.generation }), isAuthScopeCurrent: (scope: any) => scope.generation === env.generation, subscribeUser: (fn: () => void) => { env.listeners.add(fn); return () => env.listeners.delete(fn); }, subscribeToken: () => () => {} }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", primary: "green", card: "gray", border: "gray", destructive: "red", mutedForeground: "silver" }) }));
vi.mock("expo-router", () => ({ router: { push: env.push } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, accessibilityLabel, onPress, disabled }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/components/SphereBackButton", () => ({ default: ({ onPress }: any) => <button onClick={onPress}>Back</button> }));
import FleetInventory, { FleetInventoryAddExisting } from "./FleetInventory";
const id = "10000000-0000-4000-8000-000000000001", nextId = "10000000-0000-4000-8000-000000000002";
const asset = { id, name: "Synthetic rig", manufacturer: "Example", model: "A", category: "truck", status: "available", version: 4, legalOwner: "Synthetic company", held: false, fleetIds: [], aliases: [{ kind: "asset_tag", value: "SYN-1" }], currentHolderUserId: null };
const inventory = { canManage: true, version: 2, fleets: [], assets: [asset], nextCursor: null };
const detail = { canManage: true, asset, history: [{ id: "h1", type: "registered", note: "Synthetic history", recordedAt: "2026-10-15T12:00:00Z" }], runs: [{ id: nextId, title: "Synthetic haul", status: "completed", ticketId: 7 }], maintenance: [{ id: "m1", status: "open", notes: "Synthetic inspection" }], historyLimited: false };
const receipt = { operationId: "30000000-0000-4000-8000-000000000001", assetId: id, version: 4, fleetVersion: 2, fingerprint: "synthetic" };
beforeEach(() => { env.generation = 1; env.api.mockImplementation(async path => path === `/api/fleet/inventory/${id}` ? detail : inventory); });
afterEach(() => { cleanup(); env.api.mockReset(); env.push.mockReset(); });
function create() {
  fireEvent.click(screen.getByRole("button", { name: "Add Fleet Asset" }));
  for (const [label, value] of [["Asset name / unit number", "New synthetic rig"], ["Legal owner", "Synthetic company"], ["Identifier", "NEW-1"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
describe("native canonical Fleet Inventory", () => {
  it("creates a canonical asset and fleet inclusion in one request without a Detail selector, then reads the saved asset", async () => {
    env.api.mockImplementation(async (path, init) => init?.method ? receipt : path.endsWith(id) ? detail : inventory);
    render(<FleetInventory identity="1:7" />);
    await screen.findByText(asset.name); create();
    expect(screen.queryByLabelText("Detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Fleet Asset" }));
    await screen.findByRole("button", { name: "History" });
    const request = env.api.mock.calls.find(c => c[1]?.method === "POST")!;
    expect(JSON.parse(request[1].body)).toEqual({ operationId: receipt.operationId, name: "New synthetic rig", category: "truck", manufacturer: "", model: "", legalOwner: "Synthetic company", identifier: { kind: "asset_tag", value: "NEW-1" } });
    expect(env.api.mock.calls.some(c => c[0] === `/api/fleet/inventory/${id}`)).toBe(true);
  });
  it("locks ambiguous creates and retries the same body and operation ID before canonical readback", async () => {
    let posts = 0;
    env.api.mockImplementation(async (path, init) => { if (init?.method) { if (++posts === 1) throw Object.assign(Error("offline"), { code: "network.unreachable" }); return receipt; } return path.endsWith(id) ? detail : inventory; });
    render(<FleetInventory identity="1:7" />); await screen.findByText(asset.name); create();
    fireEvent.click(screen.getByRole("button", { name: "Save Fleet Asset" }));
    const retry = await screen.findByRole("button", { name: "Retry save" });
    expect((screen.getByLabelText("Asset name / unit number") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(retry); await screen.findByRole("button", { name: "History" });
    const requests = env.api.mock.calls.filter(c => c[1]?.method === "POST");
    expect(requests).toHaveLength(2); expect(requests[1][1].body).toBe(requests[0][1].body);
  });
  it("preserves an unresolved create when a manual refresh also fails", async () => {
    let lists = 0, writes = 0;
    env.api.mockImplementation(async (path, init) => {
      if (init?.method) { if (++writes === 1) throw Error("Unknown write"); return receipt; }
      if (path.endsWith(id)) return detail;
      if (++lists === 2) throw Error("Refresh offline");
      return inventory;
    });
    render(<FleetInventory identity="1:7" />); await screen.findByText(asset.name); create();
    fireEvent.click(screen.getByRole("button", { name: "Save Fleet Asset" })); await screen.findByRole("button", { name: "Retry save" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Fleet Inventory could not be loaded. Refresh to check current access.");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" })); await screen.findByRole("button", { name: "History" });
    const requests = env.api.mock.calls.filter(c => c[1]?.method === "POST");
    expect(requests[0][1].body).toBe(requests[1][1].body);
  });
  it("uses the server asset revision to edit and exposes asset, run and maintenance history", async () => {
    env.api.mockImplementation(async (path, init) => init?.method === "PATCH" ? receipt : path.endsWith(id) ? detail : inventory);
    render(<FleetInventory identity="1:7" initialAssetId={id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Asset name / unit number"), { target: { value: "Edited rig" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(env.api.mock.calls.some(c => c[1]?.method === "PATCH")).toBe(true));
    const request = env.api.mock.calls.find(c => c[1]?.method === "PATCH")!;
    expect(JSON.parse(request[1].body)).toMatchObject({ expectedVersion: 4, name: "Edited rig", operationId: receipt.operationId });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Synthetic history")).toBeTruthy(); expect(screen.getByText("Synthetic inspection")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Synthetic haul" })); expect(env.push).toHaveBeenCalledWith(`/fleet-run/${nextId}`);
  });
  it("loads the next server page and searches identifiers across loaded pages", async () => {
    env.api.mockImplementation(async path => path.includes("after=") ? { ...inventory, assets: [{ ...asset, id: nextId, name: "Second rig", aliases: [{ kind: "vin", value: "SECONDVIN" }] }] } : { ...inventory, nextCursor: id });
    render(<FleetInventory identity="1:7" />); fireEvent.click(await screen.findByRole("button", { name: "Load more fleet assets" }));
    await screen.findByText("Second rig");
    fireEvent.change(screen.getByLabelText("Search fleet assets"), { target: { value: "SECONDVIN" } });
    expect(screen.queryByText(asset.name)).toBeNull(); expect(screen.getByText("Second rig")).toBeTruthy();
    expect(env.api.mock.calls.some(c => c[0] === `/api/fleet/inventory?after=${id}`)).toBe(true);
  });
  it("hides management when the server denies it and clears old data during an account change", async () => {
    env.api.mockResolvedValue({ ...inventory, canManage: false });
    render(<FleetInventory identity="1:7" />); await screen.findByText(asset.name);
    expect(screen.queryByRole("button", { name: "Add Fleet Asset" })).toBeNull();
    env.api.mockImplementation(() => new Promise(() => {}));
    act(() => { env.generation++; env.listeners.forEach(fn => fn()); });
    expect(screen.queryByText(asset.name)).toBeNull();
  });
  it("requires a fresh record after an edit conflict and uses its new revision", async () => {
    let version = 4, writes = 0;
    env.api.mockImplementation(async (path, init) => {
      if (init?.method === "PATCH") { if (++writes === 1) { version = 5; throw Object.assign(Error("Conflict"), { status: 409, code: "fleet.version_conflict" }); } return { ...receipt, version }; }
      return { ...detail, asset: { ...asset, version } };
    });
    render(<FleetInventory identity="1:7" initialAssetId={id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("This record changed. Refresh before preparing a new save.");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(env.api.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(2));
    expect(JSON.parse(env.api.mock.calls.filter(c => c[1]?.method === "PATCH")[1][1].body).expectedVersion).toBe(5);
  });
  it("does not publish a delayed save into a different account", async () => {
    let finish!: (value: unknown) => void;
    env.api.mockImplementation(async (_path, init) => init?.method ? new Promise(resolve => { finish = resolve; }) : inventory);
    const saved = vi.fn(); render(<FleetInventory identity="1:7" onSaved={saved} />);
    await screen.findByText(asset.name); create(); fireEvent.click(screen.getByRole("button", { name: "Save Fleet Asset" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    env.api.mockImplementation(() => new Promise(() => {}));
    await act(async () => { env.generation++; env.listeners.forEach(fn => fn()); finish(receipt); });
    expect(saved).not.toHaveBeenCalled(); expect(screen.queryByText(asset.name)).toBeNull();
    expect(env.api.mock.calls.some(c => c[0] === `/api/fleet/inventory/${id}`)).toBe(false);
  });
  it("keeps the exact enrollment retry when canonical readback is unavailable", async () => {
    let reads = 0;
    env.api.mockImplementation(async (path, init) => {
      if (init?.method) return receipt;
      if (path.endsWith(id)) { if (++reads === 1) throw Error("Readback unavailable"); return detail; }
      return inventory;
    });
    const saved = vi.fn(); render(<FleetInventoryAddExisting identity="vendor:7" asset={asset} onSaved={saved} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to Fleet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const requests = env.api.mock.calls.filter(c => c[1]?.method === "POST");
    expect(requests).toHaveLength(2); expect(requests[0][1].body).toBe(requests[1][1].body);
  });
  it("enrolls the existing canonical Inventory asset with no assignment selector or duplicate create", async () => {
    env.api.mockImplementation(async (path, init) => init?.method ? receipt : path.endsWith(id) ? detail : inventory);
    const saved = vi.fn(); render(<FleetInventoryAddExisting identity="vendor:7" asset={asset} onSaved={saved} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to Fleet" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const request = env.api.mock.calls.find(c => c[1]?.method === "POST")!;
    expect(request[0]).toBe(`/api/fleet/inventory/${id}/enroll`);
    expect(JSON.parse(request[1].body)).toEqual({ operationId: receipt.operationId, expectedVersion: 4 });
    expect(screen.queryByLabelText("Detail")).toBeNull();
  });
  it.each(["radio", "retired", "denied"])("does not offer enrollment for %s", async value => {
    if (value === "denied") env.api.mockResolvedValue({ ...inventory, canManage: false });
    render(<FleetInventoryAddExisting identity="vendor:7" asset={{ ...asset, ...(value === "radio" ? { category: value } : value === "retired" ? { status: value } : {}) }} onSaved={vi.fn()} />);
    await act(async () => {}); expect(screen.queryByRole("button", { name: "Add to Fleet" })).toBeNull();
  });
});
