import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
const duty = vi.hoisted(() => ({ onShift: false, vendorRole: "office", managedSiteId:null as number|null }));
vi.mock("@/components/workday-controls", () => ({ default: ({watchControl,onShiftChange}: {watchControl?: React.ReactNode;onShiftChange?:(active:boolean)=>void}) => {
  React.useEffect(()=>{onShiftChange?.(duty.onShift);},[onShiftChange]);
  return <section aria-label="Workday"><button type="button" role="switch" aria-label="Shift" aria-checked={duty.onShift} /><button type="button" role="switch" aria-label="On Call" aria-checked="false" />{watchControl}</section>;
} }));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/components/gate-task-hopper", () => ({ default: ({ stationId, collapsed }: { stationId?: string; collapsed?: boolean }) => collapsed
  ? <details><summary>Unassigned Tasks</summary></details>
  : <section aria-label="Unassigned Task Hopper" data-testid="shared-gate-hopper" data-station={stationId} /> }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: api }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1, vendorRole: duty.vendorRole, ...(duty.managedSiteId?{managedSubcontractor:{siteGrants:[{siteId:duty.managedSiteId,role:"gatekeeper"}]}}:{}) } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#0095a8", name: "MidCon Solutions" }),
}));
import { PILL_BRAND, PILL_IDLE } from "@/lib/pill-palette-assets";
import GateChangeOverPage from "./gate-change-over";
const snapshot = {
  generatedAt: "2026-10-22T12:00:00Z",
  startedAt: "2026-10-22T06:00:00Z",
  coverage: "recorded",
  revision: "a",
  metrics: {
    checkIns: 2,
    checkOuts: 1,
    onSiteVisitorRecords: 1,
    onSiteEmployeeRecords: 0,
    onSiteVehicles: 1,
    pendingAdmission: 0,
  },
  outstanding: [],
  exceptions: [],
  openItems: [],
  facts: [],
};
const state = () => ({
  station: { id: "gate", name: "Main gate", site_id: 1 },
  site: { id: 1, name: "Site" },
  supervisor: false,
  shift: {
    id: "watch-outgoing",
    operator_id: 1,
    operator_name: "Outgoing",
    started_at: "2026-10-22T06:00:00Z",
    preparation_id: "prep",
  },
  preparation: {
    id: "prep",
    created_at: "2026-10-22T12:01:00Z",
    snapshot,
    notes: "Barrier note",
    summary: { source: "structured_facts", facts: [] },
  },
  snapshot,
  stale: false,
  items: [],
});
beforeEach(() => {
  duty.onShift = false;
  duty.vendorRole = "office";
  duty.managedSiteId = null;
  api.mockReset();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  onlineManager.setOnline(true);
  api.mockImplementation(async (path: string) =>
    path.startsWith("/sites")
      ? { sites: [{ id: 1, name: "Site" }] }
      : path.startsWith("/stations")
        ? { stations: [{ id: "gate", name: "Main gate" }] }
        : path.includes("/notes?")
          ? { rows: [], actions: [] }
        : path.endsWith("/state")
          ? state()
          : path.endsWith("/authenticate")
            ? { proof: "signed", incoming: { id: 2, displayName: "Incoming" } }
            : {},
  );
});
const caches: QueryClient[] = [];
afterEach(() => { cleanup(); for (const cache of caches.splice(0)) cache.clear(); });
it("opens an exact historical note independently of the date filter and marks only a visible note viewed", async () => {
  const oldUrl = window.location.href;
  const observe = vi.fn(), disconnect = vi.fn();
  let intersect: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = observe; disconnect = disconnect;
  });
  window.history.replaceState({}, "", "/gate/shift-notes?siteId=1&stationId=gate&handoffId=old-note");
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path: string, body?: unknown) => path === "/gate/notes?handoffId=old-note" ? {
    rows: [{ id: "old-note", outgoing_name: "Past gatekeeper", incoming_name: "Relief", filed_at: "2026-08-01T10:00:00Z", acknowledged_at: "2026-08-02T10:00:00Z", notes: "Exact old shift note", summary: { facts: [] }, snapshot, viewed_at: null }], actions: [],
  } : path.endsWith("/viewed") ? { viewed: true } : base(path, body));
  try {
    mount(true);
    expect(await screen.findByText("Exact old shift note")).toBeTruthy();
    expect(api).toHaveBeenCalledWith("/gate/notes?handoffId=old-note");
    expect(screen.queryByLabelText("changeOver.range")).toBeNull();
    expect(screen.getByRole("link", { name: "changeOver.allShiftNotes" }).getAttribute("href")).toBe("/gate/shift-notes?siteId=1&stationId=gate");
    expect(api.mock.calls.some(([path]) => path.endsWith("/viewed"))).toBe(false);
    act(() => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/gate/notes/old-note/viewed", {}));
  } finally {
    window.history.replaceState({}, "", oldUrl);
    vi.unstubAllGlobals();
  }
});
it.each([
  ["gatekeeper", true, true],
  ["gate_supervisor", true, true],
  ["gatekeeper", false, false],
  ["office", true, false],
])("limits Next Actions to on-duty gatekeepers (%s, %s)", async (vendorRole, onShift, visible) => {
  duty.vendorRole = vendorRole as string;
  duty.onShift = onShift as boolean;
  mount();
  await screen.findByRole("heading", { name: "handoffDesk.title" });
  expect(Boolean(screen.queryByLabelText("handoffDesk.nextActions"))).toBe(visible);
});
it.each([[1,true],[2,false]])("shows on-duty guidance only at the managed worker's granted site (%s)",async(managedSiteId,visible)=>{
  duty.onShift=true;duty.vendorRole="field";duty.managedSiteId=managedSiteId as number;
  mount();await screen.findByRole("heading",{name:"handoffDesk.title"});
  expect(Boolean(screen.queryByLabelText("handoffDesk.nextActions"))).toBe(visible);
});
it("keeps the coverage map off the Dashboard", () => {
  mount(false);
  expect(screen.queryByRole("region", { name: "Gate coverage map" })).toBeNull();
});
it("requests separate history discovery for inactive gates without reusing operational selectors", async () => {
  mount(true);
  await waitFor(() => expect(api).toHaveBeenCalledWith("/sites?mode=history"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/stations?siteId=1&mode=history"));
});
function mount(history = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <GateChangeOverPage history={history} />
    </QueryClientProvider>,
  );
  return cache;
}
it("shows the standard back control and branded Dashboard icon", () => {
  mount();
  expect(screen.getByTestId("button-back")).not.toBeNull();
  expect(screen.getByTestId("gate-dashboard-header-icon").getAttribute("class")).not.toContain("card-icon-drop-shadow");
  expect(screen.getByRole("heading", { level: 1, name: "changeOver.title" })).not.toBeNull();
});
it("keeps Save handoff gray at rest and branded on hover without requiring notes", async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith("/state")
    ? { ...state(), preparation: null }
    : base(path, body));
  mount();
  const button = await screen.findByRole("button", { name: "handoffDesk.save" });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  const sources = Array.from(button.querySelectorAll("img"), (image) => image.getAttribute("src"));
  expect(sources).toContain(PILL_IDLE);
  expect(sources).toContain(PILL_BRAND.midcon);
});
it("delegates live actions to the shared current-gate task hopper", async () => {
  mount();
  const hopper = await screen.findByTestId("shared-gate-hopper");
  expect(hopper.getAttribute("data-station")).toBe("gate");
  expect(screen.queryByRole("tab", { name: "changeOver.openItems" })).toBeNull();
});
it("combines outgoing actions and notes in one handoff card with an optional saved preview", async () => {
  mount();
  const handoff = await screen.findByRole("region", { name: "handoffDesk.title" });
  const actions = within(handoff).getByRole("region", { name: "changeOver.carryForward" });
  const notesPanel = screen.getByRole("region", { name: "changeOver.outgoingNotes" });
  expect(handoff.contains(actions)).toBe(true);
  expect(handoff.contains(notesPanel)).toBe(true);
  expect(within(notesPanel).getByRole("heading", { level: 3, name: "changeOver.outgoingNotes" })).not.toBeNull();
  expect(within(notesPanel).getByRole("textbox", { name: "changeOver.outgoingNotes" })).not.toBeNull();
  expect(within(handoff).getByText("handoffDesk.independent")).not.toBeNull();
  expect(within(handoff).getByText("handoffDesk.previewSaved").parentElement?.tagName).toBe("DETAILS");
  expect(screen.queryByRole("region", { name: "changeOver.review" })).toBeNull();
  expect(screen.getAllByRole("region", { name: "handoffDesk.title" })).toHaveLength(1);
});
it("offers the task hopper to an incoming on-shift worker without owning the watch", async () => {
  duty.onShift = true;
  useIncoming();
  mount();
  await screen.findByRole("heading", { name: "handoffDesk.title" });
  fireEvent.click(screen.getByText("changeOver.carryForward"));
  expect(screen.getByRole("region", { name: "Unassigned Task Hopper" }).getAttribute("data-station")).toBe("gate");
  expect(api.mock.calls.some(([path]) => path.endsWith("/items"))).toBe(false);
});
it("outlines each live snapshot counter in the organization brand", async () => {
  mount();
  await screen.findByText("changeOver.checkIns");
  for (const metric of Object.keys(snapshot.metrics)) {
    const label = screen.getByText(`changeOver.${metric}`);
    const row = screen.getByTestId(`dashboard-metric-${metric}`);
    expect(row.contains(label)).toBe(true);
    expect(row.getAttribute("href")).toContain("range=current_shift");
  }
});
it("limits Shift Notes to one year and uses branded compact fields", async () => {
  mount(true);
  const card = screen.getByTestId("shift-notes-main-card");
  expect(screen.getByTestId("button-back")).not.toBeNull();
  expect(screen.getByTestId("shift-notes-header-icon").getAttribute("class")).not.toContain("card-icon-drop-shadow");
  expect(card.className).toContain("bg-white");
  expect(card.contains(screen.getByRole("combobox", { name: "changeOver.site" }))).toBe(true);
  expect(card.contains(screen.getByRole("textbox", { name: "changeOver.search" }))).toBe(true);
  expect(card.contains(await screen.findByText("changeOver.noNotes"))).toBe(true);
  const range = screen.getByRole("combobox", { name: "changeOver.range" });
  expect(Array.from(range.querySelectorAll("option"), (option) => option.value)).toEqual([
    "7", "30", "90", "365",
  ]);
  for (const field of [
    screen.getByRole("combobox", { name: "changeOver.site" }),
    screen.getByRole("combobox", { name: "changeOver.gate" }),
    range,
    screen.getByRole("textbox", { name: "changeOver.search" }),
  ]) {
    expect(field.className).toContain("rounded-full");
    expect(field.className).toContain("border-[color:var(--brand-primary)]");
    expect(field.className).toContain("bg-white");
  }
});

