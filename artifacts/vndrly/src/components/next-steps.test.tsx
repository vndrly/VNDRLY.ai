import { useEffect } from "react";
import { cleanup, render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextStepsNavButton, NextStepsProvider, useNextSteps } from "./next-steps";
import { registerGateHelper, type GateHelperKey } from "@/lib/gate-helper-registry";
import type { AccountNextStepsSummary, NextStepWorkflow } from "@/lib/next-steps-model";
const mocks = vi.hoisted(() => ({
  user: { userId: 7, activeMembershipId: 2, vendorId: 4, role: "vendor", vendorRole: "office", availableMemberships: [{ id: 2, role: "admin" }], managedSubcontractor: undefined as undefined | { siteGrants: { siteId: number; role: "gatekeeper" }[] } },
  navigate: vi.fn(), location: "/", summary: { setup: [], credentials: [], firstWatch: null } as AccountNextStepsSummary,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.location, mocks.navigate] }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#187650", name: "Test Company", logoSquareUrl: "/company.png" }) }));
let cache: QueryClient;
const cleanDefinitions: (() => void)[] = [];
const response = (body: unknown, ok = true) => ({ ok, json: async () => structuredClone(body) }) as Response;
beforeEach(() => {
  mocks.user = { userId: 7, activeMembershipId: 2, vendorId: 4, role: "vendor", vendorRole: "office", availableMemberships: [{ id: 2, role: "admin" }], managedSubcontractor: undefined };
  mocks.summary = { setup: [], credentials: [], firstWatch: null };
  mocks.location = "/"; mocks.navigate.mockReset();
  vi.stubGlobal("fetch", vi.fn(async path => response(path === "/api/workflow-helpers/completions" ? { recorded: true, counted: false } : mocks.summary)));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); cache.clear(); cleanDefinitions.splice(0).forEach(clean => clean()); vi.unstubAllGlobals(); });
const noOffers: NextStepWorkflow[] = [];
function ContextProbe({ offers = noOffers }: { offers?: NextStepWorkflow[] }) {
  const state = useNextSteps();
  const publish = state?.setWorkflowOffers;
  useEffect(() => publish?.("actual-saved-blockers", offers), [publish, offers]);
  return <>
    <output data-testid="shared-askv-workflow" data-context={JSON.stringify(state?.assistantContext)} />
    <button onClick={() => void state?.resumeHelper("first-watch")}>Resume setup with askV</button>
    <button onClick={() => state?.updateHelperStep("first-watch", { message: "Review this current form before saving.", action: { title: "Current form step", href: "/work-hub/calendar?siteId=11" } })}>Publish current form step</button>
    <button onClick={() => state?.startHelper("first-watch")}>Start requested gate helper</button>
    <button onClick={() => state?.workerSaved({ kind: "managed", managedWorkerId: "worker-42", managedOrganizationId: "employer-8", userId: 42, name: "Pat Contractor" })}>Save actual worker result</button>
    <button onClick={() => void state?.recordCompletion("gate-watch-handoff", { recordType: "gate-watch", recordId: "saved-watch-2", siteId: 11 })}>Report saved handoff</button>
  </>;
}
function AppView({ page = "Dashboard ready", offers = noOffers, secondButton = false }: { page?: string; offers?: NextStepWorkflow[]; secondButton?: boolean }) {
  return <QueryClientProvider client={cache}><NextStepsProvider><p>{page}</p><a href="/tickets">Other navigation</a><NextStepsNavButton />{secondButton && <NextStepsNavButton />}<ContextProbe offers={offers} /></NextStepsProvider></QueryClientProvider>;
}
function mount(offers = noOffers) { return render(<AppView offers={offers} />); }
async function open() { fireEvent.click(await screen.findByRole("button", { name: /Next Steps, \d+ available/ })); return screen.getByTestId("next-steps-panel"); }
const watch = { complete: false, action: { title: "Give an eligible gate employee access to this site", href: "/field-employees?siteId=11&stationId=main&shiftId=s-1&day=2026-11-09&employee=42" }, message: null, context: { siteId: 11, stationId: "main", siteName: "Lease A", stationName: "Main", shiftId: "s-1" } };
function offered(key: GateHelperKey, title: string, priority: number): NextStepWorkflow {
 const workflow: NextStepWorkflow = { id: key, kind: "gate-operation", title, action: { title: "Open actual saved record", href: "/gate/change-over?siteId=11&stationId=main" }, context: watch.context, priority };
 cleanDefinitions.push(registerGateHelper({ key, title, description: title, keywords: [title], access: "gate", create: () => workflow }));
 return workflow;
}

