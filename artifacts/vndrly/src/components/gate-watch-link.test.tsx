import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GateWatchLink from "./gate-watch-link";

const state = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: state.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, vendorId: 4, activeMembershipId: 2 } }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/work-hub/calendar", state.navigate] }));
const caches: QueryClient[] = [];
const current = () => ({ site: { id: 21, name: "West site" }, station: { id: "west", name: "West Gate" }, shift: null, preparation: null, snapshot: { revision: "saved" } });
const context = () => ({ shiftId: "night-1", date: "2026-11-09", startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString() });
beforeEach(() => {
  state.request.mockReset().mockImplementation(async path => path.split("?")[0].endsWith("/state") ? current() : {});
  state.navigate.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); });
function mount(extra = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); caches.push(cache);
  return render(<QueryClientProvider client={cache}><GateWatchLink stationId="west" siteId={21} {...extra} /></QueryClientProvider>);
}
it("rejects a stale calendar site instead of offering to assume another site's gate", async () => {
  state.request.mockResolvedValue({ ...current(), site: { id: 22, name: "Other site" } });
  mount({ calendarContext: context() });
  const action = await screen.findByRole("button", { name: "Assume Watch" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(true));
  expect(await screen.findByText(/calendar gate could not be verified/i)).toBeTruthy();
});
it("does not offer a present watch for a future calendar shift", async () => {
  mount({ calendarContext: { ...context(), startsAt: new Date(Date.now() + 60_000).toISOString() } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Assume Watch" }) as HTMLButtonElement).disabled).toBe(true));
  expect(await screen.findByText(/only while this scheduled watch is current/i)).toBeTruthy();
});
it("reviews the calendar's exact gate and preserves the saved watch when the calendar is left", async () => {
  const view = mount({ calendarContext: context() });
  const action = await screen.findByRole("button", { name: "Assume Watch" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  expect(state.request).toHaveBeenCalledWith("/west/state?purpose=assume");
  fireEvent.click(action);
  const confirm = await screen.findByRole("button", { name: "ASSUME" });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(state.request).toHaveBeenCalledWith("/west/watch/assume", expect.objectContaining({ expectedWatchId: null, source: "web", acknowledged: true }));
  view.unmount();
  expect(state.request.mock.calls.filter(([, body]) => body)).toHaveLength(1);
  expect(state.navigate).not.toHaveBeenCalled();
});
it("keeps the same scheduled shift and date when an already held watch opens its explicit handoff page", async () => {
  state.request.mockResolvedValue({ ...current(), shift: { id: "actual-watch", operator_id: 7 } });
  mount({ calendarContext: context() });
  const action = await screen.findByRole("button", { name: "Handover Watch" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(action);
  expect(state.navigate).toHaveBeenCalledWith("/gate/change-over?siteId=21&stationId=west&shiftId=night-1&date=2026-11-09");
  expect(state.request.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});