function incomingState() { return { ...state(), shift: { ...state().shift, operator_id: 2 } }; }
function useIncoming() {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith('/state') ? incomingState() : base(path, body));
}
it('saves a concise handoff without assuming a watch or ending a paid shift', async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith('/state') ? { ...state(), preparation: null } : base(path, body));
  mount();
  fireEvent.change(await screen.findByRole('textbox', { name: 'changeOver.outgoingNotes' }), { target: { value: 'Barrier inspection due before the next delivery.' } });
  fireEvent.click(await screen.findByRole('button', { name: 'handoffDesk.save' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/gate/prepare', { notes: 'Barrier inspection due before the next delivery.' }));
  expect(api.mock.calls.some(([path]) => /\/(watch\/assume|transfer|logout|start|end)$/.test(path))).toBe(false);
});
it('uses one explicit reviewed-assumption action bound to the saved handoff and current revision', async () => {
  useIncoming(); mount();
  const assume = await screen.findByRole('button', { name: 'handoffDesk.assume' });
  expect(screen.queryByRole('checkbox', { name: 'changeOver.acknowledge' })).toBeNull();
  expect(api.mock.calls.some(([path]) => path.endsWith('/watch/assume'))).toBe(false);
  fireEvent.click(assume);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/gate/watch/assume', expect.objectContaining({ source: 'web', preparationId: 'prep', reviewedRevision: 'a', acknowledged: true, operationId: expect.any(String) })));
});
it('requires a fresh saved briefing after watch activity changes before one-click review', async () => {
  useIncoming(); const cache = mount();
  await screen.findByRole('button', { name: 'handoffDesk.assume' });
  cache.setQueryData(['change-over-state', 1, 'gate'], { ...incomingState(), stale: true, snapshot: { ...snapshot, revision: 'b' } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'handoffDesk.assume' }) as HTMLButtonElement).disabled).toBe(true));
  expect(api.mock.calls.some(([path]) => path.endsWith('/watch/assume'))).toBe(false);
});
it('assumes a reviewed watch using the signed-in account without credentials or a session switch', async () => {
  useIncoming(); mount();
  const review = await screen.findByRole('button', { name: 'handoffDesk.assume' });
  expect((review as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByLabelText('changeOver.password')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(review);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/gate/watch/assume', expect.objectContaining({ source: 'web', preparationId: 'prep', reviewedRevision: 'a', acknowledged: true, operationId: expect.any(String) })));
  expect(api.mock.calls.some(([path]) => /\/(authenticate|transfer|start)$/.test(path))).toBe(false);
});
it('blocks review when the current revision differs from the saved handoff even without a stale flag', async () => {
  useIncoming(); const cache = mount();
  await screen.findByRole('button', { name: 'handoffDesk.assume' });
  await act(async () => { cache.setQueryData(['change-over-state', 1, 'gate'], { ...incomingState(), snapshot: { ...snapshot, revision: 'b' } }); });
  await waitFor(() => expect((screen.getByRole('button', { name: 'handoffDesk.assume' }) as HTMLButtonElement).disabled).toBe(true));
  expect(api.mock.calls.some(([path]) => path.endsWith('/watch/assume'))).toBe(false);
});
it('disables explicit reviewed watch assumption when offline', async () => {
  useIncoming(); mount();
  await screen.findByRole('button', { name: 'handoffDesk.assume' });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  fireEvent(window, new Event('offline'));
  await waitFor(() => expect(screen.getAllByText('changeOver.offline').length).toBeGreaterThan(0));
  expect((screen.getByRole('button', { name: 'handoffDesk.assume' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.mock.calls.some(([path]) => path.endsWith('/watch/assume'))).toBe(false);
});
it('keeps the top Workday card limited to shift and on-call controls', async () => {
  mount();
  const workday = await screen.findByRole('region', { name: 'Workday' });
  expect(within(workday).getByRole('switch', { name: 'Shift' })).toBeTruthy();
  expect(within(workday).getByRole('switch', { name: 'On Call' })).toBeTruthy();
  for (const name of ['changeOver.site', 'changeOver.gate']) {
    const select = within(workday).getByRole('combobox', { name });
    expect(select.className).toContain('gate-dashboard-location-select');
  }
  expect(within(workday).queryByRole('button', { name: 'watch.handover' })).toBeNull();
  expect(within(workday).queryByRole('button', { name: 'watch.assume' })).toBeNull();
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
});

it('returns from the Dashboard to Work Hub through its back link', async () => {
  mount();
  expect((await screen.findByTestId('button-back')).getAttribute('href')).toBe('/work-hub');
});

it('does not duplicate the original watch command while canonical recovery is pending', async () => {
  const base=api.getMockImplementation()!;
  let current=incomingState(), attempts=0;
  api.mockImplementation(async (path,body) => {
    if(path.endsWith('/state')) return current;
    if(path.includes('/watch/operations/')) return {receipt:null};
    if(path.endsWith('/watch/assume')) { attempts++; if(attempts===1) { current={...incomingState(),preparation:{...state().preparation,id:'later-prep'},snapshot:{...snapshot,revision:'later'}}; throw new Error('Lost response'); } return {id:'original'}; }
    return base(path,body);
  });
  const cache=mount();
  fireEvent.click(await screen.findByRole('button',{name:'handoffDesk.assume'}));
  await screen.findByText('Lost response');
  await cache.invalidateQueries({queryKey:['change-over-state']});
  await waitFor(()=>expect(api.mock.calls.some(([path])=>path.includes('/watch/operations/'))).toBe(true));
  const writes=api.mock.calls.filter(([path])=>path.endsWith('/watch/assume'));
  expect(writes).toHaveLength(1);
});

it('retries the immutable original watch command only after an explicit null-receipt readback', async () => {
  const base = api.getMockImplementation()!;
  let current = incomingState();
  let attempts = 0;
  api.mockImplementation(async (path, body) => {
    if (path.endsWith('/state')) return current;
    if (path.includes('/watch/operations/')) return { receipt: null };
    if (path.endsWith('/watch/assume')) {
      attempts++;
      if (attempts === 1) throw new Error('Lost original response');
      return { id: 'original-watch-receipt' };
    }
    return base(path, body);
  });
  const cache = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'handoffDesk.assume' }));
  await screen.findByText('Lost original response');
  const original = structuredClone(api.mock.calls.find(([path]) => path.endsWith('/watch/assume'))!);
  current = { ...incomingState(), preparation: { ...state().preparation, id: 'later-preparation', notes: 'Later notes' }, snapshot: { ...snapshot, revision: 'later-revision' }, stale: true };
  await act(async () => { await cache.invalidateQueries({ queryKey: ['change-over-state'] }); });
  await waitFor(() => expect((screen.getByRole('button', { name: 'handoffDesk.assume' }) as HTMLButtonElement).disabled).toBe(true));
  expect(api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'))).toHaveLength(1);
  const beforeRetry = api.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'handoffDesk.checkRequest' }));
  await waitFor(() => expect(api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'))).toHaveLength(2));
  const retries = api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'));
  expect(retries[1]).toEqual(original);
  expect(retries[1][1]).toEqual(expect.objectContaining({ preparationId: 'prep', reviewedRevision: 'a', acknowledged: true }));
  expect(api.mock.calls.slice(beforeRetry)[0][0]).toBe(`/gate/watch/operations/${original[1].operationId}`);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'handoffDesk.checkRequest' })).toBeNull());
});

