import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DispatchBoard, { defaultFleetDispatchRoute } from "./DispatchBoard";
import { FleetRunSchema, fleetRouteOperationalStops } from "@workspace/api-zod";

const api = vi.hoisted(() => vi.fn());
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("@/lib/api", () => ({ apiFetch: api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: () => true }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 9, vendorId: 11 }, activeMembershipId: 2, activeMembership: { orgId: 11 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", card: "gray", primary: "gold", border: "silver", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/components/FleetChoiceField", () => ({ default: ({ label, value, options, onChange, disabled }: any) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Choose</option>{options.map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const place = (n: number, name: string) => ({ id: id(n), revision: 1, name, address: name, latitude: null, longitude: null, kind: "pickup" as const, active: true, ownerType: "vendor" as const, ownerId: 11, materials: [], instructions: "", hours: "", timeZone: "America/Chicago" });
const yard = place(1, "Home Yard"), job = place(2, "Job Site");
const overview = { companyId: 11, accountScope: { companyId: 11, userId: 9, membershipId: 2, sessionVersion: 1 }, capabilities: { canDispatch: true }, fleets: [{ id: id(3), name: "Main Fleet", siteIds: [7] }], runs: [] };

afterEach(() => { cleanup(); api.mockReset(); });

it("persists an Office-review waiting plan without a driver or Detail", async () => {
  let saved: unknown = null;
  api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [], equipment: [], tickets: [] };
    if (path === "/api/fleet/dispatch-plans" && !options?.method) return { plans: saved ? [saved] : [] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [{ siteId: 7, name: "Billing Site" }] };
    if (path === "/api/fleet/yards") return { yards: [{ id: id(4), companyId: 11, destinationId: yard.id, isHomeBase: true, active: true, name: "Home Yard" }] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === "/api/fleet/details") return { details: [], nextCursor: null, canManage: true };
    if (path === "/api/fleet/dispatch-plans" && options?.method === "POST") {
      const body = JSON.parse(options.body!);
      expect(body).toMatchObject({ title: "Morning haul", billingSiteId: 7, driverUserId: null, detailId: null, ticket: { kind: "office_review_draft", billable: false } });
      expect(body.routePlan.stops.map((stop: { kind: string }) => stop.kind)).toEqual(["delivery", "return"]);
      saved = { ...body, id: id(5), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z" };
      return saved;
    }
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.change(await screen.findByLabelText("Run title"), { target: { value: "Morning haul" } });
  fireEvent.click(screen.getByRole("button", { name: "Office-review draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Use yard → job → return" }));
  fireEvent.click(screen.getByRole("button", { name: "Save waiting plan" }));
  expect(await screen.findByText(/Waiting on Yard/)).toBeTruthy();
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/fleet/dispatch-plans", expect.objectContaining({ method: "POST" }), expect.anything()));
});

it("persists repeated pickup and delivery stops in physical order", async () => {
  let saved: any = null;
  api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [], equipment: [], tickets: [] };
    if (path === "/api/fleet/dispatch-plans" && !options?.method) return { plans: saved ? [saved] : [] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [] };
    if (path === "/api/fleet/yards") return { yards: [{ id: id(4), companyId: 11, destinationId: yard.id, isHomeBase: true, active: true, name: "Home Yard" }] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === "/api/fleet/details") return { details: [], nextCursor: null, canManage: true };
    if (path === "/api/fleet/dispatch-plans" && options?.method === "POST") {
      const body = JSON.parse(options.body!);
      expect(body.routePlan.stops.map((stop: { kind: string; sequence: number }) => [stop.kind, stop.sequence])).toEqual([
        ["delivery", 0], ["pickup", 1], ["delivery", 2], ["return", 3],
      ]);
      saved = { ...body, id: id(39), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z" };
      return saved;
    }
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.change(await screen.findByLabelText("Run title"), { target: { value: "Two cycles" } });
  fireEvent.click(screen.getByRole("button", { name: "Office-review draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Use yard → job → return" }));
  fireEvent.click(screen.getByRole("button", { name: "Repeat pickup / delivery cycle" }));
  fireEvent.click(screen.getByRole("button", { name: "Save waiting plan" }));
  await waitFor(() => expect(saved).toBeTruthy());
});

it("marks a ticket-linked plan ready with a separately selected driver and Detail", async () => {
  const route = defaultFleetDispatchRoute(yard, job);
  let plan: any = { id: id(7), operationId: id(8), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z", fleetId: id(3), title: "Authorized haul", billingSiteId: 7, routePlan: route, ticket: { kind: "authorized", ticketId: 88 }, detailId: null, driverUserId: null };
  const detail = { id: id(6), companyId: 11, version: 1, name: "Reusable Detail", vehicleAssetId: id(10), rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [id(3)], effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, archivedAt: null };
  api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [{ userId: 21, name: "Driver", fleetIds: [id(3)] }], equipment: [], tickets: [{ id: 88, siteId: 7, status: "initiated" }] };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [{ siteId: 7, name: "Billing Site" }] };
    if (path === "/api/fleet/yards") return { yards: [] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === "/api/fleet/details") return { details: [detail], nextCursor: null, canManage: true };
    if (path === `/api/fleet/dispatch-plans/${plan.id}` && options?.method === "PATCH") {
      const body = JSON.parse(options.body!);
      expect(body).toMatchObject({ expectedVersion: 1, detailId: detail.id, driverUserId: 21, state: "ready_to_dispatch" });
      plan = { ...plan, detailId: detail.id, driverUserId: 21, state: "ready_to_dispatch", version: 2 };
      return plan;
    }
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Authorized haul/ }));
  fireEvent.change(screen.getByLabelText("Run driver"), { target: { value: "21" } });
  fireEvent.change(screen.getByLabelText("Detail request / reservation"), { target: { value: detail.id } });
  fireEvent.click(screen.getByRole("button", { name: "Review ready Detail and driver" }));
  expect(await screen.findByRole("button", { name: /Ready to dispatch/ })).toBeTruthy();
  expect(plan.ticket.ticketId).toBe(88);
});

it("loads later Detail pages so Dispatch can select every authorized Detail", async () => {
  const route = defaultFleetDispatchRoute(yard, job);
  const plan: any = { id: id(7), operationId: id(8), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z", fleetId: id(3), title: "Paged haul", billingSiteId: 7, routePlan: route, ticket: { kind: "authorized", ticketId: 88 }, detailId: null, driverUserId: null };
  const first = { id: id(6), companyId: 11, version: 1, name: "First Detail", vehicleAssetId: id(10), rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [id(3)], effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, archivedAt: null };
  const later = { ...first, id: id(16), name: "Later Detail", vehicleAssetId: id(17) };
  api.mockImplementation(async (path: string) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [{ userId: 21, name: "Driver", fleetIds: [id(3)] }], equipment: [], tickets: [{ id: 88, siteId: 7, status: "initiated" }] };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [] };
    if (path === "/api/fleet/yards") return { yards: [] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === "/api/fleet/details") return { details: [first], nextCursor: first.id, canManage: true };
    if (path === `/api/fleet/details?after=${encodeURIComponent(first.id)}`) return { details: [later], nextCursor: null, canManage: true };
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Paged haul/ }));
  expect(screen.getByRole("option", { name: "Later Detail" })).toBeTruthy();
});

