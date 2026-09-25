import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesInventory } from "./FilesInventory";

vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, accessibilityLabel, onPress }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "white", text: "black", mutedForeground: "gray", border: "gray", primary: "blue" }) }));
const network = vi.hoisted(() => ({ pick: vi.fn(), api: vi.fn(), digest: vi.fn() }));
vi.mock("@/lib/meeting-files", () => ({ pickMeetingFile: network.pick }));
vi.mock("@/lib/api", () => ({ apiFetch: network.api, getApiBase: () => "https://example.test" }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", downloadAsync: vi.fn(), deleteAsync: vi.fn() }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: network.digest }));

const owner = { type: "vendor" as const, id: 7 };
const records = {
  files: [{ id: "file-1", data: { name: "Gate log.pdf", scope: "company", currentFileId: "version-1", state: "active" }, createdBy: 12, updatedAt: "2026-09-24T12:00:00Z", capabilities: { canDownload: true, canManage: false } }],
  notes: [{ id: "note-1", channelId: "channel-1", title: "Shift notes", body: "Handoff", version: 1, createdById: 12, createdAt: "2026-09-24T12:00:00Z", capabilities: { canEdit: false } }],
  assets: [{ id: "asset-1", name: "Radio 4", category: "Radio", status: "available", condition: "good", currentHolderDisplayName: null, currentLocation: "Gate A", hold: null }],
};
const caps = { canUploadFile: true, canCreateNote: true, canEditNote: true, canCreateAsset: false, canManageAsset: false, canCheckOutAsset: true, canVerifyIssuedAsset: true, canViewExports: false, allowedExportDatasets: [], canManageGateLocations: false };
afterEach(() => { cleanup(); network.pick.mockReset(); network.api.mockReset(); network.digest.mockReset(); });

describe("Files & Inventory", () => {
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

  it("shows a custody conflict instead of claiming checkout succeeded", async () => {
    network.api.mockResolvedValueOnce({ status: "conflict", code: "asset.already_checked_out", version: 2 });
    render(<FilesInventory owner={owner} capabilities={caps} {...records} assets={[{ ...records.assets[0], version: 1 }]} channels={[]} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    expect((await screen.findByRole("alert")).textContent).toContain("asset.already_checked_out");
    expect(screen.queryByText("Equipment checked out.")).toBeNull();
  });
});
