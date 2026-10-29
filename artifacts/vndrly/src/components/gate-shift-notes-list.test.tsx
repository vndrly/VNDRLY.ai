import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), watch: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: mock.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, activeMembershipId: 3, vendorId: 2 } }) }));
vi.mock("./gate-report-toolbar", () => ({ GateReportToolbar: ({ filters, dropdown, disabled }: any) => <select aria-label="Export" disabled={disabled} data-site={filters?.siteId} data-station={filters?.stationId} data-search={filters?.search} data-days={filters?.range} data-dropdown={String(dropdown)}><option>Export</option><option>PDF</option><option>Excel</option><option>Word</option><option>Email</option></select> }));
import GateShiftNotesList from "./gate-shift-notes-list";
const note = (id: number) => ({ id: `note-${id}`, notes: `Shift note ${id}`, outgoing_name: "Outgoing", incoming_name: "Incoming", filed_at: "2026-10-27T12:00:00Z", acknowledged_at: "2026-10-27T12:01:00Z", viewed_at: null, summary: { facts: [] }, snapshot: { openItems: [], metrics: { checkIns: 2, checkOuts: 1, pendingAdmission: 3 }, exceptions: [] } });
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState({}, "", "/gate/shift-notes");
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: mock.watch.mockReturnValue(9), clearWatch: mock.clear } });
  mock.request.mockImplementation(async (path: string) => {
    if (path === "/sites?mode=history") return { sites: [{ id: 1, name: "Site A", latitude: 31, longitude: -102 }] };
    if (path.startsWith("/stations?")) return { stations: [{ id: "a", name: "Main Gate", active: true, latitude: 31, longitude: -102 }, { id: "b", name: "North Gate", active: true }, { id: "old", name: "Main gate", active: false }] };
    if (path.endsWith("/viewed")) return { viewed: true };
    return { rows: Array.from({ length: 7 }, (_, i) => note(i)), nextBefore: null, actions: [] };
  });
});
afterEach(() => cleanup());
async function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateShiftNotesList /></QueryClientProvider>); fireEvent.click(await screen.findByText("Site A | Main Gate", { selector: "summary span" })); }
it("groups notes by authorized gate for 30 days without a five-note cap, and marks only expanded notes viewed", async () => {
  await mount(); const record = await screen.findAllByText(/Oct 27, 2026/); expect(record).toHaveLength(7);
  expect(mock.request).toHaveBeenCalledWith("/a/notes?days=30");
  expect(mock.request.mock.calls.some(([path]) => path.endsWith("/viewed"))).toBe(false);
  fireEvent.click(record[0]);
  expect(await screen.findByText("Shift note 0")).toBeTruthy();
  await waitFor(() => expect(mock.request).toHaveBeenCalledWith("/a/notes/note-0/viewed", {}));
  fireEvent.change(screen.getByTestId("select-shift-notes-location"), { target: { value: "a" } });
  expect(screen.getByRole("combobox", { name: "Export" }).getAttribute("data-days")).toBe("30d");
  expect(screen.getByRole("combobox", { name: "Export" }).getAttribute("data-dropdown")).toBe("true");
});
it("uses one combined selector with a real GPS match indicator and switches gate scope", async () => {
  await mount(); const selector = await screen.findByTestId("select-shift-notes-location");
  await screen.findByText("Site A | Main Gate", { selector: "summary span" });
  fireEvent.change(selector, { target: { value: "a" } });
  act(() => mock.watch.mock.calls[0][0]({ coords: { latitude: 31, longitude: -102 } }));
  expect(screen.getByTestId("gate-gps-indicator").getAttribute("data-gps-status")).toBe("verified");
  fireEvent.change(selector, { target: { value: "b" } });
  await waitFor(() => expect(mock.request).toHaveBeenCalledWith("/b/notes?days=30"));
  expect(screen.queryByText("Site A | Main Gate", { selector: "summary span" })).toBeNull();
});
it("shows per-gate empty and error states without inventing notes", async () => {
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async path => path.startsWith("/a/notes?") ? { rows: [], nextBefore: null, actions: [] } : base(path));
  await mount(); expect(await screen.findByText("No shift notes in the last 30 days.")).toBeTruthy();
});
it("loads further notes with a timestamp and identity cursor", async () => {
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async path => path === "/a/notes?days=30" ? { rows: [note(1)], nextBefore: "2026-10-27T12:01:00Z", nextBeforeId: "note-1" } : path.startsWith("/a/notes?") ? { rows: [note(2)], nextBefore: null } : base(path));
  await mount(); fireEvent.click(await screen.findByRole("button", { name: "Load more from the last 30 days" }));
  await waitFor(() => expect(mock.request.mock.calls.some(([path]) => path.includes("beforeId=note-1"))).toBe(true));
  await waitFor(() => expect(screen.getAllByText(/Oct 27, 2026/)).toHaveLength(2));
});

it("exports the full selected site for 30 days regardless of gate or search", async () => {
  await mount();
  fireEvent.change(screen.getByTestId("select-shift-notes-location"), { target: { value: "a" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Search notes" }), { target: { value: "radio" } });
  const exporter = screen.getByRole("combobox", { name: "Export" });
  expect(exporter.getAttribute("data-days")).toBe("30d"); expect(exporter.getAttribute("data-site")).toBe("1");
  expect(exporter.getAttribute("data-station")).toBeNull(); expect(exporter.getAttribute("data-search")).toBeNull();
});

it("does not present empty inactive duplicate Main gates as additional locations", async () => {
  await mount();
  expect(screen.queryByRole("option", { name: "Site A | Main gate" })).toBeNull();
  expect(mock.request.mock.calls.some(([path]) => path.startsWith("/old/notes"))).toBe(false);
  expect(screen.getByRole("option", { name: "Site A | Main Gate" })).toBeTruthy();
});
