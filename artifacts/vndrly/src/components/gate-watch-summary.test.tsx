import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import GateWatchSummary from "./gate-watch-summary";
const m = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: m.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, vendorId: 4, activeMembershipId: 2 } }) }));
beforeEach(() => { m.request.mockReset(); });
function mount(current: any) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateWatchSummary stationId="gate-1" current={current} /></QueryClientProvider>); }
it("shows only the signed-in operator's watch time and the actual previous handoff", async () => {
  const startedAt = new Date(Date.now() - 90 * 60000).toISOString();
  m.request.mockImplementation(async (path: string) => path.endsWith("/roster") ? { roster: [{ userId: 7, startedAt }] } : { rows: [{ outgoing_name: "Previous operator", acknowledged_at: new Date().toISOString(), notes: "West lane needs attention", snapshot: { openItems: [{ status: "open" }] } }] });
  mount({ shift: { operator_id: 7, started_at: new Date(Date.now() - 90 * 60000).toISOString() } });
  expect(await screen.findByText("1h 30m")).toBeTruthy();
  expect(await screen.findByText("West lane needs attention")).toBeTruthy();
  expect(m.request).toHaveBeenCalledWith("/gate-1/notes?days=30");
});
it("does not count another operator's hours or turn failed notes into an empty handoff", async () => {
  m.request.mockImplementation(async (path: string) => { if (path.endsWith("/roster")) return { roster: [{ userId: 8, startedAt: new Date().toISOString() }] }; throw new Error("offline"); });
  mount({ shift: { operator_id: 8, started_at: new Date(Date.now() - 60 * 60000).toISOString() } });
  expect(await screen.findByText("Not on watch")).toBeTruthy();
  expect(await screen.findByText("Handoff notes unavailable.")).toBeTruthy();
  expect(screen.queryByText("No recorded handoff in the last 30 days.")).toBeNull();
});