it('does not resend an uncertain watch command when canonical readback fails', async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path, body) => {
    if (path.endsWith('/state')) return incomingState();
    if (path.includes('/watch/operations/')) throw new Error('Cannot read watch receipt');
    if (path.endsWith('/watch/assume')) throw new Error('Lost response');
    return base(path, body);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'handoffDesk.assume' }));
  await screen.findByText('Lost response');
  const beforeCheck = api.mock.calls.filter(([path]) => path.includes('/watch/operations/')).length;
  fireEvent.click(screen.getByRole('button', { name: 'handoffDesk.checkRequest' }));
  await screen.findByText('Cannot read watch receipt');
  expect(api.mock.calls.filter(([path]) => path.includes('/watch/operations/')).length).toBeGreaterThan(beforeCheck);
  expect(api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'))).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'handoffDesk.checkRequest' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'handoffDesk.assume' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps initial no-watch assumption disabled after a lost response and failed receipt readback', async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path, body) => {
    if (path.endsWith('/state')) return { ...state(), shift: null, preparation: null, snapshot: null };
    if (path.includes('/watch/operations/')) throw new Error('Cannot verify initial watch request');
    if (path.endsWith('/watch/assume')) throw new Error('Lost initial watch response');
    return base(path, body);
  });
  mount();
  const assume = await screen.findByRole('button', { name: 'Assume Watch' }) as HTMLButtonElement;
  expect(assume.disabled).toBe(false);
  fireEvent.click(assume);
  await screen.findByText('Lost initial watch response');
  await waitFor(() => expect(assume.disabled).toBe(true));
  const original = api.mock.calls.find(([path]) => path.endsWith('/watch/assume'))!;
  expect(original[1]).toEqual({ operationId: expect.any(String), source: 'web' });
  fireEvent.click(assume);
  expect(api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'))).toHaveLength(1);

  const beforeCheck = api.mock.calls.filter(([path]) => path.includes('/watch/operations/')).length;
  fireEvent.click(screen.getByRole('button', { name: 'handoffDesk.checkRequest' }));
  await screen.findByText('Cannot verify initial watch request');
  expect(api.mock.calls.filter(([path]) => path.includes('/watch/operations/')).length).toBeGreaterThan(beforeCheck);
  expect(api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'))).toHaveLength(1);
  expect(assume.disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'handoffDesk.checkRequest' })).toBeTruthy();
});

