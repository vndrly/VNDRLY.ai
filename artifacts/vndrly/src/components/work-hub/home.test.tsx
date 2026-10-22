import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ActivityWorkspace } from "./collaboration";

const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), categories: ["gate"], user: { userId: 7, role: "field_employee", vendorId: 1, activeMembershipId: 3, vendorRole: "gatekeeper" } as Record<string, unknown> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ name: "MidCon Solutions", primary: "#00a6b2" }) }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: mocks.request }));

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) { return render(<QueryClientProvider client={client}><ActivityWorkspace /></QueryClientProvider>); }
describe("Work Hub home", () => {
  beforeEach(() => {
    mocks.categories = ["gate"];
    mocks.user = { userId: 7, role: "field_employee", vendorId: 1, activeMembershipId: 3, vendorRole: "gatekeeper" };
    mocks.request.mockReset(); mocks.fetch.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/home")) return { tasks: [{ id: "t1", title: "Inspect gate camera", status: "open" }, { id: "done", title: "Finished", status: "completed" }], shifts: [], meetings: [{ occurrence: { startsAt: "2099-01-01" } }], announcements: [], capabilities: { canViewExports: false, allowedExportDatasets: [] } };
      if (path === "/channels") return [{ id: "c1", unreadCount: 4 }];
      return [];
    });
    mocks.fetch.mockImplementation(async (path: string) => ({ ok: true, json: async () => {
      if (path === "/api/company-operations") return { categories: mocks.categories };
      if (path === "/api/gate-change-over/sites") return { sites: [{ id: 9, name: "North Gate" }] };
      if (path.startsWith("/api/visits?")) return [{ id: 10, admissionStatus: "pending", vehiclePlate: "ABC123" }];
      if (path.startsWith("/api/safety/events")) return { data: [] };
      if (path.startsWith("/api/notifications")) return [];
      return {};
    }}));
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("shows the iOS groups and opens real assigned gate work without exposing Fleet", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Work Hub" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Communications" })).toBeTruthy();
    const chats = await screen.findByRole("link", { name: /Chats.*4 unread/ });
    expect(chats.getAttribute("href")).toBe("/work-hub/chat");
    fireEvent.click(screen.getByRole("button", { name: /My Work/ }));
    expect(await screen.findByRole("link", { name: /North Gate/ })).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Inspect gate camera/ })).toBeTruthy();
    expect(screen.queryByText("Finished")).toBeNull();
    expect(screen.queryByRole("link", { name: "Exports" })).toBeNull();
    expect(screen.queryByText("Fleet Ops")).toBeNull();
    expect(mocks.fetch.mock.calls.some(([path]) => String(path).includes("/fleet/"))).toBe(false);
  });
  it("does not request Gate records for a company without Gate enabled", async () => {
    mocks.user = { ...mocks.user, vendorRole: "field" }; mocks.categories = ["field"];
    mount(); await screen.findByRole("heading", { name: "Today" });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/company-operations", expect.anything()));
    expect(screen.queryByRole("region", { name: "Gate desk" })).toBeNull();
    expect(mocks.fetch.mock.calls.some(([path]) => String(path).includes("gate-change-over") || String(path).startsWith("/api/visits?"))).toBe(false);
  });
  it("keeps failed Gate data unavailable instead of reporting zero visitors", async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (path: string, ...args: unknown[]) => path.startsWith("/api/visits?") ? { ok: false } : original(path, ...args));
    mount();
    const desk = await screen.findByRole("region", { name: "Gate desk" });
    expect(await within(desk).findByRole("link", { name: /Visitors.*Unavailable/ })).toBeTruthy();
  });
  it("drops the previous company's Gate records when the membership changes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = mount(client);
    fireEvent.click(await screen.findByRole("button", { name: /My Work/ }));
    await screen.findByRole("link", { name: /North Gate/ });
    mocks.user = { ...mocks.user, vendorId: 2, activeMembershipId: 4, vendorRole: "field" };
    mocks.categories = ["field"];
    view.rerender(<QueryClientProvider client={client}><ActivityWorkspace /></QueryClientProvider>);
    expect(screen.queryByRole("link", { name: /North Gate/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Gate desk" })).toBeNull();
  });
});
