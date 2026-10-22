import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import WorkforcePanel from "./workforce-panel";

const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), navigate: vi.fn(), user: { userId: 7, vendorId: 1, activeMembershipId: 3, vendorRole: "gate_supervisor", role: "field_employee" } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a6b2", name: "MidCon" }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/work-hub", mocks.navigate], Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: mocks.request }));
vi.mock("@/lib/workforce-offer-client", async original => ({ ...await original<any>(), fingerprintWorkforceAttempt: async () => "a".repeat(64), submitWorkforceAttempt: async (attempt: any, http: any) => (await original<any>()).submitWorkforceAttempt(attempt, http, async () => "a".repeat(64)) }));
vi.mock("@/components/mini-card-dialog-content", () => ({ default: ({ children, label }: any) => <div role="dialog" aria-label={label}>{children}</div> }));

const shiftId = "11111111-1111-4111-8111-111111111111", offerId = "33333333-3333-4333-8333-333333333333";
const employee = (userId: number, name: string, onCall: string, onShift: boolean | null) => ({ userId, vendorPeopleId: userId + 100, name, onCall, onShift, assignment: "North Gate", shiftStartedAt: null, profileHref: `/field-employees/${userId + 100}`, canMessage: userId !== 7 });
const staff = [employee(8, "Alex Gate", "active", true), employee(9, "Sam Gate", "inactive", false), employee(10, "Jo Gate", "unknown", null)];
const candidate = { vendorPeopleId: 108, userId: 8, name: "Alex Gate", requirements: [], qualificationState: "unknown_no_configured_requirements", availability: "recorded_available", eligibility: { allowed: true, code: "workforce.assignment_allowed", warnings: [], overrideRequired: false }, contact: { workHubUserId: 8, reachability: "unknown" }, sourceReference: "vendor_people:108" };
const evidence = { shiftId, shiftVersion: 3, siteId: 9, startsAt: "2099-01-01T12:00:00Z", endsAt: "2099-01-01T20:00:00Z", observedAt: "2026-10-22T12:00:00Z", candidates: [candidate], truncated: false, coverage: null, assignmentMade: false, messageSent: false, limitations: [], qualificationConfiguration: "none_configured" };
let offers: any[], receipt: any, incoming: any[];
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return { client, view: render(<QueryClientProvider client={client}><WorkforcePanel /></QueryClientProvider>) };
}
async function openGap() {
  fireEvent.click(await screen.findByRole("button", { name: /Coverage Gaps.*1 open/ }));
  fireEvent.click(screen.getByText("North Gate AM"));
  return await screen.findByRole("button", { name: "Offer Shift" });
}
describe("Workforce panel", () => {
  beforeEach(() => {
    sessionStorage.clear(); offers = []; receipt = null; incoming = [];
    mocks.user = { userId: 7, vendorId: 1, activeMembershipId: 3, vendorRole: "gate_supervisor", role: "field_employee" };
    mocks.request.mockReset(); mocks.navigate.mockReset(); mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ coverage: [{ id: "gap", shiftId, shiftTitle: "North Gate AM", startsAt: evidence.startsAt, assignedCount: 0, requiredCount: 1, state: "gap" }] }) });
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/workforce/roster") return { owner: { type: "vendor", id: 1 }, observedAt: evidence.observedAt, scope: "company", employees: staff, canManageOffers: true };
      if (path === "/workforce/offers") return { offers: incoming };
      if (path.endsWith("/staffing-candidates")) return evidence;
      if (path.includes("/operations/")) return { receipt };
      if (path.endsWith("/offers") && init?.method !== "POST") return { shiftVersion: 3, offers };
      if (init?.method === "POST" && path.endsWith("/offers")) {
        const input = JSON.parse(init.body as string);
        receipt = { ...input, actorUserId: 7, shiftId, offerId, status: "pending", previousVersion: 3, resultingVersion: 3, assignmentRecorded: false, commandFingerprint: "a".repeat(64), recordedAt: evidence.observedAt };
        delete receipt.expectedVersion;
        offers = [{ id: offerId, shiftId, workerUserId: input.workerUserId, workerName: "Alex Gate", status: "pending", createdAt: evidence.observedAt, decidedAt: null }];
        return receipt;
      }
      if (path === "/chats") return { channel: { id: "company-chat" } };
      throw Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("places On Call under paid shifts, separates unknown, and opens work profiles and a conversation", async () => {
    mount();
    await screen.findByRole("button", { name: /On Call.*1 on call/ });
    const rows = screen.getAllByRole("button", { name: /On Shift Now|On Call.*on call/ });
    expect(rows.map(row => row.textContent)).toEqual(["On Shift Now1 on shift", "On Call1 on call · 1 unavailable"]);
    fireEvent.click(rows[1]);
    const call = screen.getByRole("region", { name: "Employee availability" });
    expect(within(call).getByRole("button", { name: "Available · 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(call).getByRole("button", { name: /Alex Gate/ })).toBeTruthy();
    fireEvent.click(within(call).getByRole("button", { name: "Unavailable · 1" }));
    expect(within(call).getByRole("button", { name: /Sam Gate/ })).toBeTruthy();
    expect(within(call).queryByText("Jo Gate")).toBeNull();
    fireEvent.click(within(call).getByRole("button", { name: "Unknown · 1" }));
    fireEvent.click(within(call).getByRole("button", { name: /Jo Gate/ }));
    const profile = screen.getByRole("dialog", { name: "Jo Gate" });
    expect(within(profile).getByRole("link", { name: "Open employee profile" }).getAttribute("href")).toBe("/field-employees/110");
    fireEvent.click(within(profile).getByRole("button", { name: "Message employee" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/work-hub/chat?channel=company-chat"));
    expect(mocks.request).toHaveBeenCalledWith("/chats", { method: "POST", headers: { "X-VNDRLY-Actor-User": "7", "X-VNDRLY-Vendor": "1", "X-VNDRLY-Membership": "3" }, body: JSON.stringify({ recipientUserId: 10 }) });
    expect(mocks.request.mock.calls.some(([path]) => path.includes("/messages"))).toBe(false);
  });
  it("uses the roster paid clock for On Shift Now and offers an Off Shift list", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: /On Shift Now.*1 on shift/ }));
    const shifts = screen.getByRole("region", { name: "Employee shifts" });
    expect(within(shifts).getByRole("button", { name: /Alex Gate/ })).toBeTruthy();
    fireEvent.click(within(shifts).getByRole("button", { name: "Off Shift · 1" }));
    expect(within(shifts).getByRole("button", { name: /Sam Gate/ })).toBeTruthy();
    expect(mocks.fetch.mock.calls.some(([path]) => path.includes("coverage-map"))).toBe(false);
  });
  it("persists an offer and displays canonical Pending without assigning anyone", async () => {
    mount(); fireEvent.click(await openGap());
    expect(await screen.findByText("Offered · Pending")).toBeTruthy();
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.request.mock.calls.some(([path]) => path.includes("/assignments"))).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });
  it("requires verified availability and qualifications before enabling an offer", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path, ...args) => path.endsWith("/staffing-candidates") ? { ...evidence, qualificationConfiguration: "unknown" } : original(path, ...args));
    mount(); expect((await openGap() as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows the newest saved offer after a previous decline", async () => {
    offers = [{ id: "44444444-4444-4444-8444-444444444444", shiftId, workerUserId: 8, workerName: "Alex Gate", status: "declined", createdAt: "2026-10-21T12:00:00Z", decidedAt: evidence.observedAt }, { id: offerId, shiftId, workerUserId: 8, workerName: "Alex Gate", status: "pending", createdAt: evidence.observedAt, decidedAt: null }];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Coverage Gaps.*1 open/ }));
    fireEvent.click(screen.getByText("North Gate AM"));
    expect(await screen.findByText("Offered · Pending")).toBeTruthy();
    expect(screen.queryByText("Declined")).toBeNull();
  });
  it("binds requests to the displayed actor and membership when a shared cookie changes", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path, ...args) => path === "/workforce/roster" ? original(path, ...args).then((value: any) => ({ ...value, owner: { type: "vendor", id: 2 } })) : original(path, ...args));
    mount();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/workforce/roster", { headers: { "X-VNDRLY-Actor-User": "7", "X-VNDRLY-Vendor": "1", "X-VNDRLY-Membership": "3" } }));
    expect(screen.queryByText("Alex Gate")).toBeNull();
    expect(screen.getByRole("button", { name: "On CallUnavailable" })).toBeTruthy();
  });
  it("shows unavailable instead of zero and discards the previous membership roster", async () => {
    const { client, view } = mount();
    fireEvent.click(await screen.findByRole("button", { name: /On Call.*1 on call/ }));
    await screen.findByRole("button", { name: /Alex Gate/ });
    mocks.user = { ...mocks.user, activeMembershipId: 4, vendorId: 2 };
    mocks.request.mockRejectedValue(Error("forbidden"));
    view.rerender(<QueryClientProvider client={client}><WorkforcePanel /></QueryClientProvider>);
    expect(screen.queryByText("Alex Gate")).toBeNull();
    expect(await screen.findByRole("button", { name: "On CallUnavailable" })).toBeTruthy();
  });
});
