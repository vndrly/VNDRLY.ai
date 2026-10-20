import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FleetYardOrder } from "@workspace/api-zod";

const env = vi.hoisted(() => ({ api: vi.fn(), uuid: 0, language: "en" }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `90000000-0000-4000-8000-${String(++env.uuid).padStart(12, "0")}` }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", mutedForeground: "silver", card: "#222", border: "#555", primary: "#137c49", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", async importOriginal => { const actual = await importOriginal<typeof import("@/lib/fleet-copy")>(); return { useFleetCopy: () => (value: string) => actual.fleetCopy(value, env.language) }; });
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, vendorId: 3, activeMembershipId: 5 }, activeMembershipId: 5, activeMembership: { orgId: 3, orgType: "vendor" } }) }));

import YardBoard from "./YardBoard";

const orderId = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const yardId = "20000000-0000-4000-8000-000000000001";
const assetId = "30000000-0000-4000-8000-000000000001";
const alternativeId = "30000000-0000-4000-8000-000000000002";
const base: FleetYardOrder = { id: orderId, companyId: 3, version: 1, yardId, detailId: null, runId: null, status: "requested", outcome: null, requestedByUserId: 8, assignedToUserId: null, requestedAt: "2026-10-20T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null, requestedAssetIds: [assetId], actualAssetIds: [], findings: [], notes: "Load the rig" };
function network(capabilities = ["driver", "yard"], initial: FleetYardOrder = base, staleReadback = false) {
  let order: FleetYardOrder = { ...initial };
  let lag = staleReadback;
  const receipts = new Map<string, FleetYardOrder>();
  env.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return { accountScope: { companyId: 3, userId: 7, membershipId: 5, sessionVersion: 1 }, fleets: [], runs: [] };
    if (path === "/api/fleet/capabilities") return { companyId: 3, userId: 7, capabilities };
    if (path === "/api/fleet/yards") return { yards: [{ id: yardId, companyId: 3, version: 1, name: "North Yard", timeZone: "America/Chicago", destinationId: null, isHomeBase: true, active: true }] };
    if (path.startsWith("/api/fleet/yard-assets?assetId=")) { const id = path.split("=")[1]; return { canManage: true, version: 1, fleets: [], nextCursor: null, assets: [{ id, name: id === assetId ? "Rig pump" : "Spare pump", manufacturer: "", model: "", version: 1, category: "pump", status: "available", legalOwner: "Example", held: false, currentHolderUserId: null, aliases: [{ kind: "asset_tag", value: id === assetId ? "PUMP-1" : "PUMP-2" }], fleetIds: [] }] }; }
    if (path === "/api/fleet/yard-orders") return { orders: [order, { ...base, id: otherId, notes: "Different order" }] };
    if (path === `/api/fleet/yard-orders/${orderId}`) {
      if (lag && order.version > initial.version) { lag = false; return { order: initial, events: [] }; }
      return { order, events: [] };
    }
    if (path === `/api/fleet/yard-orders/${otherId}`) return { order: { ...base, id: otherId, notes: "Different order" }, events: [] };
    if (path.startsWith("/api/fleet/yard-orders/operations/")) { const result = receipts.get(path.split("/").at(-1)!); if (result) return { operationId: path.split("/").at(-1), result }; throw Object.assign(Error("No receipt"), { status: 404 }); }
    if (path.startsWith(`/api/fleet/yards/${yardId}/suggestions?`)) return { requestedAssetIds: [assetId], candidates: [{ assetId: alternativeId, available: false, reasons: ["reserved_in_window"] }] };
    if (path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST") {
      const input = JSON.parse(init.body!);
      if (receipts.has(input.operationId)) return receipts.get(input.operationId);
      order = { ...order, version: order.version + 1, status: input.kind === "assign" ? "assigned" : input.kind === "start" ? "in_progress" : "reported", assignedToUserId: input.kind === "assign" ? input.assignedToUserId : order.assignedToUserId, outcome: input.kind === "report" ? input.outcome : null, reportedAt: input.kind === "report" ? "2026-10-20T13:00:00Z" : null, findings: input.findings ?? [] };
      receipts.set(input.operationId, order);
      return order;
    }
    throw Error(`Unexpected ${path}`);
  });
}
afterEach(() => { cleanup(); env.api.mockReset(); env.uuid = 0; env.language = "en"; });

it("opens the exact preserved Yard Order even when another order shares its run", async () => {
  network();
  render(<YardBoard initialYardOrderId={orderId} />);
  expect(await screen.findByText("Load the rig")).toBeTruthy();
  expect(screen.queryByText("Different order")).toBeNull();
  expect(env.api.mock.calls.some(([path]) => path === `/api/fleet/yard-orders/${orderId}`)).toBe(true);
});

