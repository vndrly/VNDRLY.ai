import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountWorkspace, canUseGateWorkspace } from "./account-workspace";

const mocks = vi.hoisted(() => ({ user: null as any, overview: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: { overview: mocks.overview } }));
function mount(categories: string[] = []) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AccountWorkspace categories={categories} /></QueryClientProvider>); }
const viewer = (role = "field_employee", vendorRole: string | null = "field") => ({ userId: 7, activeMembershipId: 3, vendorId: 1, partnerId: null, role, vendorRole, availableMemberships: [{ id: 3, role: "field_employee" }] });

describe("account and company Work Hub tools", () => {
  beforeEach(() => { mocks.user = viewer(); mocks.overview.mockReset(); mocks.overview.mockResolvedValue({ enabled: true, capabilities: { canDrive: true } }); });
  it.each([["field", "/field/schedule", "Field workspace"], ["foreman", "/foreman/schedule", "Crew workspace"]])("opens %s employees' own portal tools", async (role, path, title) => {
    mocks.user = viewer("field_employee", role);
    mount(["field"]);
    expect(screen.getByRole("region", { name: title })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Schedule" }).getAttribute("href")).toBe(path);
    expect(screen.queryByRole("link", { name: "Employees" })).toBeNull();
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("gives office staff field oversight without company administration", () => {
    mocks.user = viewer("vendor", "office"); mount(["field"]);
    expect(screen.getByRole("link", { name: "Tracking" }).getAttribute("href")).toBe("/tickets");
    expect(screen.getByRole("link", { name: "Company profile" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Employees" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Scheduling & coverage" })).toBeNull();
  });
  it("only adds company management tools for current organization administrators", () => {
    mocks.user = { ...viewer("vendor", "office"), availableMemberships: [{ id: 3, role: "admin" }] };
    mount(["gate"]);
    expect(screen.getByRole("link", { name: "Employees" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Scheduling & coverage" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Field workspace" })).toBeNull();
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("keeps Gate supervisors' scheduling separate from company administration", () => {
    mocks.user = viewer("vendor", "gate_supervisor"); mount(["gate"]);
    expect(screen.getByRole("link", { name: "Scheduling & coverage" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Employees" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Company profile" })).toBeNull();
  });
  it("shows a driver's day without dispatch controls", async () => {
    mount(["fleet"]);
    expect((await screen.findByRole("link", { name: "My Fleet Day" })).getAttribute("href")).toBe("/fleet/my-day");
    expect(screen.queryByRole("link", { name: "Dispatch desk" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Run reviews" })).toBeNull();
  });
  it("shows dispatch and equipment only with the returned Fleet capabilities", async () => {
    mocks.overview.mockResolvedValue({ enabled: true, capabilities: { canDispatch: true, canManageResources: true } });
    mount(["fleet"]);
    expect(await screen.findByRole("link", { name: "Dispatch desk" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Equipment" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "My Fleet Day" })).toBeNull();
  });
  it("never offers Fleet for a disabled company even to an administrator who can set it up", async () => {
    mocks.user = { ...viewer("vendor", "office"), availableMemberships: [{ id: 3, role: "admin" }] };
    mocks.overview.mockResolvedValue({ enabled: false, capabilities: { canSetup: true, canManage: true } });
    mount(["fleet"]);
    await waitFor(() => expect(mocks.overview).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Fleet workspace" })).toBeNull();
  });
  it("keeps partner oversight out of vendor administration and Fleet staff tools", () => {
    mocks.user = { ...viewer("partner", null), vendorId: null, partnerId: 4 }; mount([]);
    expect(screen.getByRole("region", { name: "Partner workspace" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Site map" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Company profile" })).toBeNull();
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("keeps platform administration separate from organization roles", () => {
    mocks.user = { ...viewer("admin", null), vendorId: null }; mount([]);
    expect(screen.getByRole("link", { name: "Platform settings" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Company workspace" })).toBeNull();
  });
  it("keeps a managed worker's hours and site grants separate from company permissions", () => {
    mocks.user = { ...viewer(), managedSubcontractor: { siteGrants: [{ siteId: 9, role: "gatekeeper" }] } };
    mount(["field", "fleet", "gate"]);
    expect(screen.getByRole("link", { name: "My hours & calendar" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Field workspace" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Company workspace" })).toBeNull();
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(canUseGateWorkspace(mocks.user, ["gate"])).toBe(true);
    expect(canUseGateWorkspace({ ...mocks.user, managedSubcontractor: { siteGrants: [] } }, ["gate"])).toBe(false);
  });
  it("does not show Gate merely because a field employee's company also operates gates", () => {
    expect(canUseGateWorkspace(viewer(), ["field", "gate"])).toBe(false);
    expect(canUseGateWorkspace(viewer("field_employee", "gatekeeper"), ["gate"])).toBe(true);
    expect(canUseGateWorkspace(viewer("vendor", "office"), ["gate"])).toBe(true);
    expect(canUseGateWorkspace(viewer("vendor", "office"), ["field"])).toBe(false);
  });
});
