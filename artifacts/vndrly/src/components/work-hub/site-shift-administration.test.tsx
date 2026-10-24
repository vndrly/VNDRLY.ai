import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SiteShiftAdministration from "./site-shift-administration";
const state = vi.hoisted(() => ({ user: { userId: 1, role: "vendor", membershipRole: "admin", vendorId: 5 }, request: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@workspace/api-client-react", () => ({ useListSiteLocations: () => ({ data: [{ id: 7, name: "North site" }] }), useListVendors: () => ({ data: [] }), useListPartners: () => ({ data: [] }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ color, children, ...props }: any) => <button type="button" {...props}>{children}</button> }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: state.request }));
const saved = { revision: "a".repeat(64), mode: "part_time", shifts: [] };
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SiteShiftAdministration /></QueryClientProvider>); }
beforeEach(() => { state.user.membershipRole = "admin"; state.request.mockReset().mockImplementation(async (path: string) => path.startsWith("/site-shift-plans?") ? { sites: [{ id: 7, name: "North site" }] } : saved); });
describe("site shift administration", () => {
  it("hides administrative controls from employees", () => { state.user.membershipRole = "field_employee"; mount(); expect(screen.queryByText("Administrative functions")).toBeNull(); });
  it("creates three editable shifts and saves weekly headcounts for the selected site", async () => {
    mount(); await screen.findByRole("option", {name:"North site"}); fireEvent.change(screen.getByLabelText("Site location"), { target: { value: "7" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save weekly shifts" }) as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
    fireEvent.change(screen.getByLabelText("Coverage"), { target: { value: "24_hour" } });
    expect(screen.getByLabelText("Shift 3 end time")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Shift 2 people needed"), { target: { value: "4" } });
    state.request.mockResolvedValueOnce({ resource: { ...saved, mode: "24_hour", shifts: [{ startsAtLocal: "08:00", endsAtLocal: "08:00", requiredCount: 4, weekdays: [1] }] } });
    fireEvent.click(screen.getByRole("button", { name: "Save weekly shifts" }));
    await screen.findByText("Weekly shift definitions saved.");
    const [path, options] = state.request.mock.calls.at(-1)!;
    expect(path).toBe("/site-shift-plans/7");
    const body = JSON.parse(options.body);
    expect(body.payload.plan.shifts).toHaveLength(3);
    expect(body.payload.plan.shifts[1].requiredCount).toBe(4);
    expect(body.payload.plan.shifts[1].weekdays).toEqual([1, 2, 3, 4, 5]);
  });
  it("retries a failed site list without showing an empty-list message", async () => {
    state.request.mockRejectedValueOnce(new Error("Unavailable")); mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Sites could not load.");
    expect(screen.queryByText("No sites are currently available for this company.")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name:"Retry"}));
    await screen.findByRole("option", {name:"North site"});
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("uses the scheduling site list without a redundant catalog request", async () => {
    mount(); await screen.findByRole("option", {name:"North site"});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.request.mock.calls).toHaveLength(1);
  });
  it("blocks saves when the API is unavailable", async () => {
    state.request.mockImplementation(async (path: string) => { if(path.startsWith("/site-shift-plans?")) return {sites:[{id:7,name:"North site"}]}; throw new Error("Unavailable"); }); mount();
    await screen.findByRole("option", {name:"North site"});
    fireEvent.change(screen.getByLabelText("Site location"), { target: { value: "7" } });
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Save weekly shifts" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

