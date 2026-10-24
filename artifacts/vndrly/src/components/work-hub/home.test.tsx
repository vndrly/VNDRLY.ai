import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { summarizeWorkday, type WorkdayEvent } from "@workspace/api-zod";
import DashboardTasks from "./dashboard-tasks";
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
      if (path.startsWith("/tasks?dashboard=1")) return { scope: "self", nextCursor: null, tasks: [
        { id: "t1", title: "Inspect gate camera", status: "open", assigneeUserId: 7, createdAt: new Date(Date.now() - 3600000).toISOString() },
        { id: "done", title: "Finished", status: "completed", assigneeUserId: 7, createdAt: "2026-10-21T22:00:00Z", completedAt: "2026-10-22T00:00:00Z" },
      ] };
      if (path.startsWith("/workday/workers/")) { const query = new URL(path, "https://example.test").searchParams; return { items: [], range: { start: query.get("start"), end: query.get("end") }, nextCursor: null }; }
      if (path.startsWith("/home")) return { tasks: [{ id: "t1", title: "Inspect gate camera", status: "open", assigneeUserId: 7, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T01:00:00Z" }, { id: "done", title: "Finished", status: "completed", assigneeUserId: 7, createdAt: "2026-10-21T22:00:00Z", updatedAt: "2026-10-22T00:00:00Z" }], shifts: [], meetings: [{ occurrence: { startsAt: "2099-01-01" } }], announcements: [], capabilities: { canViewExports: false, allowedExportDatasets: [] } };
      if (path === "/workforce/roster") return { owner: { type: "vendor", id: 1 }, observedAt: "2026-10-22T12:00:00Z", scope: "self", canManageOffers: false, employees: [{ userId: 8, vendorPeopleId: 108, name: "Alex Gate", onCall: "active", onShift: true, shiftStartedAt: null, assignment: "North Gate", profileHref: null, canMessage: true }] };
      if (path === "/workforce/offers") return { offers: [] };
      if (path === "/channels") return [{ id: "c1", unreadCount: 4 }];
      return [];
    });
    mocks.fetch.mockImplementation(async (path: string) => ({ ok: true, json: async () => {
      if (path === "/api/company-operations") return { categories: mocks.categories };
      if (path === "/api/gate-change-over/sites") return { sites: [{ id: 9, name: "North Gate" }] };
      if (path === "/api/gate-change-over/coverage-map") return { staff: [{ userId: 8, name: "Alex Gate", onDuty: true, assignment: "North Gate" }], duties: [] };
      if (path === "/api/implementation-a/workforce/coverage") return { coverage: [{ id: "gap-1", shiftId: "11111111-1111-4111-8111-111111111111", shiftTitle: "North Gate AM", startsAt: "2099-01-01T12:00:00Z", assignedCount: 1, requiredCount: 2, state: "gap" }] };
      if (path.startsWith("/api/work-hub/shifts/") && path.endsWith("/staffing-candidates")) return { candidates: [{ userId: 22, name: "Jordan Relief", availability: "recorded_available", eligibility: { allowed: true } }] };
      if (path.startsWith("/api/visits?")) return [{ id: 10, admissionStatus: "pending", vehiclePlate: "ABC123" }];
      if (path.startsWith("/api/safety/events")) return { data: [] };
      if (path.startsWith("/api/notifications")) return [];
      return {};
    }}));
    vi.stubGlobal("fetch", mocks.fetch);
  });
  it("places workforce and assigned-task multi-panel cards with the primary cards", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Workforce" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByText("A task is an unticketed work assignment")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Tasks & Forms/ }).getAttribute("href")).toBe("/work-hub/tasks");
    fireEvent.click(await screen.findByRole("button", { name: /Coverage Gaps.*1 open/ }));
    const gap = await screen.findByRole("region", { name: "Coverage gap details" });
    expect(within(gap).getByText("North Gate AM")).toBeTruthy();
    fireEvent.click(within(gap).getByText("North Gate AM"));
    expect(await within(gap).findByRole("link", { name: "Open shift" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /On Shift Now.*1 on shift/ }));
    expect(await screen.findByRole("button", { name: /Alex Gate.*North Gate/ })).toBeTruthy();

  });
  it("opens assigned Dashboard tasks without counting task age as worked hours", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DashboardTasks /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /New.*1/ }));
    const task = await screen.findByRole("link", { name: /Inspect gate camera.*open/ });
    expect(task.getAttribute("href")).toBe("/work-hub/tasks?task=t1");
    expect(await screen.findByRole("button", { name: /Hours.*0h 0m this month/ })).toBeTruthy();
    expect(screen.queryByText(/1.0 h/)).toBeNull();
    for (const name of [/New.*1/, /In Progress.*0/, /Completed.*1/]) {
      const row = screen.getByRole("button", { name });
      if (row.getAttribute("aria-expanded") !== "true") fireEvent.click(row);
      const details = screen.getByRole("region", { name: "Assigned task details" });
      expect(details.previousElementSibling).toBe(row);
      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("region", { name: "Assigned task details" })).toBeNull();
    }
  });
  it("expands Hours under its row, reads this month's period, and links each recorded shift to its calendar day", async () => {
    const original = mocks.request.getMockImplementation()!;
    const id = "11111111-1111-4111-8111-111111111111", owner = { type: "vendor" as const, id: 1 };
    const now = new Date(), times = [new Date(now.getFullYear(), now.getMonth(), 1, 8).toISOString(), new Date(now.getFullYear(), now.getMonth(), 1, 15, 45).toISOString()];
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const events: WorkdayEvent[] = times.map((at, index) => ({ id: index ? "22222222-2222-4222-8222-222222222222" : id, shiftId: id, owner, workerUserId: 7, source: "worker_report", kind: index ? "end_shift" : "start_shift", capturedAt: at, receivedAt: at }));
    mocks.request.mockImplementation(async (path: string) => {
      if (!path.startsWith("/workday/workers/")) return original(path);
      const query = new URL(path, "https://example.test").searchParams;
      return { items: [{ id, owner, workerUserId: 7, version: 2, timezone: "America/Chicago", summary: summarizeWorkday(events), reportedWorkMillisecondsInRange: 27900000 }], range: { start: query.get("start"), end: query.get("end") }, nextCursor: null };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardTasks /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Hours/ }));
    const details = screen.getByRole("region", { name: "My shift hours" });
    expect(details.previousElementSibling).toBe(screen.getByRole("button", { name: /Hours/ }));
    await screen.findByRole("button", { name: /Hours.*7h 45m this month/ });
    expect(within(details).getByRole("link").getAttribute("href")).toBe(`/work-hub/calendar?day=${day}&workday=${id}`);
    expect(mocks.request.mock.calls.some(([path]) => {
      const params = new URL(String(path), "https://example.test").searchParams;
      return params.get("start") === new Date(now.getFullYear(), now.getMonth(), 1).toISOString() && params.get("end") === new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    })).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Hours/ }));
    expect(screen.queryByRole("region", { name: "My shift hours" })).toBeNull();
  });
  it("does not reuse a previous account's Dashboard task details after switching membership", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><DashboardTasks /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /New.*1/ }));
    await screen.findByRole("link", { name: /Inspect gate camera/ });
    mocks.user = { ...mocks.user, userId: 8, activeMembershipId: 4 };
    mocks.request.mockRejectedValue(new Error("Unavailable"));
    view.rerender(<QueryClientProvider client={client}><DashboardTasks /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole("link", { name: /Inspect gate camera/ })).toBeNull());
    expect(await screen.findByRole("button", { name: /New.*Unavailable/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Hours.*Unavailable/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Hours.*0h 0m/ })).toBeNull();
  });
  it("shows admin Mine/Total counts, green personal tasks, Unstarted and inline Stale between progress and completed", async () => {
    mocks.user = { ...mocks.user, membershipRole: "admin", vendorRole: "office" };
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string) => path.startsWith("/tasks?dashboard=1") ? {
      scope: "company", nextCursor: null, tasks: [
        ...["open", "in_progress", "completed"].flatMap((status, index) => [7, 8].map(assigneeUserId => ({
          id: `${status}-${assigneeUserId}`, title: `${status} employee ${assigneeUserId}`, assigneeUserId,
          assigneeName: assigneeUserId === 7 ? "My admin account" : "Alex Gate", status,
          createdAt: new Date(Date.now() - (index + 1) * 3600000).toISOString(), completedAt: new Date(Date.now() - 3600000).toISOString(),
        }))),
        { id: "waiting", title: "Waiting task", assigneeUserId: 8, status: "open", createdAt: new Date(Date.now() - 60 * 3600000).toISOString() },
        { id: "stale", title: "Old unfinished task", assigneeUserId: 7, status: "in_progress", createdAt: new Date(Date.now() - 31 * 86400000).toISOString() },
      ],
    } : original(path));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardTasks /></QueryClientProvider>);
    const fresh = await screen.findByRole("button", { name: /New.*1 mine.*2 total/ });
    const names = screen.getAllByRole("button").map(row => row.textContent);
    expect(names.findIndex(name => name?.startsWith("Stale"))).toBe(names.findIndex(name => name?.startsWith("In Progress")) + 1);
    expect(names.findIndex(name => name?.startsWith("Completed"))).toBe(names.findIndex(name => name?.startsWith("Stale")) + 1);
    for (const row of [fresh, screen.getByRole("button", { name: /In Progress.*1 mine.*2 total/ }), screen.getByRole("button", { name: /Completed.*1 mine.*2 total/ })]) {
      fireEvent.click(row);
      const details = screen.getByRole("region", { name: "Assigned task details" });
      expect(details.previousElementSibling).toBe(row);
      expect(within(details).getByRole("link", { name: /employee 7/ }).classList.contains("hub-task-mine")).toBe(true);
      expect(within(details).getByRole("link", { name: /employee 8/ }).classList.contains("hub-task-mine")).toBe(false);
      expect(within(details).getByText(/Alex Gate/)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: /Unstarted.*0 mine.*1 total/ }));
    expect(await screen.findByRole("link", { name: /Waiting task/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Stale.*1 mine.*1 total/ }));
    expect(await screen.findByRole("link", { name: /Old unfinished task/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Waiting task/ })).toBeNull();
  });
  it.each(["admin", "office"])("shows %s personal and company Hours inline, expands employees, and makes only mine green", async mode => {
    mocks.user = { ...mocks.user, vendorRole: mode === "office" ? "office" : null, availableMemberships: [{ id: 3, role: mode === "admin" ? "admin" : "member" }] };
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string) => {
      if (!path.startsWith("/workday/dashboard-hours?")) return original(path);
      const query = new URL(path, "https://example.test").searchParams;
      return { owner: { type: "vendor", id: 1 }, viewerUserId: 7, observedAt: new Date().toISOString(), range: { start: query.get("start"), end: query.get("end") }, mineMilliseconds: 9000000, totalMilliseconds: 27000000,
        employees: [{ userId: 7, name: "My admin account", milliseconds: 9000000 }, { userId: 8, name: "Alex Gate", milliseconds: 18000000 }, { userId: 9, name: "No shifts yet", milliseconds: 0 }] };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardTasks /></QueryClientProvider>);
    const row = await screen.findByRole("button", { name: /Hours.*2h 30m mine.*7h 30m total/ });
    expect(within(row).getByText("2h 30m mine").classList.contains("hub-hours-mine")).toBe(true);
    fireEvent.click(row);
    const details = screen.getByRole("region", { name: "Employee shift hours" });
    expect(details.previousElementSibling).toBe(row);
    expect(within(details).getByText("My admin account").closest(".hub-hours-person")?.classList.contains("hub-hours-mine")).toBe(true);
    expect(within(details).getByText("Alex Gate").closest(".hub-hours-person")?.classList.contains("hub-hours-mine")).toBe(false);
    expect(within(details).getByText("5h 0m")).toBeTruthy();
    expect(within(details).getByText("0h 0m")).toBeTruthy();
    expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith("/workday/workers/"))).toBe(false);
    fireEvent.click(row);
    expect(screen.queryByRole("region", { name: "Employee shift hours" })).toBeNull();
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
