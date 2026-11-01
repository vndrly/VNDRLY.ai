import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ api: vi.fn(), refetch: vi.fn(), manage: false, held: false, parent: null as string | null, uuid: 0, cataloguePhotos: [] as string[], photoRequired: false }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, getApiBase: () => "https://vndrly.ai" }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true, subscribeUser: () => () => {}, subscribeToken: () => () => {}, getToken: async () => "synthetic" }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", primary: "blue", border: "gray", mutedForeground: "gray" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++env.uuid).padStart(12, "0")}` }));
vi.mock("expo-location", () => ({}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("@/lib/photos", () => ({ captureAndUploadImage: vi.fn(), uploadAsset: vi.fn() }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/components/FleetChoiceField", () => ({ default: ({ label, value, options, onChange, disabled }: any) => <select aria-label={label} disabled={disabled} value={value} onChange={e => onChange(e.target.value)}>{options.map((o: any) => <option key={o.id} value={o.id}>{o.label}</option>)}</select> }));
vi.mock("@/lib/equipment", async () => { const actual = await vi.importActual<any>("@/lib/equipment"); return { ...actual, useEquipmentData: () => ({ data: { equipment: [asset()] }, refetch: env.refetch, isLoading: false }) }; });
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7 } }) }));
function asset() { return { id: "10000000-0000-4000-8000-000000000001", name: "Test booth", category: "booth", legalOwner: "Synthetic company", status: "available", version: 4, holderUserId: env.held ? 7 : null, currentHolderDisplayName: null, aliases: [], profile: { equipmentType: "booth", trackOnMap: true, photoUrls: env.cataloguePhotos, assignedUserId: null, ticketId: null, taskId: null, parentAssetId: env.parent, activity: "in_yard", location: null, history: [] }, location: null, holds: [], policy: { photosRequiredOnCheckout: env.photoRequired, photosRequiredOnReturn: false, expectedReturnRequired: false, supervisorApprovalRequired: false }, capabilities: { canManage: env.manage, canCheckout: !env.held, canReturn: env.held, canOperate: true } }; }
import EquipmentWorkbench from "./EquipmentWorkbench";
import { captureAndUploadImage } from "@/lib/photos";
beforeEach(() => { env.uuid = 0; env.manage = false; env.held = false; env.parent = null; env.cataloguePhotos = []; env.photoRequired = false; env.refetch.mockResolvedValue({}); env.api.mockImplementation(async (path: string, init?: any) => init?.method ? asset() : { people: [{ id: 9, label: "Worker" }], tickets: [{ id: 11, label: "Job 11" }], tasks: [], sites: [] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("native shared equipment", () => {
  it("submits newly captured custody photos using the backend's canonical relative route", async () => {
    const objectPath = "/objects/uploads/10000000-0000-4000-8000-000000000099";
    vi.mocked(captureAndUploadImage).mockResolvedValueOnce({ objectPath, contentType: "image/jpeg", size: 100 });
    render(<EquipmentWorkbench />); fireEvent.click(screen.getByRole("button", { name: "Open equipment Test booth" }));
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByLabelText("Equipment photo");
    await waitFor(() => expect((screen.getByRole("button", { name: "Check out for my job" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Check out for my job" }));
    await waitFor(() => expect(env.api.mock.calls.some(call => call[1]?.method)).toBe(true));
    const body = JSON.parse(env.api.mock.calls.find(call => call[1]?.method)![1].body);
    expect(body.photos).toEqual([`/api/storage${objectPath}`]);
    expect(body.photos[0]).toMatch(/^\/api\/storage\/objects\/uploads\/[0-9a-f-]{36}$/i);
  });
  it("does not reuse catalogue photos as fresh required custody evidence", async () => {
    env.cataloguePhotos = ["/api/storage/objects/uploads/10000000-0000-4000-8000-000000000098"]; env.photoRequired = true;
    render(<EquipmentWorkbench />); fireEvent.click(screen.getByRole("button", { name: "Open equipment Test booth" }));
    fireEvent.click(screen.getByRole("button", { name: "Check out for my job" }));
    await screen.findAllByText("Add the required condition photo.");
    expect(env.api.mock.calls.some(call => call[1]?.method)).toBe(false);
  });
  it("lets a worker check equipment out for a job without assigning a Fleet trip or another person", async () => {
    render(<EquipmentWorkbench />); fireEvent.click(screen.getByRole("button", { name: "Open equipment Test booth" }));
    expect(screen.queryByLabelText("Assign to person")).toBeNull();
    await waitFor(() => expect(screen.getByRole("option", { name: "Job 11" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Job ticket"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Check out for my job" }));
    await waitFor(() => expect(env.api.mock.calls.some(call => call[1]?.method === "POST")).toBe(true));
    const [path, init] = env.api.mock.calls.find(call => call[1]?.method === "POST")!;
    expect(path).toBe(`/api/equipment/${asset().id}/operations`);
    expect(JSON.parse(init.body)).toMatchObject({ action: "checkout", ticketId: 11, expectedVersion: 4 });
    expect(JSON.parse(init.body)).not.toHaveProperty("assignedUserId");
    expect(env.api.mock.calls.some(call => call[0].includes("fleet"))).toBe(false);
  });
  it("retries an uncertain check-in with the same operation and version", async () => {
    env.held = true; let attempts = 0; env.api.mockImplementation(async (_path: string, init?: any) => { if (init?.method) { attempts++; if (attempts === 1) throw Error("Connection lost"); return asset(); } return { people: [], tickets: [], tasks: [], sites: [] }; });
    render(<EquipmentWorkbench />); fireEvent.click(screen.getByRole("button", { name: "Open equipment Test booth" })); fireEvent.click(screen.getByRole("button", { name: "Check in equipment" }));
    await screen.findAllByText("Connection lost");
    fireEvent.click(screen.getAllByRole("button", { name: "Retry saved operation" })[0]);
    await waitFor(() => expect(attempts).toBe(2)); const writes = env.api.mock.calls.filter(call => call[1]?.method); expect(writes[0][1].body).toBe(writes[1][1].body);
  });
  it("detaches a connected component without clearing its saved location", async () => {
    env.parent = "10000000-0000-4000-8000-000000000002"; render(<EquipmentWorkbench />); fireEvent.click(screen.getByRole("button", { name: "Open equipment Test booth" }));
    fireEvent.click(screen.getByRole("button", { name: "Detach · retain last known location" }));
    await waitFor(() => expect(env.api.mock.calls.some(call => call[1]?.method)).toBe(true)); const body = JSON.parse(env.api.mock.calls.find(call => call[1]?.method)![1].body); expect(body.action).toBe("disconnect"); expect(body).not.toHaveProperty("location");
  });
});