it('accepts an existing canonical receipt without resending the watch command', async () => {
  const base = api.getMockImplementation()!;
  let receipt: { id: string } | null = null;
  api.mockImplementation(async (path, body) => {
    if (path.endsWith('/state')) return incomingState();
    if (path.includes('/watch/operations/')) return { receipt };
    if (path.endsWith('/watch/assume')) throw new Error('Lost response');
    return base(path, body);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'handoffDesk.assume' }));
  await screen.findByText('Lost response');
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('/watch/operations/'))).toBe(true));
  receipt = { id: 'saved-watch-receipt' };
  const beforeCheck = api.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'handoffDesk.checkRequest' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'handoffDesk.checkRequest' })).toBeNull());
  expect(api.mock.calls.slice(beforeCheck).some(([path]) => path.includes('/watch/operations/'))).toBe(true);
  expect(api.mock.calls.filter(([path]) => path.endsWith('/watch/assume'))).toHaveLength(1);
  expect(api.mock.calls.slice(beforeCheck).some(([path]) => path.endsWith('/state'))).toBe(true);
});

it.each(["self", "22"])("uses the single Recover Shift action for dropdown choice %s", async (target) => {
  const base = api.getMockImplementation()!;
  const current = { ...state(), supervisor: true, shift: { ...state().shift, operator_id: 9 } };
  api.mockImplementation(async (path, body) => {
    if (path.endsWith("/state")) return current;
    if (path.endsWith("/recovery-operators")) return { operators: [
      { userId: 9, membershipId: 99, name: "Outgoing", companyName: "Company" },
      { userId: 1, membershipId: 11, name: "Me", companyName: "Company" },
      { userId: 2, membershipId: 22, name: "Available", companyName: "Company" },
    ] };
    return base(path, body);
  });
  mount();
  const panel = await screen.findByRole("region", { name: "changeOver.supervisor" });
  const selector = within(panel).getByRole("combobox", { name: "changeOver.recoveryReplacement" });
  await within(selector).findByRole("option", { name: "Available · Company" });
  expect((selector as HTMLSelectElement).options[0].text).toBe("changeOver.recoverySelf");
  expect((selector as HTMLSelectElement).value).toBe("self");
  expect(within(panel).getAllByRole("button")).toHaveLength(1);
  fireEvent.change(within(panel).getByLabelText("changeOver.reason"), { target: { value: "Outgoing operator unavailable" } });
  fireEvent.change(selector, { target: { value: target } });
  fireEvent.click(within(panel).getByRole("button", { name: "changeOver.recover" }));
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.endsWith("/recover"))).toBe(true));
  const command = api.mock.calls.find(([path]) => path.endsWith("/recover"))![1];
  expect(command).toEqual({ expectedShiftId: "watch-outgoing", reason: "Outgoing operator unavailable", acknowledged: true,
    ...(target === "self" ? {} : { targetMembershipId: 22 }),
  });
});

it("keeps the same Dashboard panels before a company has an active watch", async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith("/state")
    ? { ...state(), shift: null, preparation: null }
    : base(path, body));
  mount();
  const activity = await screen.findByRole("region", { name: "Gate activity" });
  expect(screen.getByRole("region", { name: "On site" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Watch & handover" })).toBeTruthy();
  expect(within(activity).getByTestId("dashboard-metric-checkIns").textContent).toContain("2");
  expect(within(activity).getByTestId("dashboard-metric-checkIns").getAttribute("href")).toContain("range=24h");
  const watch = screen.getByRole("region", { name: "Watch & handover" });
  expect(within(watch).getByRole("button", { name: "Assume Watch" })).toBeTruthy();
});

it("preserves the Dashboard panels while site snapshot data is unavailable without inventing zeros", async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith("/state")
    ? { ...state(), shift: null, preparation: null, snapshot: null }
    : base(path, body));
  mount();
  const activity = await screen.findByRole("region", { name: "Gate activity" });
  expect(screen.getByRole("region", { name: "On site" })).toBeTruthy();
  expect(within(activity).getByTestId("dashboard-metric-checkIns").textContent).toContain("Unavailable");
});