it("retains the exact action when canonical Yard readback lags the receipt", async () => {
  network(["dispatch"], base, true);
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  expect(await screen.findByText(/readback mismatch/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
  expect(await screen.findByRole("button", { name: "Start Yard work" })).toBeTruthy();
  const actions = env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(actions).toHaveLength(1);
  expect(env.api.mock.calls.some(([path]) => path === `/api/fleet/yard-orders/operations/${actions[0].operationId}`)).toBe(true);
});

it("keeps an advisory substitution available and records its exact reason and asset", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: /Missing component Rig pump/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review alternatives" }));
  expect(await screen.findByText("reserved_in_window")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Use .*${alternativeId}.* for Rig pump`) }));
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  await waitFor(() => expect(screen.getByText("Reported · needs attention")).toBeTruthy());
  const report = JSON.parse(env.api.mock.calls.find(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")![1].body);
  expect(report).toMatchObject({ actualAssetIds: [alternativeId], findings: [{ assetId, kind: "substituted", note: expect.stringContaining("reserved_in_window") }] });
});

it("records damaged condition while allowing a ready outcome", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: /Damaged component Rig pump/ }));
  fireEvent.click(screen.getByRole("button", { name: "Ready" }));
  await waitFor(() => expect(screen.getByText("Reported · ready")).toBeTruthy());
  const report = JSON.parse(env.api.mock.calls.find(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")![1].body);
  expect(report).toMatchObject({ outcome: "ready", actualAssetIds: [assetId], findings: [{ assetId, kind: "damaged" }] });
});

it("lets an assigned Driver with Yard capability start and report attention despite a missing component", async () => {
  network(["driver", "yard"], { ...base, status: "assigned", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start Yard work" }));
  fireEvent.click(await screen.findByRole("button", { name: /Missing component Rig pump/ }));
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  await waitFor(() => expect(screen.getByText("Reported · needs attention")).toBeTruthy());
  const reports = env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(reports.map(value => value.kind)).toEqual(["start", "report"]);
  expect(reports[1]).toMatchObject({ outcome: "needs_attention", findings: [{ assetId, kind: "missing" }] });
});

it("does not offer another Yard worker's assigned order as an action", async () => {
  network(["yard"], { ...base, status: "assigned", assignedToUserId: 19 });
  render(<YardBoard initialYardOrderId={orderId} />);
  expect(await screen.findByText("Load the rig")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start Yard work" })).toBeNull();
});

it("removes protected Yard actions after current access is revoked", async () => {
  network(["yard"], { ...base, status: "assigned", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  expect(await screen.findByRole("button", { name: "Start Yard work" })).toBeTruthy();
  env.api.mockRejectedValueOnce(Object.assign(Error("Access revoked"), { status: 403 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Yard Board" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Access revoked");
  expect(screen.queryByRole("button", { name: "Start Yard work" })).toBeNull();
});

it("lets authorized Dispatch assign the requested order without changing another order", async () => {
  network(["dispatch"]);
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  expect(await screen.findByRole("button", { name: "Start Yard work" })).toBeTruthy();
  expect(screen.queryByText("Different order")).toBeNull();
});

it("keeps a failed order action attached to A and prevents opening B", async () => {
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  env.api.mockImplementation((path: string, init?: any) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST" ? Promise.reject(Error("Connection lost")) : baseApi(path, init));
  render(<YardBoard />);
  fireEvent.click(await screen.findByRole("button", { name: `Open Yard Order ${orderId}` }));
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  expect(await screen.findByText("Connection lost")).toBeTruthy();
  expect(screen.getByRole("button", { name: "All Yard Orders" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: `Open Yard Order ${otherId}` })).toBeNull();
});

it("prevents order switching while an action is in flight", async () => {
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  let release!: (value: unknown) => void;
  env.api.mockImplementation((path: string, init?: any) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST" ? new Promise(resolve => { release = resolve; }) : baseApi(path, init));
  render(<YardBoard />);
  fireEvent.click(await screen.findByRole("button", { name: `Open Yard Order ${orderId}` }));
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "All Yard Orders" })).toHaveProperty("disabled", true));
  release({ ...base, version: 2, status: "assigned", assignedToUserId: 7 });
});

it("refreshes a definite Yard conflict while preserving report reasons for reapplication", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  const baseApi = env.api.getMockImplementation()!;
  let conflict = true;
  let savedOrder: FleetYardOrder | null = null;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST") {
      if (conflict) { conflict = false; return Promise.reject(Object.assign(Error("Version conflict"), { status: 409 })); }
      const input = JSON.parse(init.body); savedOrder = { ...base, version: 3, status: "reported", outcome: input.outcome, assignedToUserId: 7, reportedAt: "2026-10-20T13:00:00Z", findings: input.findings }; return savedOrder;
    }
    if (!conflict && path === `/api/fleet/yard-orders/${orderId}`) return { order: savedOrder ?? { ...base, version: 2, status: "in_progress", assignedToUserId: 7 }, events: [] };
    return baseApi(path, init);
  });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.change(await screen.findByLabelText("Yard report reasons"), { target: { value: "Bent coupling" } });
  fireEvent.click(screen.getByRole("button", { name: /Damaged component Rig pump/ }));
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  expect(await screen.findByText(/Review your findings/)).toBeTruthy();
  expect(screen.getByLabelText("Yard report reasons")).toHaveProperty("value", "Bent coupling");
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  expect(await screen.findByText("Reported · needs attention")).toBeTruthy();
  await waitFor(() => expect(env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")).toHaveLength(2));
  const actions = env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(actions[1].expectedVersion).toBe(2);
  expect(actions[1].operationId).not.toBe(actions[0].operationId);
  expect(actions[1].notes).toBe("Bent coupling");
});

it("shows translated Yard actions and identified component controls in Spanish", async () => {
  env.language = "es";
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  expect(await screen.findByRole("heading", { name: "Panel del patio" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Componente faltante Rig pump/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Requiere atención" })).toBeTruthy();
});

it("translates Yard assignment, recorded history, and recovery in Spanish", async () => {
  env.language = "es";
  network(["dispatch"], base, true);
  const baseApi = env.api.getMockImplementation()!;
  env.api.mockImplementation((path: string, init?: any) => path === `/api/fleet/yard-orders/${orderId}`
    ? Promise.resolve(baseApi(path, init)).then((value: any) => ({ ...value, events: [{ id: "90000000-0000-4000-8000-000000000090", type: "assigned", at: "2026-10-20T12:00:00Z" }] }))
    : baseApi(path, init));
  render(<YardBoard initialYardOrderId={orderId} />);
  const assignee = await screen.findByLabelText("ID de usuario del trabajador del patio");
  expect(assignee).toHaveProperty("placeholder", "Deje en blanco para asignarse a sí mismo");
  expect(screen.getByText(/asignado ·/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Asignarme" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(element => element.textContent?.includes("La lectura de la orden del patio no coincide"))).toBe(true));
  expect(screen.getByRole("button", { name: "Recuperar acción de la orden del patio" })).toBeTruthy();
});

it("uses the structured Fleet error code rather than HTTP text for a Spanish Yard rejection", async () => {
  env.language = "es";
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  env.api.mockImplementation((path: string, init?: any) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST"
    ? Promise.reject(Object.assign(Error("HTTP 403"), { status: 403, code: "fleet.permission_denied", data: { code: "fleet.permission_denied" } }))
    : baseApi(path, init));
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Asignarme" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(element => element.textContent === "No tiene permiso para esta acción de flota.")).toBe(true));
});

it("shows Spanish recovery guidance for a coded internal error without losing the Yard action", async () => {
  env.language = "es";
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  env.api.mockImplementation((path: string, init?: any) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST"
    ? Promise.reject(Object.assign(Error("HTTP 500"), { status: 500, code: "fleet.internal_error", data: { code: "fleet.internal_error" } }))
    : baseApi(path, init));
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Asignarme" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(element => element.textContent === "La acción del patio necesita recuperación. Reintente la misma solicitud.")).toBe(true));
  expect(screen.getByRole("button", { name: "Recuperar acción de la orden del patio" })).toBeTruthy();
});

it("guides invalid scheduled time and Run ID, then saves the corrected Yard request", async () => {
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/yard-orders" && init?.method === "POST") return JSON.parse(init.body).order;
    if (path.startsWith("/api/fleet/yard-orders/") && path !== `/api/fleet/yard-orders/${otherId}` && path !== `/api/fleet/yard-orders/${orderId}`) return { order: { ...base, id: path.split("/").at(-1) }, events: [] };
    return baseApi(path, init);
  });
  render(<YardBoard />);
  fireEvent.click(await screen.findByRole("button", { name: "Request Yard work" }));
  fireEvent.change(screen.getByLabelText("Run ID"), { target: { value: "bad-run" } });
  fireEvent.change(screen.getByLabelText("Scheduled time"), { target: { value: "tomorrowish" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Yard request" }));
  expect(await screen.findByText("Run ID must be a valid identifier.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Run ID"), { target: { value: "50000000-0000-4000-8000-000000000001" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Yard request" }));
  expect(await screen.findByText("Scheduled time must be a valid date and time.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Scheduled time"), { target: { value: "2026-10-21T12:00:00Z" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Yard request" }));
  await waitFor(() => expect(env.api.mock.calls.some(([path, init]) => path === "/api/fleet/yard-orders" && init?.method === "POST")).toBe(true));
});

it("records findings and an explicit replacement for the named second component", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7, requestedAssetIds: [assetId, alternativeId] });
  const baseApi = env.api.getMockImplementation()!;
  const replacementId = "30000000-0000-4000-8000-000000000003";
  env.api.mockImplementation((path: string, init?: any) => path.startsWith(`/api/fleet/yards/${yardId}/suggestions?`)
    ? { candidates: [{ assetId: replacementId, available: true, reasons: [] }] } : baseApi(path, init));
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: /Missing component Spare pump/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review alternatives" }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Use ${replacementId} for Spare pump`) }));
  expect(screen.getByText(new RegExp(`Replacement for Spare pump.*${replacementId}`))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  await waitFor(() => expect(env.api.mock.calls.some(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")).toBe(true));
  const report = JSON.parse(env.api.mock.calls.find(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")![1].body);
  expect(report.actualAssetIds).toEqual([assetId, replacementId]);
  expect(report.findings).toMatchObject([{ assetId: alternativeId, kind: "substituted" }]);
});

it.each(["gateway failure after commit", "canonical GET failure after POST"])("recovers an assigned Yard action from its first receipt after %s", async failure => {
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  let failed = false;
  env.api.mockImplementation(async (path: string, init?: any) => {
    if (path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST" && !failed && failure === "gateway failure after commit") {
      failed = true; await baseApi(path, init); throw Object.assign(Error("Gateway failed"), { status: 502 });
    }
    if (path === `/api/fleet/yard-orders/${orderId}` && !failed && failure === "canonical GET failure after POST" && env.api.mock.calls.some(([called, request]) => called === `/api/fleet/yard-orders/${orderId}/actions` && request?.method === "POST")) {
      failed = true; throw Object.assign(Error("Readback failed"), { status: 503 });
    }
    return baseApi(path, init);
  });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  expect(await screen.findByText(failure === "gateway failure after commit" ? "Gateway failed" : "Readback failed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
  expect(await screen.findByRole("button", { name: "Start Yard work" })).toBeTruthy();
  const posts = env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(env.api.mock.calls.some(([path]) => path.startsWith("/api/fleet/yard-orders/operations/"))).toBe(true);
});

it("recovers a committed Yard request after a 502 without making a second order", async () => {
  network(["dispatch"]);
  const baseApi = env.api.getMockImplementation()!;
  let saved: FleetYardOrder | null = null;
  env.api.mockImplementation((path: string, init?: any) => {
    if (path === "/api/fleet/yard-orders" && init?.method === "POST") { saved = JSON.parse(init.body).order; throw Object.assign(Error("Gateway failed"), { status: 502 }); }
    if (path.startsWith("/api/fleet/yard-orders/operations/") && saved) return { operationId: path.split("/").at(-1), result: saved };
    if (saved && path === `/api/fleet/yard-orders/${saved.id}`) return { order: saved, events: [] };
    return baseApi(path, init);
  });
  render(<YardBoard />);
  fireEvent.click(await screen.findByRole("button", { name: "Request Yard work" }));
  fireEvent.change(screen.getByLabelText("Run ID"), { target: { value: "50000000-0000-4000-8000-000000000001" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Yard request" }));
  expect(await screen.findByText("Gateway failed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save Yard request" }));
  expect(await screen.findByText("Yard Order requested.")).toBeTruthy();
  expect(env.api.mock.calls.filter(([path, init]) => path === "/api/fleet/yard-orders" && init?.method === "POST")).toHaveLength(1);
});

it("can verify a lost report after Refresh moves the order to reported", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  const baseApi = env.api.getMockImplementation()!;
  let lost = false;
  env.api.mockImplementation(async (path: string, init?: any) => {
    if (!lost && path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST") { lost = true; await baseApi(path, init); throw Object.assign(Error("Response lost"), { status: 502 }); }
    return baseApi(path, init);
  });
  render(<YardBoard />);
  fireEvent.click(await screen.findByRole("button", { name: `Open Yard Order ${orderId}` }));
  fireEvent.click(await screen.findByRole("button", { name: "Ready" }));
  expect(await screen.findByText("Response lost")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh Yard Board" }));
  expect(await screen.findByText("Reported · ready")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Recover Yard Order action" }));
  expect(await screen.findByText("Yard Order saved.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "All Yard Orders" })).toHaveProperty("disabled", false);
  expect(env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")).toHaveLength(1);
});
