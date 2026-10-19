import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  inventory: vi.fn(),
  inventoryAsset: vi.fn(),
  createAsset: vi.fn(),
  editAsset: vi.fn(),
  enrollAsset: vi.fn(),
  navigate: vi.fn(),
  details: vi.fn(),
  rigPackages: vi.fn(),
  overview: vi.fn(),
  resources: vi.fn(),
  saveDetail: vi.fn(),
}));
vi.mock("@/lib/fleet-client", async () => {
  const actual = await vi.importActual<object>("@/lib/fleet-client");
  return { ...actual, fleetClient: api };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/fleet/equipment", api.navigate],
  Link: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
import {
  FleetInventoryPage,
  FleetInventoryAddExisting,
} from "./fleet-inventory";
const fleet = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222";
const asset = {
  id: assetId,
  name: "Hauling unit 12",
  category: "truck",
  manufacturer: "Synthetic make",
  model: "T12",
  legalOwner: "Synthetic Hauler",
  status: "available",
  held: false,
  fleetIds: [fleet],
  aliases: [{ kind: "asset_tag", value: "UNIT12" }],
  version: 1,
  currentHolderUserId: null,
};
const list = {
  canManage: true,
  version: 4,
  fleets: [{ id: fleet, name: "North fleet" }],
  assets: [asset],
  nextCursor: null,
};
const mount = (node: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  api.inventory.mockResolvedValue(list);
  api.inventoryAsset.mockResolvedValue({
    canManage: true,
    asset,
    history: [
      {
        id: "e1",
        type: "registered",
        note: "Added",
        recordedAt: "2026-10-15T12:00:00Z",
      },
    ],
    runs: [],
    maintenance: [],
    historyLimited: false,
  });
});
describe("Fleet Inventory", () => {
  it("opens the reusable Details builder from the same Inventory page", async () => {
    api.details.mockResolvedValue({
      details: [],
      nextCursor: null,
      canManage: true,
    });
    api.rigPackages.mockResolvedValue({ rigPackages: [], nextCursor: null });
    api.overview.mockResolvedValue({
      companyId: 7,
      fleets: [
        { id: fleet, name: "North access", equipmentAssetIds: [assetId] },
      ],
    });
    api.resources.mockResolvedValue({
      equipment: [{ ...asset, dispatchable: true }],
      drivers: [{ userId: 2, name: "Bob Villa", fleetIds: [fleet] }],
    });
    mount(<FleetInventoryPage identity="company7" />);
    fireEvent.click(await screen.findByRole("button", { name: "Details" }));
    expect(await screen.findByLabelText("Detail name")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Bob Villa/ })).toBeTruthy();
  });
  it("opens a canonical fleet asset from its branded card", async () => {
    mount(<FleetInventoryPage identity="company7" />);
    expect(
      (
        await screen.findByRole("link", { name: "Open asset: Hauling unit 12" })
      ).getAttribute("href"),
    ).toBe(`/fleet/equipment/${assetId}`);
    fireEvent.change(screen.getByLabelText("Search fleet assets"), {
      target: { value: "missing" },
    });
    expect(
      screen.queryByRole("link", { name: "Open asset: Hauling unit 12" }),
    ).toBeNull();
  });
  it("automatically includes a newly created asset, with an exact retry after a lost response", async () => {
    api.createAsset
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce({ assetId });
    mount(<FleetInventoryPage identity="company7" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Fleet Asset" }),
    );
    fireEvent.change(screen.getByLabelText("Asset name / unit number"), {
      target: { value: "Unit 99" },
    });
    fireEvent.change(screen.getByLabelText("Legal owner"), {
      target: { value: "Synthetic Hauler" },
    });
    fireEvent.change(screen.getByLabelText("Identifier", { exact: true }), {
      target: { value: "UNIT99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Fleet Asset" }));
    await screen.findByText(/Save was not confirmed/);
    const first = api.createAsset.mock.calls[0][0];
    expect(first.fleetId).toBeUndefined();
    expect(first).toMatchObject({ category: "truck", name: "Unit 99" });
    expect(
      screen.getByLabelText("Asset name / unit number").closest("fieldset")
        ?.disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() =>
      expect(api.navigate).toHaveBeenCalledWith(`/fleet/equipment/${assetId}`),
    );
    expect(api.createAsset.mock.calls[1][0]).toEqual(first);
  });
  it("keeps read-only viewers out of create and edit", async () => {
    api.inventory.mockResolvedValue({ ...list, canManage: false });
    mount(<FleetInventoryPage identity="driver" />);
    await screen.findByRole("link", { name: "Open asset: Hauling unit 12" });
    expect(
      screen.queryByRole("button", { name: "Add Fleet Asset" }),
    ).toBeNull();
  });
  it("opens details, editable fields and history for the same asset", async () => {
    mount(<FleetInventoryPage identity="company7" assetId={assetId} />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    expect(
      screen.getByText("Registered in Inventory and Fleet Inventory"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(
      (screen.getByLabelText("Asset name / unit number") as HTMLInputElement)
        .value,
    ).toBe("Hauling unit 12");
    api.editAsset.mockResolvedValue({ assetId });
    fireEvent.change(screen.getByLabelText("Asset name / unit number"), {
      target: { value: "Updated unit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.editAsset).toHaveBeenCalledWith(
        assetId,
        expect.objectContaining({ name: "Updated unit", expectedVersion: 1 }),
      ),
    );
  });
  it("adds an existing Inventory record using its id instead of registering a duplicate", async () => {
    api.enrollAsset.mockResolvedValue({ assetId });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    mount(
      <FleetInventoryAddExisting
        identity="company7"
        asset={asset}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Fleet Asset" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api.enrollAsset).toHaveBeenCalledWith(
      assetId,
      expect.objectContaining({ expectedVersion: 1 }),
    );
    expect(api.createAsset).not.toHaveBeenCalled();
  });
  it("reuses the committed enrollment operation when the following refresh fails", async () => {
    api.enrollAsset.mockResolvedValue({ assetId });
    const onSaved = vi
      .fn()
      .mockRejectedValueOnce(new Error("Refresh unavailable"))
      .mockResolvedValueOnce(undefined);
    mount(
      <FleetInventoryAddExisting
        identity="company7"
        asset={asset}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Fleet Asset" }),
    );
    await screen.findByText(/Save was not confirmed/);
    const original = api.enrollAsset.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await screen.findByText("Added to Fleet Inventory");
    expect(api.enrollAsset.mock.calls[1][1]).toEqual(original);
  });
});