it("opens a branded nonmodal top-right panel with a real count and gentle attention only until viewed", async () => {
  mocks.summary.firstWatch = watch; mount();
  const button = await screen.findByRole("button", { name: "Next Steps, 1 available action" });
  expect(button.getAttribute("data-attention")).toBe("gentle");
  expect(screen.queryByTestId("next-steps-panel")).toBeNull();
  fireEvent.click(button);
  const panel = screen.getByRole("complementary", { name: "Next Steps" });
  expect(panel.getAttribute("aria-modal")).toBeNull(); expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("img", { name: "Test Company logo" })).toBeTruthy();
  expect(button.getAttribute("data-attention")).toBe("none");
  expect(screen.getByRole("link", { name: "Other navigation" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close Next Steps" }));
  expect(screen.queryByTestId("next-steps-panel")).toBeNull();
  expect(button.getAttribute("data-attention")).toBe("none"); expect(document.activeElement).toBe(button);
});

it("groups only real Gate blockers by function and caps deterministic priority at three workflows", async () => {
  mocks.summary = { setup: [{ title: "Payroll", href: "/payroll" }, { title: "Company profile", href: "/vendors/4" }], credentials: [{ title: "Update Safety certificate", href: "/field/compliance" }], coiUploadNeeded: true, firstWatch: watch };
  const offers = [offered("gate-shift-scheduling", "Saved station shift needs an assignee", 30), offered("gate-staffing-recovery", "Saved staffing alert needs coverage", -10), offered("gate-inner-arrival", "Saved vehicle needs inner arrival", 20)];
  mount(offers); const panel = await open();
  expect(within(panel).getAllByRole("heading", { level: 3 }).map(h => h.textContent)).toEqual(["Gate Staffing", "Gate Operations", "Gate Traffic"]);
  expect(screen.getByRole("button", { name: "Next Steps, 3 available actions" })).toBeTruthy();
  expect(within(panel).getAllByRole("button", { name: /Start guided helper/ })).toHaveLength(3);
  expect(screen.queryByText("Payroll")).toBeNull(); expect(screen.queryByText("Company profile")).toBeNull();
  expect(screen.queryByText("Saved station shift needs an assignee")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.map(c => c[0])).toEqual(["/api/account-next-steps"]);
});

it("starts the actual helper and preserves site, station, saved shift, day, and exact worker in navigation", async () => {
  mocks.summary.firstWatch = watch; mount(); await open();
  fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy(); expect(screen.queryByTestId("next-steps-panel")).toBeNull();
  expect(screen.getByRole("button", { name: "Choose or add employee" }).getAttribute("data-guidance-id")).toBe("continue");
  fireEvent.click(screen.getByRole("button", { name: "Choose or add employee" }));
  expect(mocks.navigate).toHaveBeenCalledWith("/field-employees?siteId=11&stationId=main&shiftId=s-1&day=2026-11-09&employee=42&nextSteps=first-watch");
  expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy();
});

it("keeps saved waiting status in the active helper without an offered action or another Assume Watch", async () => {
  mocks.summary.firstWatch = watch; mount(); await open(); fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  mocks.summary.firstWatch = { ...watch, action: null, message: "Watch saved. Waiting for its automatic ticket to be confirmed; do not assume this watch again.", context: { ...watch.context, watchId: "w-1" } };
  await act(async () => { await cache.invalidateQueries({ queryKey: ["account-next-steps"] }); });
  expect(await screen.findByText(/Watch saved. Waiting/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next Steps, 0 available actions" }).getAttribute("data-attention")).toBe("none");
  expect(screen.queryByRole("button", { name: "Assume Watch" })).toBeNull(); await open();
  expect(screen.queryByRole("button", { name: /Start your first gate watch/ })).toBeNull();
});

it("does not block the dashboard on pending reads or claim an error is an empty saved summary", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount(); expect(screen.getByText("Dashboard ready")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next Steps, checking saved work" })); expect(screen.getByText("Checking saved work…")).toBeTruthy();
  await act(async () => finish(response({}, false)));
  expect(await screen.findByText("Next Steps could not be refreshed.")).toBeTruthy();
  expect(screen.queryByText("No guided steps need your action right now.")).toBeNull();
});

it("shows an empty state for successful completion and stops attention", async () => {
  mocks.summary.firstWatch = { complete: true, action: null, message: null, context: null }; mount(); await open();
  expect(screen.getByText("No guided steps need your action right now.")).toBeTruthy(); expect(screen.queryByText("Gate Operations")).toBeNull();
  expect(screen.getByRole("button", { name: "Next Steps, 0 available actions" }).getAttribute("data-attention")).toBe("none");
});

it("removes completed first-watch work after fresh saved confirmation and records its actual guided proof once", async () => {
  mocks.summary.firstWatch = watch; mount(); await open(); fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  mocks.summary.firstWatch = { complete: true, action: null, message: null, context: { ...watch.context, watchId: "saved-watch-1", ticketId: 91 } };
  await act(async () => { await cache.invalidateQueries({ queryKey: ["account-next-steps"] }); });
  await waitFor(() => expect(screen.queryByTestId("next-steps-active-helper")).toBeNull());
  const receipts = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/workflow-helpers/completions");
  expect(receipts).toHaveLength(1);
  expect(JSON.parse(String(receipts[0][1]?.body))).toEqual({ workflowKey: "first-watch", mode: "guided", recordType: "gate-watch", recordId: "saved-watch-1", siteId: 11 });
});

it("retains active guidance through navigation; menu outside/X close does not stop the helper", async () => {
  mocks.summary.firstWatch = watch; const view = mount(); await open(); fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  mocks.location = "/work-hub"; view.rerender(<AppView page="Work Hub ready" />);
  expect(screen.getByRole("button", { name: "Choose or add employee" })).toBeTruthy(); await open();
  fireEvent.pointerDown(screen.getByText("Work Hub ready")); expect(screen.queryByTestId("next-steps-panel")).toBeNull(); expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy();
  await open(); fireEvent.click(screen.getByRole("button", { name: "Close Next Steps" })); expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.filter(c => c[0] === "/api/account-next-steps")).toHaveLength(1);
});

it("shares one account read across multiple navigation buttons and in-app page renders", async () => {
  mocks.summary.firstWatch = watch; const view = render(<AppView secondButton />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Next Steps, 1 available action" })).toHaveLength(2));
  view.rerender(<AppView page="Another page" secondButton />);
  expect(vi.mocked(fetch).mock.calls.filter(c => c[0] === "/api/account-next-steps")).toHaveLength(1);
});

it("resets panels, helper, saved person, and offers immediately on a company or membership switch", async () => {
  mocks.summary.firstWatch = watch; const view = mount(); await open(); fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save actual worker result" })); expect(screen.getByText(/Saved contracted employee: Pat Contractor/)).toBeTruthy();
  mocks.user = { ...mocks.user, activeMembershipId: 3, vendorId: 5, availableMemberships: [{ id: 3, role: "admin" }] }; mocks.summary = { setup: [], credentials: [], firstWatch: null };
  view.rerender(<AppView page="New company" />); expect(screen.queryByTestId("next-steps-active-helper")).toBeNull(); expect(screen.queryByTestId("next-steps-panel")).toBeNull();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(screen.queryByText(/Pat Contractor/)).toBeNull(); expect(cache.getQueryCache().findAll({ queryKey: ["account-next-steps"] })).toHaveLength(2);
});

it("suppresses automatic coaching at three independent completions but explicit on-demand invocation still starts it", async () => {
  mocks.summary = { setup: [], credentials: [], firstWatch: watch, helperProgress: { independentThreshold: 3, independentCompletions: { "first-watch": 3 } } }; mount(); await open();
  expect(screen.queryByRole("button", { name: /Start your first gate watch/ })).toBeNull(); expect(screen.getByRole("button", { name: "Next Steps, 0 available actions" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start requested gate helper" })); expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("allows on-demand coaching after the one-time first watch is complete without counting the old watch again", async () => {
  mocks.summary.firstWatch = { complete: true, action: null, message: null, context: { ...watch.context, watchId: "previous-watch", ticketId: 91 } }; mount(); await open();
  fireEvent.click(screen.getByRole("button", { name: "Start requested gate helper" })); expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/workflow-helpers/completions")).toBe(false);
});

it("enforces one active helper; its own Stop X keeps saved work and does not write an invented completion", async () => {
  mocks.summary.firstWatch = watch; const other = offered("gate-watch-handoff", "Saved watch handoff", 20); mount([other]); await open(); fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  await open(); expect((screen.getByRole("button", { name: /Saved watch handoff/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close Next Steps" })); fireEvent.click(screen.getByRole("button", { name: "Stop current helper" })); expect(screen.queryByTestId("next-steps-active-helper")).toBeNull();
  await open(); expect((screen.getByRole("button", { name: /Saved watch handoff/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("reports a real independent saved outcome once and never counts starts or clicks", async () => {
  mount(); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole("button", { name: "Report saved handoff" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/workflow-helpers/completions")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Report saved handoff" }));
  const receipts = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/workflow-helpers/completions"); expect(receipts).toHaveLength(1);
  expect(JSON.parse(String(receipts[0][1]?.body)).mode).toBe("independent");
});

it("does not request Gate account guidance for a non-Gate field membership", () => {
  mocks.user = { ...mocks.user, role: "field_employee", vendorRole: "foreman", availableMemberships: [{ id: 2, role: "field_employee" }] }; mount();
  expect(screen.queryByRole("button", { name: /Next Steps,/ })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});

 it("binds the completion receipt to the mounted account and keeps the helper when a cookie context swap is rejected", async () => {
  mocks.summary.firstWatch = watch;
  const offer = offered("gate-watch-handoff", "Saved watch handoff", 20);
  vi.mocked(fetch).mockImplementation(async path => response(path === "/api/workflow-helpers/completions" ? { code: "workforce.context_changed" } : mocks.summary, path !== "/api/workflow-helpers/completions"));
  mount([offer]); await open(); fireEvent.click(screen.getByRole("button", { name: /Saved watch handoff/ }));
  fireEvent.click(screen.getByRole("button", { name: "Report saved handoff" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workflow-helpers/completions", expect.objectContaining({ headers: { "Content-Type": "application/json", "X-VNDRLY-Actor-User": "7", "X-VNDRLY-Vendor": "4", "X-VNDRLY-Membership": "2" } })));
  expect(screen.getByTestId("next-steps-active-helper")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/account-next-steps")).toHaveLength(1);
 });

it("hides Gate guidance for a confirmed non-Gate admin company while keeping completed Gate companies eligible", async () => {
 mocks.summary.firstWatch = null; mount();
 await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
 await waitFor(() => expect(screen.queryByRole("button",{name:/^Next Steps,/})).toBeNull());
 expect(screen.queryByTestId("next-steps-active-helper")).toBeNull();
});

it("shares the active step with askV and preserves it when guidance is reopened from chat", async () => {
  mocks.summary.firstWatch = watch; mount(); await open();
  fireEvent.click(screen.getByRole("button", { name: /Start your first gate watch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Publish current form step" }));
  expect(JSON.parse(screen.getByTestId("shared-askv-workflow").getAttribute("data-context")!).active).toMatchObject({ key: "first-watch", context: { siteId: 11 }, action: { title: "Current form step" } });
  fireEvent.click(screen.getByRole("button", { name: "Start requested gate helper" }));
  expect(screen.getByText("Review this current form before saving.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Current form step" })).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("resumes from freshly saved assignment progress on another page instead of repeating employee setup", async () => {
  mocks.summary.firstWatch = watch; mocks.location = "/dashboard"; mount(); await open();
  mocks.summary.firstWatch = { ...watch, action: { title: "Assign the already-created station shift", href: "/work-hub/calendar?siteId=11&stationId=main&shiftId=s-1" } };
  fireEvent.click(screen.getByRole("button", { name: "Close Next Steps" }));
  fireEvent.click(screen.getByRole("button", { name: "Resume setup with askV" }));
  expect(await screen.findByRole("button", { name: "Assign the already-created station shift" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choose or add employee" })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Assign the already-created station shift" }));
  expect(mocks.navigate).toHaveBeenCalledWith("/work-hub/calendar?siteId=11&stationId=main&shiftId=s-1");
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("resumes a saved waiting state without manufacturing another watch action", async () => {
  mocks.summary.firstWatch = watch; mount(); await open();
  mocks.summary.firstWatch = { ...watch, action: null, message: "Watch saved; waiting for its automatic ticket.", context: { ...watch.context, watchId: "actual-watch" } };
  fireEvent.click(screen.getByRole("button", { name: "Resume setup with askV" }));
  expect(await screen.findByText("Watch saved; waiting for its automatic ticket.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choose or add employee" })).toBeNull();
  expect(JSON.parse(screen.getByTestId("shared-askv-workflow").getAttribute("data-context")!).active.action).toBeNull();
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
