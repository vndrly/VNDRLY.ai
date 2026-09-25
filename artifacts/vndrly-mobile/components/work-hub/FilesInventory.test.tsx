import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesInventory } from "./FilesInventory";

vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, accessibilityLabel, onPress }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "white", text: "black", mutedForeground: "gray", border: "gray", primary: "blue" }) }));
const network = vi.hoisted(() => ({ pick: vi.fn(), api: vi.fn(), digest: vi.fn() }));
const photos = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/photos", () => ({ captureAndUploadImage: photos.capture }));
vi.mock("@/lib/meeting-files", () => ({ pickMeetingFile: network.pick }));
vi.mock("@/lib/api", () => ({ apiFetch: network.api, getApiBase: () => "https://example.test" }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", downloadAsync: vi.fn(), deleteAsync: vi.fn() }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: network.digest }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => {
  const labels: Record<string, string> = {
    "filesInventory.filesNotes": "Files & Notes", "filesInventory.inventory": "Inventory",
    "filesInventory.uploadFile": "Upload File", "filesInventory.addNote": "Add Note",
    "filesInventory.reservedNotice": "{{name}}: reserved. Uploading…",
    "filesInventory.finalizedNotice": "{{name}}: finalized and private.",
    "filesInventory.checkOutNamed": "Check out {{name}}",
    "filesInventory.returnNamed": "Return {{name}}",
    "filesInventory.confirm.checkout": "Confirm checkout",
    "filesInventory.expectedReturn": "Expected return",
    "filesInventory.addEvidencePhoto": "Add evidence photo",
  };
  return (labels[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(values?.[name] ?? ""));
} }) }));

const owner = { type: "vendor" as const, id: 7 };
const records = {
  files: [{ id: "file-1", data: { name: "Gate log.pdf", scope: "company", currentFileId: "version-1", state: "active" }, createdBy: 12, updatedAt: "2026-09-24T12:00:00Z", capabilities: { canDownload: true, canManage: false } }],
  notes: [{ id: "note-1", channelId: "channel-1", title: "Shift notes", body: "Handoff", version: 1, createdById: 12, createdAt: "2026-09-24T12:00:00Z", capabilities: { canEdit: false } }],
  assets: [{ id: "asset-1", name: "Radio 4", category: "Radio", status: "available", condition: "good", version: 1, holderUserId: null, currentHolderDisplayName: null, currentLocation: "Gate A", hold: null, policy: { photosRequiredOnCheckout: false, photosRequiredOnReturn: false, expectedReturnRequired: false, supervisorApprovalRequired: false }, capabilities: { canCheckOut: true, canReturn: false, canVerifyIssued: false } }],
};
const caps = { canUploadFile: true, canCreateNote: true, canEditNote: true, canCreateAsset: false, canManageAsset: false, canCheckOutAsset: true, canVerifyIssuedAsset: true, canViewExports: false, allowedExportDatasets: [], canManageGateLocations: false };
afterEach(() => { cleanup(); network.pick.mockReset(); network.api.mockReset(); network.digest.mockReset(); photos.capture.mockReset(); });

