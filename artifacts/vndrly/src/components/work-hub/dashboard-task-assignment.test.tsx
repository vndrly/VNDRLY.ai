import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import DashboardTaskAssignment from "./dashboard-task-assignment";
const mocks = vi.hoisted(() => ({ request: vi.fn(), user: { userId: 7, role: "vendor", vendorId: 1, activeMembershipId: 3 } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: mocks.request }));
const task = { id: "task-id", title: "Inspect camera", version: 4, ownerOrgType: "vendor" as const, ownerOrgId: 1, assigneeUserId: 8, status: "open", createdAt: new Date().toISOString() };
function mount(value = task) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardTaskAssignment task={value} /></QueryClientProvider>); }
beforeEach(() => { mocks.request.mockReset(); mocks.request.mockImplementation(async () => ({ people: [{ userId: 7, name: "My admin", membershipRole: "admin", vendorRole: null }, { userId: 9, name: "Other admin", membershipRole: "admin", vendorRole: null }, { userId: 10, name: "Office colleague", membershipRole: "member", vendorRole: "office" }] })); });
it("opens a flyout with other admins and office staff, then uses the current version and normal assignment command", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "(Re)Assign Inspect camera" }));
  expect(await screen.findByRole("button", { name: /Office colleague/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Other admin/ }));
  await waitFor(() => expect(mocks.request.mock.calls.some(([path, init]) => path === "/tasks/task-id" && init?.method === "PATCH")).toBe(true));
  const assignmentCall = mocks.request.mock.calls.find(([path]) => path === "/tasks/task-id");
  expect(assignmentCall).toBeDefined();
  const body = JSON.parse(assignmentCall![1].body);
  expect(body).toMatchObject({ expectedVersion: 4, owner: { type: "vendor", id: 1 }, payload: { assigneeUserId: 9 } });
  expect(body.operationId).toBeTruthy();
});
it("Assume assigns to the signed-in user and never sends a watch or shift command", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Assume task Inspect camera" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request.mock.calls[0][0]).toBe("/tasks/task-id");
  expect(JSON.parse(mocks.request.mock.calls[0][1].body).payload).toEqual({ assigneeUserId: 7 });
});
it("routes hopper assignment through the canonical hopper controls", async () => {
  mount({ ...task, gateHopper: {} } as typeof task); fireEvent.click(screen.getByRole("button", { name: "Assume task Inspect camera" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request.mock.calls[0][0]).toBe("/gate-task-hopper");
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({ actorUserId: 7, action: "assign", taskId: "task-id", expectedVersion: 4, assigneeUserId: 7 });
});
it("retries an unconfirmed assignment with the identical saved operation", async () => {
  mocks.request.mockRejectedValueOnce(new Error("Result not confirmed")).mockResolvedValue({});
  mount(); fireEvent.click(screen.getByRole("button", { name: "Assume task Inspect camera" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry saved request" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[0][1].body).toBe(mocks.request.mock.calls[1][1].body);
});
