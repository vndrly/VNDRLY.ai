import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FleetOfficeBoard from "./FleetOfficeBoard";

const mocks = vi.hoisted(() => ({ api: vi.fn(), session: null as unknown }));
const api = mocks.api;
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: () => true }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 12, vendorId: 11 }, activeMembershipId: 2, activeMembership: { orgId: 11 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", card: "gray", primary: "gold", border: "silver", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/components/FleetChoiceField", () => ({ default: ({ label, value, options, onChange }: any) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Choose</option>{options.map((item: any) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> }));
vi.mock("@/hooks/use-fleet-work", () => ({ useFleetWork: () => ({ session: mocks.session }) }));
vi.mock("@/components/FleetCommercialWork", () => ({ default: ({ run }: any) => <div>Review charges for {run.title}</div> }));
vi.mock("@/components/FleetTicketFinalization", () => ({ default: ({ ticketId }: any) => <div>Finalize ticket #{ticketId}</div> }));

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
afterEach(() => { cleanup(); api.mockReset(); mocks.session = null; });

it("attaches a currently authorized ticket to a non-billable Office draft", async () => {
  let plan: any = { id: id(1), operationId: id(2), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z", fleetId: id(3), title: "Pending haul", billingSiteId: 7, routePlan: { origin: { type: "provisional", localId: id(4), name: "Job", address: "Job", latitude: null, longitude: null, capturedAt: "2026-10-20T12:00:00Z" }, stops: [{ id: id(5), kind: "delivery", sequence: 0, cycleId: null, location: { type: "provisional", localId: id(4), name: "Job", address: "Job", latitude: null, longitude: null, capturedAt: "2026-10-20T12:00:00Z" } }], returnPolicy: "delivery_only", base: null, plannedWindow: null }, ticket: { kind: "office_review_draft", billable: false }, detailId: null, driverUserId: null };
  api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/api/fleet/overview") return { companyId: 11, runs: [], fleets: [], accountScope: null };
    if (path === "/api/fleet/dispatch-plans") return { plans: [plan] };
    if (path === "/api/fleet/dispatch-plans/tickets?siteId=7") return { tickets: [{ id: 88 }] };
    if (path === `/api/fleet/dispatch-plans/${plan.id}` && options?.method === "PATCH") {
      const body = JSON.parse(options.body!);
      expect(body).toMatchObject({ expectedVersion: 1, ticket: { kind: "authorized", ticketId: 88 } });
      plan = { ...plan, version: 2, ticket: body.ticket };
      return plan;
    }
    throw Error(path);
  });
  render(<FleetOfficeBoard />);
  fireEvent.click(await screen.findByRole("button", { name: /Pending haul/ }));
  fireEvent.change(await screen.findByLabelText("Authorized ticket"), { target: { value: "88" } });
  fireEvent.click(screen.getByRole("button", { name: "Attach authorized ticket" }));
  expect(await screen.findByText(/Ticket #88/)).toBeTruthy();
});

it("hands reviewed Runs to Office billing without creating another ticket", async () => {
  mocks.session = { actor: { companyId: 11 } };
  api.mockImplementation(async (path: string) => {
    if (path === "/api/fleet/overview") return { companyId: 11, runs: [
      { id: id(10), title: "New billing Run", status: "submitted_for_review", linkedTicketId: 88, billingV2: { version: 2 } },
      { id: id(11), title: "Legacy Run", status: "completed", linkedTicketId: 89 },
    ], fleets: [], accountScope: null };
    if (path === "/api/fleet/dispatch-plans") return { plans: [] };
    throw Error(path);
  });
  render(<FleetOfficeBoard />);
  expect(await screen.findByText("Review charges for New billing Run")).toBeTruthy();
  expect(screen.getByText("Finalize ticket #89")).toBeTruthy();
  expect(api.mock.calls.some(([path, options]) => options?.method === "POST")).toBe(false);
});