describe("Files & Inventory", () => {
  it("lands on the exact inventory asset from a search destination", () => {
    render(<FilesInventory owner={owner} capabilities={caps} {...records} assets={[...records.assets, { ...records.assets[0], id: "asset-2", name: "Radio 5" }]} channels={[]} onRefresh={vi.fn()} selectedAssetId="asset-1" />);
    expect(screen.getByText("Radio 4")).toBeTruthy();
    expect(screen.queryByText("Radio 5")).toBeNull();
    expect(screen.queryByText("Gate log.pdf")).toBeNull();
  });
  it("shows both cards and permitted creation actions", () => {
    render(<FilesInventory owner={owner} capabilities={caps} {...records} channels={[{ id: "channel-1", name: "Gate A" }]} onRefresh={vi.fn()} />);
    expect(screen.getByText("Files & Notes")).toBeTruthy();
    expect(screen.getByText("Inventory")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload File" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Note" })).toBeTruthy();
    expect(screen.getByText("Gate log.pdf")).toBeTruthy();
    expect(screen.getByText("Shift notes")).toBeTruthy();
    expect(screen.getByText("Radio 4")).toBeTruthy();
  });

  it("keeps records visible without mutation actions for read-only access", () => {
    render(<FilesInventory owner={owner} capabilities={{ ...caps, canUploadFile: false, canCreateNote: false, canCheckOutAsset: false, canVerifyIssuedAsset: false }} {...records} channels={[]} onRefresh={vi.fn()} />);
    expect(screen.getByText("Gate log.pdf")).toBeTruthy();
    expect(screen.getByText("Shift notes")).toBeTruthy();
    expect(screen.getByText("Radio 4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload File" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Note" })).toBeNull();
  });

  it("distinguishes reserved, uploaded, and finalized file states", async () => {
    network.pick.mockResolvedValue({ name: "permit.pdf", type: "application/pdf", size: 2, bytes: new Uint8Array([1, 2]) });
    network.digest.mockResolvedValue(new Uint8Array(32).buffer);
    network.api.mockResolvedValueOnce({ resource: { documentId: "document-1", fileId: "file-1", uploadURL: "https://example.test/upload" } }).mockResolvedValueOnce({ resource: {} });
    let uploaded!: (response: { ok: boolean }) => void;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => new Promise(resolve => { uploaded = resolve as typeof uploaded; })) as typeof fetch;
    try {
      render(<FilesInventory owner={owner} capabilities={caps} {...records} channels={[{ id: "channel-1", name: "Gate A" }]} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Upload File" }));
      expect(await screen.findByText(/permit.pdf: reserved/)).toBeTruthy();
      expect(JSON.parse(network.api.mock.calls[0][1].body).payload).toMatchObject({ scope: "channel", channelId: "channel-1" });
      uploaded({ ok: true });
      expect(await screen.findByText(/permit.pdf: finalized and private/)).toBeTruthy();
    } finally { globalThis.fetch = originalFetch; }
  });

  it("offers policy-aware checkout with evidence, expected return, and the asset version", async () => {
    const onRefresh = vi.fn();
    photos.capture.mockResolvedValue({ objectPath: "/objects/uploads/radio.jpg" });
    network.api.mockResolvedValue({ status: "applied" });
    render(<FilesInventory owner={owner} capabilities={caps} {...records} assets={[{ ...records.assets[0], version: 1 }]} channels={[]} onRefresh={vi.fn()} />);
    expect(screen.getByText("Radio 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    expect(screen.getByRole("button", { name: "Confirm checkout" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    expect(await screen.findByText("filesInventory.custodyApplied")).toBeTruthy();
    expect(JSON.parse(network.api.mock.calls[0][1].body)).toMatchObject({ expectedVersion: 1, condition: "good", confirmed: true, photos: [] });
    expect(JSON.parse(network.api.mock.calls[0][1].body).operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires policy photos and expected return before checkout", async () => {
    photos.capture.mockResolvedValue({ objectPath: "/objects/uploads/radio.jpg" });
    network.api.mockResolvedValue({ status: "applied" });
    render(<FilesInventory owner={owner} capabilities={caps} {...records} assets={[{ ...records.assets[0], policy: { ...records.assets[0].policy, photosRequiredOnCheckout: true, expectedReturnRequired: true } }]} channels={[]} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    expect(network.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add evidence photo" }));
    expect(await screen.findByText("filesInventory.photoAdded")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Expected return"), { target: { value: "2026-10-01T12:00:00Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    expect(await screen.findByText("filesInventory.custodyApplied")).toBeTruthy();
    expect(JSON.parse(network.api.mock.calls[0][1].body)).toMatchObject({ expectedReturnAt: "2026-10-01T12:00:00.000Z", photos: ["https://example.test/api/storage/objects/uploads/radio.jpg"] });
  });

  it("refreshes the asset after an optimistic conflict", async () => {
    const onRefresh = vi.fn();
    network.api.mockResolvedValue({ status: "conflict", code: "asset.version_conflict" });
    render(<FilesInventory owner={owner} capabilities={caps} {...records} channels={[]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    expect(await screen.findByText("filesInventory.assetChanged")).toBeTruthy();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps actions hidden for read-only access", () => {
    render(<FilesInventory owner={owner} capabilities={{ ...caps, canCheckOutAsset: false, canVerifyIssuedAsset: false }} {...records} channels={[]} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Check out Radio 4" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return Radio 4" })).toBeNull();
  });

  it("uses a private personal upload when no channel is available", async () => {
    network.pick.mockResolvedValue({ name: "private.pdf", type: "application/pdf", size: 2, bytes: new Uint8Array([1, 2]) });
    network.digest.mockResolvedValue(new Uint8Array(32).buffer);
    network.api.mockResolvedValueOnce({ resource: { documentId: "document-2", fileId: "file-2", uploadURL: "https://example.test/upload" } }).mockResolvedValueOnce({ resource: {} });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    try {
      render(<FilesInventory owner={owner} capabilities={caps} {...records} channels={[]} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Upload File" }));
      expect(await screen.findByText(/private.pdf: finalized and private/)).toBeTruthy();
      expect(JSON.parse(network.api.mock.calls[0][1].body).payload).toMatchObject({ scope: "personal" });
    } finally { globalThis.fetch = originalFetch; }
  });
});
