import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GateTaskHopper from "./gate-task-hopper";
const mocks = vi.hoisted(() => ({ request: vi.fn(), onShift: true, manage: false, role: "gatekeeper", vendorId: 7 }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 9, vendorId: mocks.vendorId, activeMembershipId: 2, role: "vendor", vendorRole: mocks.role, availableMemberships: [] } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));
const task = { id: "task", title: "Check lamp", description: "Check the west gate lamp", status: "open", ownerOrgId: 7, assigneeUserId: null, createdById: 8, createdAt: "2026-10-27T12:00:00Z", version: 3, gateName: "West", siteName: "Site", gateHopper: { stationId: "gate", siteId: 5 } };
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); mocks.request.mockReset(); mocks.onShift = true; mocks.manage = false; mocks.role = "gatekeeper"; });
function mount() {
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => init?.method === "POST" ? { task, replayed: false } : path.endsWith("/options") ? { gates: [{ stationId: "gate", siteId: 5, gateName: "West", siteName: "Site", vendorId: 7, vendorName: "GateCo" }], people: [{ userId: 10, vendorId: 7, name: "Relief" }], canManage: mocks.manage, canComplete: mocks.onShift } : { tasks: [task], total: 1, nextBefore: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><GateTaskHopper stationId="gate" /></QueryClientProvider>);
}
it("completes an unassigned task using its current version, completion note and one operation ID without watch controls", async () => {
  mount(); fireEvent.click(await screen.findByText("Check lamp"));
  const complete = screen.getByRole("button", { name: "Complete task" });
  expect((complete as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Completion note"), { target: { value: "Replaced and tested" } });
  fireEvent.click(complete);
  await waitFor(() => expect(mocks.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  const call = mocks.request.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(call[1].body)).toMatchObject({ action: "complete", taskId: "task", expectedVersion: 3, note: "Replaced and tested", operationId: expect.any(String) });
  expect(screen.queryByRole("button", { name: /Assume|Handoff|End Shift/ })).toBeNull();
});
it("shows completion disabled when the canonical shift options say the worker is off shift", async () => {
  mocks.onShift = false; mount(); fireEvent.click(await screen.findByText("Check lamp"));
  fireEvent.change(screen.getByLabelText("Completion note"), { target: { value: "Checked" } });
  expect((screen.getByRole("button", { name: "Complete task" }) as HTMLButtonElement).disabled).toBe(true);
});
it("uses server-authorized gate capabilities when the legacy role field is a field employee", async () => {
  mocks.role = "field"; mount();
  expect(await screen.findByText("Check lamp")).toBeTruthy();
});
it("lets office choose an employee or clear/delete the unassigned task", async () => {
  mocks.role = "office"; mocks.manage = true; mount(); fireEvent.click(await screen.findByText("Check lamp"));
  fireEvent.change(await screen.findByLabelText("Assign task to"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  await waitFor(() => expect(mocks.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  expect(JSON.parse(mocks.request.mock.calls.find(([, init]) => init?.method === "POST")![1].body)).toMatchObject({ action: "assign", assigneeUserId: 10, taskId: "task", expectedVersion: 3 });
  expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy(); expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
});
