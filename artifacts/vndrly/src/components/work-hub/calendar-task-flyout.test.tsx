import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarTaskFlyout from "./calendar-task-flyout";
import { workHubRequest } from "@/lib/work-hub-client";

vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#eabf38", name: "GateGo", logoSquareUrl: "/logo.png" }) }));
vi.mock("@/components/ui/dialog", async () => ({ Dialog: (await import("@radix-ui/react-dialog")).Root }));
vi.mock("@/lib/work-hub-client", async () => ({ ...await vi.importActual("@/lib/work-hub-client"), workHubRequest: vi.fn(async (path: string) => path === "/people" ? [{ id: 7, displayName: "Bob", onShift: true }] : path === "/crews" ? [{ id: "crew-1", name: "Booth crew" }] : path.includes("/members") ? [{ userId: 7 }] : {}) }));
afterEach(() => { cleanup(); vi.mocked(workHubRequest).mockClear(); });
function mount(canAssign = true) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CalendarTaskFlyout owner={{ type: "vendor", id: 1115 }} canAssign={canAssign} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
  return within(screen.getByRole("dialog"));
}
const writes = () => vi.mocked(workHubRequest).mock.calls.filter(([, options]) => options?.method === "POST");
describe("Add Task flyout", () => {
  it("creates one unassigned task without choosing a crew, person, or date", async () => {
    const dialog = mount();
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "Repair barrier" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1]!.body as string)).toMatchObject({ owner: { type: "vendor", id: 1115 }, payload: { title: "Repair barrier", assigneeUserId: null, dueAt: null } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("allows an on-shift person to be assigned and converts the displayed AM/PM due time", async () => {
    const dialog = mount();
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "Check fence" } });
    fireEvent.change(dialog.getByLabelText("Due (optional)"), { target: { value: "11/02/26 02:30 PM" } });
    fireEvent.click(dialog.getByText("Assign crew or individuals (optional)"));
    fireEvent.click(dialog.getByRole("button", { name: "Individual" }));
    fireEvent.click(await dialog.findByRole("checkbox", { name: "Bob" }));
    fireEvent.click(dialog.getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1]!.body as string).payload).toMatchObject({ assigneeUserId: 7, dueAt: new Date(2026, 10, 2, 14, 30).toISOString() });
  });
  it("gatekeepers have no assignment picker and create only unassigned tasks", async () => {
    const dialog = mount(false);
    expect(dialog.queryByText("Assign crew or individuals (optional)")).toBeNull();
    expect(vi.mocked(workHubRequest).mock.calls).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "Booth light" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1]!.body as string).payload.assigneeUserId).toBeNull();
  });
  it.each(["Cancel", "Close add task"])("%s discards the draft without creating a task", label => {
    const dialog = mount(false);
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "Discard this" } });
    fireEvent.click(dialog.getByRole("button", { name: label }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });
});
