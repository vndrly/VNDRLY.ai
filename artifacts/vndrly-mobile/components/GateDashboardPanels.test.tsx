import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangeOverState } from "@workspace/gate-booth";
const state = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn(), language: "en" }));
vi.mock("@/lib/api", () => ({ apiFetch: state.fetch }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: async () => ({ rows: [] }) }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, vendorId: 7 }, activeMembershipId: 2 }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", mutedForeground: "grey", border: "grey" }) }));
vi.mock("expo-router", () => ({ router: { push: state.push } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: state.language } }) }));
import GateDashboardPanels from "./GateDashboardPanels";
const current = { station: { id: "gate", name: "Gate", site_id: 1 }, site: { id: 1, name: "Site" }, shift: null, preparation: null, snapshot: null, stale: false, supervisor: false, items: [] } satisfies ChangeOverState;
const id = "10000000-0000-4000-8000-000000000001";
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><GateDashboardPanels current={current}/></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  state.language = "en"; state.push.mockReset();
  state.fetch.mockReset().mockResolvedValue({ tasks: [
    { id, title: "Plain assigned task", status: "open", assigneeUserId: 1 },
    { id: "progress", title: "Work underway", status: "in_progress", assigneeUserId: 1 },
    { id: "done", title: "Finished task", status: "completed", assigneeUserId: 1 },
    { id: "cancelled", title: "Cancelled task", status: "cancelled", assigneeUserId: 1 },
    { id: "other", title: "Another employee", status: "open", assigneeUserId: 2 },
  ] });
});
afterEach(cleanup);
it("groups canonical task statuses and opens an ordinary task record rather than a plan", async () => {
  mount();
  const panel = screen.getByTestId("gate-dashboard-tasks");
  const row = await within(panel).findByRole("button", { name: /New.*1/ });
  expect(within(panel).getByRole("button", { name: /In Progress.*1/ })).toBeTruthy();
  expect(within(panel).getByRole("button", { name: /Completed.*1/ })).toBeTruthy();
  fireEvent.click(row);
  fireEvent.click(screen.getByText("Plain assigned task ›"));
  expect(state.push).toHaveBeenCalledWith(`/work-hub/record?kind=task&id=${id}`);
  expect(screen.queryByText(/Another employee/)).toBeNull();
  expect(screen.queryByText(/Cancelled task/)).toBeNull();
});
it("reports a failed refresh as unavailable instead of presenting retained task counts", async () => {
  const client = mount(), panel = screen.getByTestId("gate-dashboard-tasks");
  fireEvent.click(await within(panel).findByRole("button", { name: /New.*1/ }));
  state.fetch.mockRejectedValue(Error("offline"));
  await client.invalidateQueries({ queryKey: ["gate-dashboard-tasks"] });
  await waitFor(() => expect(within(panel).getByRole("button", { name: /New.*Unavailable/ })).toBeTruthy());
  expect(screen.queryByText("Plain assigned task ›")).toBeNull();
  expect(screen.getByText("Task records are unavailable.")).toBeTruthy();
});
it.each(["en", "es"])("discloses the bounded task source in %s", async language => {
  state.language = language; mount();
  await waitFor(() => expect(state.fetch).toHaveBeenCalled());
  expect(screen.getByText(language === "es" ? "Los recuentos reflejan las tareas asignadas en los primeros 50 registros de trabajo devueltos." : "Counts reflect assigned tasks in the first 50 work records returned.")).toBeTruthy();
});
