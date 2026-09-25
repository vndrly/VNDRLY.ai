import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesInventory } from "./FilesInventory";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import canonicalSummary from "../../../api-server/src/test-fixtures/asset-summary.json";

const env = vi.hoisted(() => ({
  generation: 1, api: vi.fn(), raw: vi.fn(), pick: vi.fn(), put: vi.fn(), share: vi.fn(), available: vi.fn(),
  legacyDownload: vi.fn(), legacyDelete: vi.fn(async () => undefined),
  files: new Map<string, Uint8Array>(), removed: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, apiFetchRaw: env.raw, getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({
  getToken: async () => "token",
  captureAuthScope: () => ({ generation: env.generation }),
  isAuthScopeCurrent: (scope: { generation: number }) => scope.generation === env.generation,
  subscribeUser: (listener: () => void) => { env.listeners.add(listener); return () => env.listeners.delete(listener); }, subscribeToken: () => () => {},
}));
vi.mock("@/lib/meeting-files", async (original) => ({ ...await original<any>(), pickMeetingFile: env.pick }));
vi.mock("@/lib/photos", () => ({ captureAndUploadImage: vi.fn() }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "white", text: "black", mutedForeground: "gray", border: "gray", primary: "blue" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, accessibilityLabel, onPress, disabled }: any) => <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button> }));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: async (_algorithm: string, bytes: ArrayBuffer) => new Uint8Array([new Uint8Array(bytes).reduce((a, b) => a + b, 0)]).buffer }));
vi.mock("expo/fetch", () => ({ fetch: env.put }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" }, Directory: class {},
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join("/"); }
    create() { env.files.set(this.uri, new Uint8Array()); }
    write(bytes: Uint8Array) { env.files.set(this.uri, new Uint8Array(bytes)); }
    delete() { env.files.delete(this.uri); env.removed.push(this.uri); }
  },
}));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", downloadAsync: env.legacyDownload, deleteAsync: env.legacyDelete }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: env.available, shareAsync: env.share }));

const nativeId = "10101010-1010-4010-8010-101010101010";
const owner = { type: "vendor" as const, id: 7 };
const channel = { id: "channel-1", name: "Partner gate", ownerOrgType: "partner" as const, ownerOrgId: 9, contextKind: "site" as const, contextId: "33" };
const caps = { canUploadFile: true, canCreateNote: true, canEditNote: true, canCreateAsset: false, canManageAsset: false, canCheckOutAsset: true, canVerifyIssuedAsset: true, canViewExports: false, allowedExportDatasets: [], canManageGateLocations: false };
const file = { id: "private-file", data: { name: "../permit.pdf", contentType: "application/pdf", byteSize: 3, currentFileId: "version-1" }, capabilities: { canDownload: true, canManage: false } };
const props = { owner, capabilities: caps, channels: [channel], files: [file], notes: [], assets: [], onRefresh: vi.fn() };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function beginNote() {
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  fireEvent.click(screen.getByRole("button", { name: "Use Partner gate" }));
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Night shift" } });
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Crew checked in" } });
}
beforeEach(async () => {
  await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  env.generation = 1; env.files.clear(); env.removed = [];
  (globalThis.expo as any).uuidv4 = () => nativeId;
  env.share.mockResolvedValue(undefined);
  env.available.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); env.api.mockReset(); env.raw.mockReset(); env.put.mockReset(); env.pick.mockReset(); });