it("reads a linked Yard Order directly when it is outside the first list page", async () => {
  const route = defaultFleetDispatchRoute(yard, job), detailId = id(6), orderId = id(18);
  const plan: any = { id: id(7), operationId: id(8), companyId: 11, version: 2, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z", fleetId: id(3), title: "Older Yard work", billingSiteId: 7, routePlan: route, ticket: { kind: "office_review_draft", billable: false }, detailId, driverUserId: null, yardOrderId: orderId };
  const detail = { id: detailId, companyId: 11, version: 1, name: "Reusable Detail", vehicleAssetId: id(10), rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [id(3)], effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, archivedAt: null };
  const linkedOrder = { id: orderId, companyId: 11, version: 3, yardId: id(4), detailId, runId: null, status: "reported", outcome: "ready", requestedByUserId: 9, assignedToUserId: null, requestedAt: "2026-10-20T12:00:00Z", scheduledAt: null, startedAt: "2026-10-20T12:05:00Z", reportedAt: "2026-10-20T12:10:00Z", requestedAssetIds: [id(10)], actualAssetIds: [id(10)], findings: [], notes: "Ready" };
  api.mockImplementation(async (path: string) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [], equipment: [], tickets: [] };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [] };
    if (path === "/api/fleet/yards") return { yards: [] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === `/api/fleet/yard-orders/${orderId}`) return linkedOrder;
    if (path === "/api/fleet/details") return { details: [detail], nextCursor: null, canManage: true };
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Older Yard work/ }));
  expect(screen.getByRole("option", { name: new RegExp(orderId) })).toBeTruthy();
});

