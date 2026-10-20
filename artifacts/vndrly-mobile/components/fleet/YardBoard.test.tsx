import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FleetYardOrder } from "@workspace/api-zod";

const env = vi.hoisted(() => ({ api: vi.fn(), uuid: 0 }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `90000000-0000-4000-8000-${String(++env.uuid).padStart(12, "0")}` }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", mutedForeground: "silver", card: "#222", border: "#555", primary: "#137c49", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
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
    if (path === "/api/fleet/yard-orders") return { orders: [order, { ...base, id: otherId, notes: "Different order" }] };
    if (path === `/api/fleet/yard-orders/${orderId}`) {
      if (lag && order.version > initial.version) { lag = false; return { order: initial, events: [] }; }
      return { order, events: [] };
    }
    if (path === `/api/fleet/yard-orders/${otherId}`) return { order: { ...base, id: otherId, notes: "Different order" }, events: [] };
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
afterEach(() => { cleanup(); env.api.mockReset(); env.uuid = 0; });

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
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("readback mismatch"));
  fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
  expect(await screen.findByRole("button", { name: "Start Yard work" })).toBeTruthy();
  const actions = env.api.mock.calls.filter(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(actions).toHaveLength(2);
  expect(actions[0].operationId).toBe(actions[1].operationId);
});

it("keeps an advisory substitution available and records its exact reason and asset", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Missing component" }));
  fireEvent.click(screen.getByRole("button", { name: "Review alternatives" }));
  expect(await screen.findByText("reserved_in_window")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `Use ${alternativeId}` }));
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  await waitFor(() => expect(screen.getByText("Reported · needs attention")).toBeTruthy());
  const report = JSON.parse(env.api.mock.calls.find(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")![1].body);
  expect(report).toMatchObject({ actualAssetIds: [alternativeId], findings: [{ assetId, kind: "substituted", note: expect.stringContaining("reserved_in_window") }] });
});

it("records damaged condition while allowing a ready outcome", async () => {
  network(["yard"], { ...base, status: "in_progress", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Damaged component" }));
  fireEvent.click(screen.getByRole("button", { name: "Ready" }));
  await waitFor(() => expect(screen.getByText("Reported · ready")).toBeTruthy());
  const report = JSON.parse(env.api.mock.calls.find(([path, init]) => path === `/api/fleet/yard-orders/${orderId}/actions` && init?.method === "POST")![1].body);
  expect(report).toMatchObject({ outcome: "ready", actualAssetIds: [assetId], findings: [{ assetId, kind: "damaged" }] });
});

it("lets an assigned Driver with Yard capability start and report attention despite a missing component", async () => {
  network(["driver", "yard"], { ...base, status: "assigned", assignedToUserId: 7 });
  render(<YardBoard initialYardOrderId={orderId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start Yard work" }));
  fireEvent.click(await screen.findByRole("button", { name: "Missing component" }));
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