describe("native Files & Inventory boundaries", () => {
  it("renders the canonical API custodian separately and confirms custody without browser UUIDs", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw new Error("Browser UUID unavailable"); });
    env.api.mockResolvedValue({ status: "applied" });
    render(<FilesInventory {...props} assets={[canonicalSummary]} />);
    expect(screen.getByText("Held by User 11")).toBeTruthy();
    expect(screen.queryByText("user:11")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Verify issued Issued radio" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
    await screen.findByText("Custody updated.");
    expect(JSON.parse(env.api.mock.calls[0]![1].body).operationId).toBe(nativeId);
  });
  it("creates a shared partner note with the native UUID and channel owner/context", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw new Error("Browser UUID unavailable"); });
    env.api.mockResolvedValue({});
    render(<FilesInventory {...props} />); beginNote();
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    await screen.findByText("Note added.");
    expect(JSON.parse(env.api.mock.calls[0]![1].body)).toMatchObject({ operationId: nativeId, owner: { type: "partner", id: 9 }, context: { kind: "site", id: "33" }, payload: { title: "Night shift", body: "Crew checked in" } });
  });
  it("replays a note attempt after a lost response instead of storing a second note", async () => {
    let ids = 1;
    (globalThis.expo as any).uuidv4 = () => `10101010-1010-4010-8010-${String(ids++).padStart(12, "0")}`;
    const stored = new Map<string, unknown>();
    env.api.mockImplementation(async (_path, init) => { const body = JSON.parse(init.body); const replay = stored.has(body.operationId); stored.set(body.operationId, body); if (!replay) throw new Error("Response lost"); return {}; });
    render(<FilesInventory {...props} />); beginNote();
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    await screen.findByText("Response lost");
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    await waitFor(() => expect(env.api).toHaveBeenCalledTimes(2));
    expect(stored.size).toBe(1);
    await screen.findByText("Note added.");
  });
  it("edits a shared note under the channel owner and starts a new command when the draft changes", async () => {
    let sequence = 0;
    (globalThis.expo as any).uuidv4 = () => `10101010-1010-4010-8010-${String(++sequence).padStart(12, "0")}`;
    env.api.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue({});
    const note = { id: "note-1", channelId: channel.id, title: "Old title", body: "Old body", version: 3, createdById: 1, createdAt: "2026-09-24T00:00:00Z", capabilities: { canEdit: true } };
    render(<FilesInventory {...props} notes={[note]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Old title" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    await screen.findByText("Response lost");
    fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Deliberately revised" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    await screen.findByText("Note updated.");
    const [first, second] = env.api.mock.calls.map(call => JSON.parse(call[1].body));
    expect(first).toMatchObject({ owner: { type: "partner", id: 9 }, context: { kind: "site", id: "33" }, expectedVersion: 3 });
    expect(second.operationId).not.toBe(first.operationId);
    expect(second.payload.body).toBe("Deliberately revised");
    expect(env.api.mock.calls[1]![1].method).toBe("PATCH");
  });
  it("uploads original bytes with Expo transport and resumes reserve/finalize using stable identities", async () => {
    let sequence = 0;
    (globalThis.expo as any).uuidv4 = () => `10101010-1010-4010-8010-${String(++sequence).padStart(12, "0")}`;
    vi.stubGlobal("Blob", class { constructor() { throw new Error("Native Blob rejects ArrayBuffer"); } });
    env.pick.mockResolvedValue({ id: "picked", name: "permit.pdf", type: "application/pdf", size: 3, bytes: new Uint8Array([99, 1, 2, 3, 99]).subarray(1, 4) });
    const commands = { reserve: [] as any[], finalize: [] as any[] };
    env.api.mockImplementation(async (path, init) => {
      const body = JSON.parse(init.body);
      if (body.context.kind !== "organization" || body.context.id !== 9) throw new Error("Owner context mismatch");
      if (path.endsWith("/reserve")) { commands.reserve.push(body); if (commands.reserve.length === 1) throw new Error("Reserve response lost"); return { resource: { documentId: "document-1", fileId: "file-1", uploadURL: "https://storage.test/upload", owner: { type: "partner", id: 9 } } }; }
      commands.finalize.push(body); if (commands.finalize.length === 1) throw new Error("Finalize response lost"); return {};
    });
    env.put.mockImplementation(async (_url, init) => { expect(env.files.get(init.body.uri)).toEqual(new Uint8Array([1, 2, 3])); expect(init.headers["Content-Type"]).toBe("application/pdf"); return { ok: true }; });
    render(<FilesInventory {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload File" })); await screen.findByText("Reserve response lost");
    fireEvent.click(screen.getByRole("button", { name: "Upload File" })); await screen.findByText("Finalize response lost");
    fireEvent.click(screen.getByRole("button", { name: "Upload File" })); await screen.findByText("permit.pdf: finalized and private.");
    expect(commands.reserve[0]).toEqual(commands.reserve[1]); expect(commands.finalize[0]).toEqual(commands.finalize[1]);
    expect(commands.reserve[0]).toMatchObject({ owner: { type: "partner", id: 9 }, payload: { checksumSha256: "06", byteSize: 3, contentType: "application/pdf", scope: "channel", channelId: "channel-1" } });
    expect(commands.finalize[0].owner).toEqual({ type: "partner", id: 9 });
    expect(commands.finalize[0].operationId).not.toBe(commands.reserve[0].operationId);
    expect(env.pick).toHaveBeenCalledOnce(); expect(env.put).toHaveBeenCalledOnce(); expect(env.files.size).toBe(0);
  });
  it.each(["logout", "owner", "unmount"])("does not share a private download after %s", async (change) => {
    const bytes = deferred<ArrayBuffer>(); const downloaded = deferred<any>();
    env.raw.mockResolvedValue({ headers: new Headers({ "content-length": "3", "content-type": "application/pdf" }), arrayBuffer: () => bytes.promise });
    env.legacyDownload.mockReturnValue(downloaded.promise);
    const view = render(<FilesInventory {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Open ../permit.pdf" }));
    await waitFor(() => expect(env.raw.mock.calls.length + env.legacyDownload.mock.calls.length).toBe(1));
    if (change === "logout") env.generation++;
    if (change === "owner") view.rerender(<FilesInventory {...props} owner={{ type: "vendor", id: 8 }} />);
    if (change === "unmount") view.unmount();
    await act(async () => { bytes.resolve(new Uint8Array([1, 2, 3]).buffer); downloaded.resolve({ status: 200 }); });
    expect(env.share).not.toHaveBeenCalled(); expect(env.files.size).toBe(0);
  });
  it.each(["logout", "owner", "unmount"])("immediately deletes a prepared private file after %s before the share sheet opens", async (change) => {
    const ready = deferred<boolean>(); env.available.mockReturnValueOnce(ready.promise);
    env.raw.mockResolvedValue({ headers: new Headers({ "content-length": "3", "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const view = render(<FilesInventory {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Open ../permit.pdf" }));
    await waitFor(() => expect(env.files.size).toBe(1));
    if (change === "logout") act(() => { env.generation++; for (const listener of env.listeners) listener(); });
    if (change === "owner") view.rerender(<FilesInventory {...props} owner={{ type: "vendor", id: 8 }} />);
    if (change === "unmount") view.unmount();
    expect(env.files.size).toBe(0);
    await act(async () => { ready.resolve(true); });
    expect(env.share).not.toHaveBeenCalled(); expect(env.files.size).toBe(0);
  });
});