it("explains and disables release when a stale ready plan has no complete assignment", async () => {
  const route = defaultFleetDispatchRoute(yard, job);
  const plan: any = { id: id(7), operationId: id(8), companyId: 11, version: 2, state: "ready_to_dispatch", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z", fleetId: id(3), title: "Incomplete ready plan", billingSiteId: 7, routePlan: route, ticket: { kind: "authorized", ticketId: 88 }, detailId: null, driverUserId: null };
  api.mockImplementation(async (path: string) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [], equipment: [], tickets: [{ id: 88, siteId: 7, status: "initiated" }] };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [] };
    if (path === "/api/fleet/yards") return { yards: [] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === "/api/fleet/details") return { details: [], nextCursor: null, canManage: true };
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Incomplete ready plan/ }));
  expect(screen.getByText(/Choose an available Detail and driver/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Release to driver" }) as HTMLButtonElement).disabled).toBe(true);
});

it("requests a Yard Detail while the plan remains waiting for a driver", async () => {
  const route = defaultFleetDispatchRoute(yard, job);
  const detail = { id: id(6), companyId: 11, version: 1, name: "Reusable Detail", vehicleAssetId: id(10), rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [id(3)], effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, archivedAt: null };
  let plan: any = { id: id(7), operationId: id(8), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z", fleetId: id(3), title: "Waiting haul", billingSiteId: 7, routePlan: route, ticket: { kind: "office_review_draft", billable: false }, detailId: null, driverUserId: null };
  let savedOrder: any;
  api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return overview;
    if (path === "/api/fleet/resources") return { drivers: [], equipment: [], tickets: [] };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [] };
    if (path === "/api/fleet/yards") return { yards: [{ id: id(4), companyId: 11, destinationId: yard.id, isHomeBase: true, active: true, name: "Home Yard" }] };
    if (path === "/api/fleet/yard-orders" && !options?.method) return { orders: savedOrder ? [savedOrder] : [] };
    if (path === "/api/fleet/details") return { details: [detail], nextCursor: null, canManage: true };
    if (path.startsWith("/api/fleet/yard-orders/operations/")) throw { status: 404 };
    if (path === "/api/fleet/yard-orders" && options?.method === "POST") {
      const body = JSON.parse(options.body!);
      expect(body.order).toMatchObject({ detailId: detail.id, runId: null, status: "requested" });
      savedOrder = { ...body.order, requestedAssetIds: [detail.vehicleAssetId] };
      return savedOrder;
    }
    if (path === `/api/fleet/dispatch-plans/${plan.id}` && options?.method === "PATCH") {
      const body = JSON.parse(options.body!);
      expect(body).toMatchObject({ expectedVersion: 1, detailId: detail.id, yardOrderId: savedOrder.id, state: "waiting_on_yard" });
      plan = { ...plan, detailId: detail.id, yardOrderId: savedOrder.id, version: 2 };
      return plan;
    }
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Waiting haul/ }));
  fireEvent.change(screen.getByLabelText("Detail request / reservation"), { target: { value: detail.id } });
  fireEvent.click(screen.getByRole("button", { name: "Request Yard Detail" }));
  expect(await screen.findByText(/Waiting on Yard/)).toBeTruthy();
  await waitFor(() => expect(savedOrder).toBeTruthy());
  expect(plan.driverUserId).toBeNull();
});

