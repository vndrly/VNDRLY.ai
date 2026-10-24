import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GateRecentShiftNotes from "./gate-recent-shift-notes";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: api.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, vendorId: 4, activeMembershipId: 2 } }) }));
beforeEach(() => { api.request.mockReset(); });
afterEach(cleanup);
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateRecentShiftNotes stationId="gate-2" siteId={9} /></QueryClientProvider>); }
it("loads only when expanded, links the last ten exact notes, and retains the all-notes link", async () => {
  api.request.mockResolvedValue({ rows: Array.from({ length: 12 }, (_, index) => ({ id: `note-${index}`, site_id: 9,
    outgoing_name: `Gatekeeper ${index}`, outgoing_user_id: index === 0 ? 7 : 8,
    filed_at: "2026-09-01T10:00:00Z", acknowledged_at: "2026-09-02T12:00:00Z", viewed_at: index < 2 ? "2026-10-01T12:00:00Z" : null })) });
  mount();
  expect(api.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Read shift notes"));
  const own = (await screen.findByText("Gatekeeper 0")).closest("a")!;
  expect(api.request).toHaveBeenCalledWith("/gate-2/notes?limit=10");
  expect(screen.getAllByRole("link")).toHaveLength(11);
  expect(own.getAttribute("href")).toBe("/gate/shift-notes?stationId=gate-2&handoffId=note-0&siteId=9");
  expect(own.getAttribute("data-own")).toBe("true");
  expect(own.getAttribute("data-viewed")).toBe("true");
  expect(own.querySelector("time")?.dateTime).toBe("2026-09-01T10:00:00Z");
  expect(screen.getByText("Gatekeeper 1").closest("a")?.getAttribute("data-viewed")).toBe("true");
  expect(screen.getByText("Gatekeeper 2").closest("a")?.getAttribute("data-viewed")).toBe("false");
  expect(screen.getByRole("link", { name: "All shift notes ›" }).getAttribute("href")).toBe("/gate/shift-notes?stationId=gate-2&siteId=9");
  expect(api.request.mock.calls.every(call => call.length === 1)).toBe(true);
  fireEvent.click(screen.getByText("Read shift notes"));
  await waitFor(() => expect(screen.getByText("Read shift notes").closest("details")?.open).toBe(false));
});
it("keeps the all-notes link available when the recent request fails", async () => {
  api.request.mockRejectedValue(new Error("offline"));
  mount(); fireEvent.click(screen.getByText("Read shift notes"));
  expect(await screen.findByText("Shift notes unavailable.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "All shift notes ›" })).toBeTruthy();
  expect(screen.queryByText("No filed shift notes.")).toBeNull();
});
