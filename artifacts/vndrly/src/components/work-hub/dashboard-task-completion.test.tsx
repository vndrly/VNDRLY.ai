import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import DashboardTaskCompletion from "./dashboard-task-completion";
const mocks = vi.hoisted(() => ({ request: vi.fn(), canComplete: true }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 1, activeMembershipId: 3 } }) }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: mocks.request }));
vi.mock("@/components/gate-task-hopper", () => ({ useGateHopperOptions: () => ({ data: { canComplete: mocks.canComplete }, isPending: false, isError: false }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: (props: any) => <button {...props} /> }));
const task = { id: "task-id", title: "Inspect camera", version: 4, ownerOrgType: "vendor" as const, ownerOrgId: 1, assigneeUserId: 7, status: "open", createdAt: new Date().toISOString() };
function mount(value = task) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardTaskCompletion task={value} /></QueryClientProvider>); }
beforeEach(() => { mocks.request.mockReset(); mocks.request.mockResolvedValue({}); mocks.canComplete = true; });
it("opens Resolution without completing and requires text before sending the versioned completion", async () => {
  mount(); const dot = screen.getByRole("switch", { name: "Completed: Inspect camera" });
  expect(dot.getAttribute("aria-checked")).toBe("false"); fireEvent.click(dot);
  const save = await screen.findByRole("button", { name: "Save resolution & complete" });
  expect((save as HTMLButtonElement).disabled).toBe(true); expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Resolution" }), { target: { value: "  Camera cleaned and tested  " } });
  fireEvent.click(save);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request.mock.calls[0][0]).toBe("/tasks/task-id");
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({ expectedVersion: 4, payload: { action: "complete", resolution: "Camera cleaned and tested" } });
});
it("uses the hopper completion endpoint with a resolution note and the current actor", async () => {
  mount({ ...task, gateHopper: {} } as typeof task); fireEvent.click(screen.getByRole("switch"));
  fireEvent.change(await screen.findByRole("textbox", { name: "Resolution" }), { target: { value: "Light replaced" } });
  fireEvent.click(screen.getByRole("button", { name: "Save resolution & complete" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request.mock.calls[0][0]).toBe("/gate-task-hopper");
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({ action: "complete", actorUserId: 7, taskId: "task-id", expectedVersion: 4, note: "Light replaced" });
});
it("keeps off-shift hopper completion disabled even when a resolution is entered", async () => {
  mocks.canComplete = false; mount({ ...task, gateHopper: {} } as typeof task); fireEvent.click(screen.getByRole("switch"));
  fireEvent.change(await screen.findByRole("textbox", { name: "Resolution" }), { target: { value: "Finished" } });
  expect((screen.getByRole("button", { name: "Save resolution & complete" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.request).not.toHaveBeenCalled();
});
it("shows the completed dot and retained resolution without offering another completion", async () => {
  mount({ ...task, status: "completed", completionResolution: "Verified with control room" } as typeof task);
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"); fireEvent.click(screen.getByRole("switch"));
  expect(await screen.findByText("Verified with control room")).toBeTruthy(); expect(screen.queryByRole("textbox")).toBeNull(); expect(mocks.request).not.toHaveBeenCalled();
});