it("reassigns and redispatches a released Run without changing its ticket", async () => {
  const route = defaultFleetDispatchRoute(yard, job), runId = id(30), detailId = id(31), replacementId = id(32), vehicleId = id(33), newVehicleId = id(34);
  const baseDetail = { id: detailId, companyId: 11, version: 1, name: "Old Detail", vehicleAssetId: vehicleId, rigPackageId: null, rigPackageVersion: null,
    driverUserId: 21, accessGroupIds: [id(3)], effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, archivedAt: null };
  const replacement = { ...baseDetail, id: replacementId, name: "Replacement Detail", vehicleAssetId: newVehicleId, driverUserId: 22 };
  const snapshot = (detail: typeof baseDetail) => ({ detail, rigPackage: null, labels: { truck: detail.name, driver: "Driver", rigPackage: null, components: [] }, carrierOfRecordId: 11, snapshottedAt: "2026-10-20T12:00:00Z" });
  const assignment = (detail: typeof baseDetail) => ({ version: 2, snapshot: snapshot(detail), returnPolicy: "return_required", reservation: {
    id: id(detail.driverUserId!), runId, detailId: detail.id, detailVersion: 1, driverUserId: detail.driverUserId, assetIds: [detail.vehicleAssetId],
    startAt: "2026-10-20T12:00:00Z", plannedEndAt: null, timeZone: "America/Chicago", state: "reserved", actualReleasedAt: null, releaseReason: null, version: 1 } });
  const event = (operationId: string, type: string) => ({ id: crypto.randomUUID(), operationId, type, actorUserId: 9, recordedAt: "2026-10-20T12:00:00Z" });
  let run: any = FleetRunSchema.parse({ id: runId, companyId: 11, fleetId: id(3), title: "Released haul", driverUserId: 21,
    vehicleAssetId: vehicleId, trailerAssetId: null, siteIds: [7], status: "dispatched", phase: null, version: 2,
    routePlan: route, resourceAssignment: assignment(baseDetail), stops: fleetRouteOperationalStops(route, 7, id(35)), loads: [], inspections: [], currentStopId: null,
    visitedStopIds: [], events: [], linkedTicketId: 88, allowedActions: ["reassign"] });
  const plan = { id: id(36), operationId: id(37), companyId: 11, version: 3, state: "released", runId, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z",
    fleetId: id(3), title: "Released haul", billingSiteId: 7, routePlan: route, ticket: { kind: "authorized", ticketId: 88 }, detailId, driverUserId: 21 };
  api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return { ...overview, runs: [run] };
    if (path === "/api/fleet/resources") return { drivers: [{ userId: 21, name: "Old", fleetIds: [id(3)] }, { userId: 22, name: "New", fleetIds: [id(3)] }], equipment: [], tickets: [] };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/commercial") return { destinations: [yard, job], sites: [] };
    if (path === "/api/fleet/yards") return { yards: [] };
    if (path === "/api/fleet/yard-orders") return { orders: [] };
    if (path === "/api/fleet/details") return { details: [{ ...baseDetail, driverUserId: null }, { ...replacement, driverUserId: null }], nextCursor: null, canManage: true };
    if (path === `/api/fleet/details/${replacementId}?driverUserId=22`) return snapshot(replacement);
    if (path === `/api/fleet/runs/${runId}` && !options?.method) return run;
    if (path === `/api/fleet/runs/${runId}/actions` && options?.method === "POST") {
      const body = JSON.parse(options.body!);
      if (body.action === "reassign") {
        expect(body).toMatchObject({ driverUserId: 22, detailSelection: { detailId: replacementId } });
        run = FleetRunSchema.parse({ ...run, status: "draft", version: run.version + 1, driverUserId: 22, vehicleAssetId: newVehicleId,
          resourceAssignment: assignment(replacement), events: [...run.events, event(body.operationId, "reassign")], allowedActions: ["dispatch"] });
      } else {
        expect(body.action).toBe("dispatch");
        run = FleetRunSchema.parse({ ...run, status: "dispatched", version: run.version + 1,
          events: [...run.events, event(body.operationId, "dispatch")], allowedActions: ["reassign"] });
      }
      return run;
    }
    throw Error(path);
  });
  render(<DispatchBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Released haul/ }));
  fireEvent.change(screen.getByLabelText("Replacement driver"), { target: { value: "22" } });
  fireEvent.change(screen.getByLabelText("Replacement Detail"), { target: { value: replacementId } });
  fireEvent.click(screen.getByRole("button", { name: "Reassign and redispatch" }));
  await waitFor(() => expect(run.events).toHaveLength(2));
  expect(run).toMatchObject({ status: "dispatched", linkedTicketId: 88, driverUserId: 22 });
  expect(plan.ticket.ticketId).toBe(88);
});
